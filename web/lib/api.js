/**
 * Posture API akisi — istemci tarafi durum makinesi.
 *
 * Durumu TARAYICI tasir. Sunucu (proxy) state'sizdir: her cagri birkac
 * saniyelik, uzun omurlu surec yok. Sifir maliyetli barindirmayi mumkun kilan
 * tasarim budur.
 *
 * Credential'lar YALNIZCA bellekte tutulur — localStorage/sessionStorage/cookie
 * KULLANILMAZ. Sekme kapaninca her sey kaybolur; bu bir kusur degil, tasarim.
 */

const POLL_BACKOFF = [2000, 3000, 5000, 8000, 10000, 15000];
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

/** Token omru olculdu: 899 sn. Uzun islerde yenileme sarttir. */
const TOKEN_TTL_MS = 899 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 90 * 1000;

export class BpaError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export class BpaClient {
  /**
   * @param {{proxyBase?: string, onProgress?: (s:{phase:string, message?:string,
   *          status?:string, elapsed?:number}) => void}} opts
   */
  constructor(opts = {}) {
    this.base = (opts.proxyBase || '').replace(/\/$/, '');
    this.onProgress = opts.onProgress || (() => {});
    // Olculdu: GCS imzali URL'lerinde CORS kapali. PANW acarsa true yapilir.
    this.tryDirect = opts.tryDirect === true;
    this._token = null;
    this._tokenAt = 0;
    this._creds = null;
  }

  _p(phase, extra = {}) { this.onProgress({ phase, ...extra }); }

  /** Credential'lari bellekte tutar. Diske yazilmaz. */
  setCredentials({ clientId, clientSecret, tsgId }) {
    this._creds = { clientId, clientSecret, tsgId };
  }

  /** Bellekteki her seyi siler. */
  destroy() {
    this._creds = null;
    this._token = null;
    this._tokenAt = 0;
  }

  async _getToken(force = false) {
    const fresh = this._token &&
      (Date.now() - this._tokenAt) < (TOKEN_TTL_MS - TOKEN_REFRESH_MARGIN_MS);
    if (fresh && !force) return this._token;
    if (!this._creds) throw new BpaError('NO_CREDENTIALS');

    this._p('auth');
    const r = await fetch(`${this.base}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this._creds),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 429) throw new BpaError('RATE_LIMITED');
    if (!r.ok || !d.access_token) {
      throw new BpaError('AUTH_FAILED', d.error_description || d.error || `HTTP ${r.status}`);
    }
    this._token = d.access_token;
    this._tokenAt = Date.now();
    return this._token;
  }

  async _createTask(meta) {
    this._p('task');
    const token = await this._getToken();
    const r = await fetch(`${this.base}/api/task`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family: meta.family, model: meta.model, serial: meta.serial,
        version: meta.version,
        'requester-email': meta.requesterEmail || '',
        'requester-name': meta.requesterName || '',
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 429) throw new BpaError('TOO_MANY_JOBS');
    if (r.status === 403) throw new BpaError('NOT_LICENSED', d.message || d.error);
    if (r.status === 400) throw new BpaError('BAD_METADATA', d.message || d.error);
    if (!r.ok) throw new BpaError('TASK_FAILED', d.message || `HTTP ${r.status}`);

    const taskId = d.task_id || d.taskId || d.id;
    const uploadUrl = d.upload_url || d.uploadUrl || d.url;
    if (!taskId || !uploadUrl) throw new BpaError('SCHEMA_CHANGED', Object.keys(d).join(','));
    return { taskId, uploadUrl };
  }

  /**
   * Config'i imzali URL'e yukler.
   *
   * R3 KAPANDI (16 Agu 2026): GCS imzali URL'leri HICBIR CORS basligi
   * dondurmuyor — ne PUT ne GET tarayicidan yapilabiliyor. Bu yuzden varsayilan
   * dogrudan PROXY'dir; "once dogrudan dene" her kosuda bosuna basarisiz bir
   * istek ve konsolda hata uretirdi.
   *
   * Dogrudan yol kod olarak duruyor: PANW ileride bucket CORS'unu acarsa
   * `tryDirect: true` ile aninda devreye girer ve proxy trafigi sifirlanir.
   *
   * Basliklar: text/plain + Content-Encoding: gzip, HAM govde. Referans
   * dokumandaki bu tuhaf kombinasyon Faz 0'da ampirik dogrulandi.
   */
  async _upload(uploadUrl, configText) {
    const bytes = new TextEncoder().encode(configText);
    const headers = { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' };

    if (this.tryDirect) {
      this._p('upload', { message: 'direct' });
      try {
        const r = await fetch(uploadUrl, { method: 'PUT', headers, body: bytes });
        if (r.ok) return 'direct';
      } catch { /* CORS engeli — proxy'ye dus */ }
    }

    this._p('upload', { message: 'proxy' });
    const r2 = await fetch(`${this.base}/api/upload`, {
      method: 'POST',
      headers: { 'X-Upload-Url': uploadUrl, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    if (!r2.ok) throw new BpaError('UPLOAD_FAILED', `HTTP ${r2.status}`);
    return 'proxy';
  }

  async _poll(taskId, signal) {
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < POLL_TIMEOUT_MS) {
      if (signal?.aborted) throw new BpaError('ABORTED');
      // Token 899 sn'de doluyor; _getToken gerekirse kendi yeniler
      const token = await this._getToken();
      const r = await fetch(`${this.base}/api/status?task=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${token}` } });

      if (r.status === 401) { await this._getToken(true); continue; }
      const d = await r.json().catch(() => ({}));
      const status = d.status || '?';
      this._p('poll', { status, elapsed: Math.round((Date.now() - t0) / 1000) });

      if (status === 'COMPLETED') return d;
      if (status === 'FAILED') throw new BpaError('JOB_FAILED', d.message);

      await new Promise(res => setTimeout(res, POLL_BACKOFF[Math.min(i, POLL_BACKOFF.length - 1)]));
      i++;
    }
    throw new BpaError('POLL_TIMEOUT');
  }

  async _download(resultUrl) {
    this._p('download');
    if (this.tryDirect) {
      try {
        const r = await fetch(resultUrl);
        if (r.ok) return await r.json();
      } catch { /* CORS engeli — proxy'ye dus */ }
    }
    const r2 = await fetch(`${this.base}/api/fetch`, { headers: { 'X-Fetch-Url': resultUrl } });
    if (!r2.ok) throw new BpaError('DOWNLOAD_FAILED', `HTTP ${r2.status}`);
    return await r2.json();
  }

  /**
   * Uctan uca akis: token -> gorev -> yukleme -> polling -> sonuc.
   * @returns {Promise<{report:object, taskId:string, uploadPath:string}>}
   */
  async run({ configText, metadata, signal }) {
    const { taskId, uploadUrl } = await this._createTask(metadata);
    const uploadPath = await this._upload(uploadUrl, configText);
    const res = await this._poll(taskId, signal);

    const resultUrl = res?.result?.custom_check_url;
    if (!resultUrl) throw new BpaError('NO_RESULT_URL', Object.keys(res?.result || {}).join(','));

    const report = await this._download(resultUrl);
    // Model/seri BPA JSON'unda YOKTUR — TSF'ten geldi, rapora iliskiyoruz
    report._device_metadata = {
      hostname: metadata.hostname, model: metadata.model, serial: metadata.serial,
      family: metadata.family, 'sw-version': metadata.version,
    };
    this._p('done');
    return { report, taskId, uploadPath };
  }
}

export const ERROR_TEXT = {
  tr: {
    NO_CREDENTIALS: 'Kimlik bilgileri girilmedi.',
    AUTH_FAILED: 'Kimlik doğrulama başarısız. Client ID, Client Secret ve TSG ID değerlerini kontrol edin.',
    RATE_LIMITED: 'Çok fazla istek gönderildi. Bir dakika sonra tekrar deneyin.',
    TOO_MANY_JOBS: 'Tenant\'ınızda aynı anda en fazla 5 BPA işi çalışabilir. Biri bitene kadar bekleyin.',
    NOT_LICENSED: 'Bu tenant\'ta Posture API erişimi yok görünüyor. Lisans ve servis hesabı rolünü kontrol edin.',
    BAD_METADATA: 'Cihaz bilgileri API tarafından kabul edilmedi. Model, seri no ve sürüm alanlarını kontrol edin.',
    SCHEMA_CHANGED: 'API yanıtı beklenen alanları içermiyor — şema değişmiş olabilir.',
    UPLOAD_FAILED: 'Konfigürasyon yüklenemedi. İşlemi tekrar başlatın.',
    JOB_FAILED: 'Değerlendirme başarısız oldu. Yüklenen dosyanın geçerli bir NGFW konfigürasyonu olduğundan emin olun.',
    POLL_TIMEOUT: 'İşlem zaman aşımına uğradı.',
    NO_RESULT_URL: 'Sonuç bağlantısı alınamadı.',
    DOWNLOAD_FAILED: 'Sonuç indirilemedi.',
    ABORTED: 'İşlem iptal edildi.',
  },
  en: {
    NO_CREDENTIALS: 'No credentials provided.',
    AUTH_FAILED: 'Authentication failed. Check Client ID, Client Secret and TSG ID.',
    RATE_LIMITED: 'Too many requests. Try again in a minute.',
    TOO_MANY_JOBS: 'Your tenant allows at most 5 concurrent BPA jobs. Wait for one to finish.',
    NOT_LICENSED: 'This tenant does not appear to have Posture API access. Check licensing and the service account role.',
    BAD_METADATA: 'The API rejected the device details. Check model, serial and version.',
    SCHEMA_CHANGED: 'The API response is missing expected fields — the schema may have changed.',
    UPLOAD_FAILED: 'Configuration upload failed. Start again.',
    JOB_FAILED: 'Assessment failed. Make sure the file is a valid NGFW configuration.',
    POLL_TIMEOUT: 'The operation timed out.',
    NO_RESULT_URL: 'No result link was returned.',
    DOWNLOAD_FAILED: 'Could not download the result.',
    ABORTED: 'Operation cancelled.',
  },
};
