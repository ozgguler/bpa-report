/**
 * BPA Tool — CORS proxy (Cloudflare Pages Function).
 *
 * Ayri bir Worker yerine Pages Function: uygulama ve proxy AYNI ORIGIN'de
 * calisir, aralarinda CORS yapilandirmasi gerekmez, tek komutla deploy edilir.
 * Istemci `proxyBase: ''` kullanir — yerelde de uretimde de ayni.
 *
 * NEDEN VAR: olculdu (14 Agu 2026) — auth.apps.paloaltonetworks.com hicbir CORS
 * basligi dondurmuyor, api.strata... preflight'i gecerli yanitlamiyor, ve GCS
 * imzali URL'leri de kapali. Tamamen statik bir uygulama MUMKUN DEGIL.
 *
 * TASARIM KURALI: proxy ne kadar aptalsa guven yuzeyi o kadar kucuk.
 *   - Durum yok, KV yok, cache yok, veritabani yok
 *   - Govde ve credential ASLA loglanmaz
 *   - Yalnizca allowlist'teki hedeflere gider (acik proxy DEGILDIR)
 *
 * Kullanicinin Client Secret'i buradan TRANSIT GECER. Saklanmaz, ama gorulur.
 * Bunu kabul etmeyen icin Docker surumu vardir (proxy kendi makinesinde).
 */

const AUTH_HOST = 'auth.apps.paloaltonetworks.com';
const API_BASE = 'https://api.strata.paloaltonetworks.com/posture/checks/v1/reports';
const STORAGE_HOSTS = new Set(['storage.googleapis.com']);

const MAX_UPLOAD = 64 * 1024 * 1024;
const RL_WINDOW_MS = 60_000;
const RL_MAX = 40;         // IP basina / dakika
const RL_MAX_TOKEN = 8;    // token denemesi IP basina / dakika

/**
 * Izolat-ici hiz siniri. Cloudflare izolatlari kisa omurludur, bu yuzden tek
 * basina YETERLI DEGILDIR — asil siniri paneldeki Rate Limiting kurali saglar.
 * Bu ucuz bir ikinci katmandir.
 *
 * Gerekce: PANW auth endpoint'ine acik bir gecit, kimlik denemesi
 * (credential stuffing) icin kotuye kullanilabilir.
 */
const hits = new Map();

function rateLimited(ip, key, max) {
  const now = Date.now();
  const k = `${ip}:${key}`;
  const rec = hits.get(k);
  if (!rec || now - rec.t > RL_WINDOW_MS) {
    hits.set(k, { t: now, n: 1 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  rec.n++;
  return rec.n > max;
}

/**
 * Ortak yanit basliklari.
 *
 * DIKKAT: Pages'te `_headers` dosyasi YALNIZCA STATIK DOSYALARA uygulanir —
 * Function yanitlarina degil. Canli ortamda olculdu (17 Agu 2026): /api/*
 * yanitlarinda Cache-Control yoktu. Credential ve konfigurasyon tasiyan uc
 * noktalarin onbellege alinmamasi sart oldugu icin baslik burada, kodda verilir.
 */
const HDR = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const json = (body, status) => new Response(JSON.stringify(body), {
  status, headers: HDR,
});

const pass = async (r) => new Response(await r.text(), {
  status: r.status, headers: HDR,
});

/** Imzali URL allowlist dogrulamasi — acik proxy'ye donusmeyi engeller. */
function checkStorageUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || !STORAGE_HOSTS.has(u.hostname)) return null;
  return u.toString();
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';

  // Ayni origin oldugu icin preflight beklemiyoruz; yine de reddetmeyelim
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (rateLimited(ip, 'all', RL_MAX)) return json({ error: 'rate_limited' }, 429);

  try {
    // ---- 1. Token ---------------------------------------------------------
    if (path === '/api/token' && request.method === 'POST') {
      if (rateLimited(ip, 'token', RL_MAX_TOKEN)) return json({ error: 'rate_limited' }, 429);
      const { clientId, clientSecret, tsgId } = await request.json();
      if (!clientId || !clientSecret || !tsgId) {
        return json({ error: 'missing_credentials' }, 400);
      }
      return pass(await fetch(`https://${AUTH_HOST}/oauth2/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: `tsg_id:${tsgId}`,
        }),
      }));
    }

    // ---- 2. BPA gorevi olustur --------------------------------------------
    if (path === '/api/task' && request.method === 'POST') {
      const auth = request.headers.get('Authorization');
      if (!auth) return json({ error: 'missing_token' }, 401);
      return pass(await fetch(`${API_BASE}/config-file-upload`, {
        method: 'POST',
        headers: { Authorization: auth, Accept: 'application/json',
                   'Content-Type': 'application/json' },
        body: await request.text(),
      }));
    }

    // ---- 3. Config yukle (imzali URL'e) -----------------------------------
    if (path === '/api/upload' && request.method === 'POST') {
      const target = checkStorageUrl(request.headers.get('X-Upload-Url') || '');
      if (!target) return json({ error: 'bad_target' }, 400);
      const buf = await request.arrayBuffer();
      if (buf.byteLength > MAX_UPLOAD) return json({ error: 'too_large' }, 413);
      // Faz 0'da ampirik dogrulanan kombinasyon: HAM govde + gzip beyani
      const r = await fetch(target, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' },
        body: buf,
      });
      return json({ ok: r.ok, status: r.status }, r.ok ? 200 : 502);
    }

    // ---- 4. Durum sorgula --------------------------------------------------
    if (path === '/api/status' && request.method === 'GET') {
      const auth = request.headers.get('Authorization');
      const task = url.searchParams.get('task');
      if (!auth) return json({ error: 'missing_token' }, 401);
      if (!task || !/^[\w.-]{1,128}$/.test(task)) return json({ error: 'bad_task' }, 400);
      return pass(await fetch(`${API_BASE}/${encodeURIComponent(task)}/bpa-result`, {
        headers: { Authorization: auth, Accept: 'application/json' },
      }));
    }

    // ---- 5. Sonucu indir ---------------------------------------------------
    if (path === '/api/fetch' && request.method === 'GET') {
      const target = checkStorageUrl(request.headers.get('X-Fetch-Url') || '');
      if (!target) return json({ error: 'bad_target' }, 400);
      const r = await fetch(target);
      return new Response(r.body, { status: r.status, headers: HDR });
    }

    return json({ error: 'not_found' }, 404);
  } catch {
    // Hata detayi disari verilmez — govde/credential sizmasin
    return json({ error: 'proxy_error' }, 502);
  }
}
