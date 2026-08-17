/**
 * TSF (Tech Support File) extraction — tarayici tarafi.
 *
 * Palo Alto Posture API yalnizca config XML kabul eder. Bu modul bir TSF
 * arsivini KULLANICININ MAKINESINDE stream olarak acar ve icinden yalnizca
 * running-config.xml + cihaz metadata'sini cikarir.
 *
 * Neden tarayicida:
 *   - Loglar, core dump'lar ve kullanici verisi makineyi hic terk etmez
 *   - Sunucuya 1.6 GB degil ~160 KB gider
 *   - Sunucu tarafinda buyuk dosya isleme altyapisi gerekmez
 *
 * Bagimlilik yok. DecompressionStream (Chrome/Edge 80+, Firefox 113+,
 * Safari 16.4+) disinda hicbir sey kullanilmaz.
 */

// ---------------------------------------------------------------------------
// Sabitler — Python prototipiyle (bpa_probe.py) birebir ayni olmali
// ---------------------------------------------------------------------------

/**
 * Oncelik sirasi PAZARLIK KONUSU DEGILDIR.
 * Olculen gercek bir TSF'de koku <config> olan ONLARCA XML bulundu:
 * candidatecfg.177.xml (20 MB), last-candidatecfg.xml, refreshed-candidatecfg.*,
 * template-config.xml, panorama_pushed/*. "Ilk bulunani al" denseydi bir
 * CANDIDATE config gonderilip sessizce yanlis rapor uretilirdi.
 */
const CONFIG_PREF = ['running-config.xml', 'merged-running-config.xml', 'candidate-config.xml'];

/** Otoriter metadata kaynagi: 'show system info' ciktisini iceren dump. */
const SYSINFO_RE = /(^|\/)tmp\/cli\/techsupport_[^/]*\.txt$/;

/**
 * Dekompresyon bombasi korumasi — IKI KATMANLI.
 *
 * Olculen gercek TSF'ler (17 Agu 2026, 13 dosya): en buyugu 1020 MB sikistirilmis
 * -> 9.62 GB acilmis. Ilk yazdigim 8 GB tavan bu dosyalarin BESINI reddediyordu.
 * Mutlak tavan gercek dunyaya gore yeniden belirlendi.
 *
 * Ayrica oran kontrolu: olculen gercek oranlar 8-20x araliginda. Bir zip bomb
 * binlerce kat sisirir; 150x tavani gercek dosyalara genis pay birakirken
 * bombayi yakalar. Tek basina mutlak tavana guvenmek, kucuk ama asiri sikistirilmis
 * bir dosyanin belleği tuketmesine izin verirdi.
 */
const MAX_TOTAL_UNPACKED = 32 * 1024 ** 3;
const MAX_EXPANSION_RATIO = 150;

const MAX_CONFIG_BYTES = 256 * 1024 ** 2;   // tek config XML tavani
const MAX_SYSINFO_BYTES = 64 * 1024 ** 2;   // techsupport dump tavani (olculen: 7.8 MB)
const BLOCK = 512;

// ---------------------------------------------------------------------------
// ByteQueue — kopyalamadan atlamak icin
// ---------------------------------------------------------------------------

/**
 * Chunk listesi uzerinde calisan bayt kuyrugu.
 *
 * Kritik: skip() veri KOPYALAMAZ. Bir TSF'in 1.6 GB'inin neredeyse tamami
 * atlanacagi icin, naif "buffer birlestir" yaklasimi O(n^2) olur ve tarayiciyi
 * kilitler. Burada yalnizca gercekten okunan (~8 MB) materyalize edilir.
 */
class ByteQueue {
  constructor() {
    this.chunks = [];
    this.head = 0;      // ilk chunk icindeki offset
    this.length = 0;
  }

  push(chunk) {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  /** Bastan n bayt okur ve tuketir. Yetersizse null. */
  read(n) {
    if (this.length < n) return null;
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      const c = this.chunks[0];
      const avail = c.length - this.head;
      const take = Math.min(avail, n - filled);
      out.set(c.subarray(this.head, this.head + take), filled);
      filled += take;
      this.head += take;
      if (this.head >= c.length) {
        this.chunks.shift();
        this.head = 0;
      }
    }
    this.length -= n;
    return out;
  }

  /** Bastan n bayt atar — KOPYALAMA YAPMAZ. Atilan bayt sayisini doner. */
  skip(n) {
    let left = n;
    while (left > 0 && this.chunks.length) {
      const c = this.chunks[0];
      const avail = c.length - this.head;
      if (avail > left) {
        this.head += left;
        this.length -= left;
        return n;
      }
      this.chunks.shift();
      this.head = 0;
      this.length -= avail;
      left -= avail;
    }
    return n - left;
  }
}

// ---------------------------------------------------------------------------
// tar basligi
// ---------------------------------------------------------------------------

const dec = new TextDecoder('utf-8', { fatal: false });

function cstr(bytes) {
  let end = bytes.indexOf(0);
  if (end === -1) end = bytes.length;
  return dec.decode(bytes.subarray(0, end)).trim();
}

/** tar boyut alani sekizliktir; GNU base-256 uzantisini da destekle. */
function parseSize(field) {
  if (field[0] & 0x80) {                       // GNU base-256
    let v = 0;
    for (let i = 1; i < field.length; i++) v = v * 256 + field[i];
    return v;
  }
  const s = cstr(field).replace(/[^0-7]/g, '');
  return s ? parseInt(s, 8) : 0;
}

function parseHeader(b) {
  // Tamami sifir blok => arsiv sonu isareti
  let zero = true;
  for (let i = 0; i < BLOCK; i++) if (b[i] !== 0) { zero = false; break; }
  if (zero) return null;

  const name = cstr(b.subarray(0, 100));
  const prefix = cstr(b.subarray(345, 500));
  return {
    name: prefix ? `${prefix}/${name}` : name,
    size: parseSize(b.subarray(124, 136)),
    type: String.fromCharCode(b[156] || 48),   // '0'/'\0' = normal dosya
  };
}

function looksLikeConfig(bytes) {
  const head = dec.decode(bytes.subarray(0, 4096))
    .replace(/^﻿/, '')
    .replace(/^\s*<\?xml[^>]*\?>\s*/, '')
    .trimStart();
  return head.startsWith('<config');
}

function baseName(p) {
  const b = p.split('/').pop() || p;
  return b.replace(/^\.+/, '');   // '.merged-running-config.xml' -> nokta soyulur
}

// ---------------------------------------------------------------------------
// Ana fonksiyon
// ---------------------------------------------------------------------------

/**
 * Bir TSF dosyasindan config XML ve cihaz metadata'sini cikarir.
 *
 * @param {File|Blob} file
 * @param {{onProgress?: (info:{bytes:number, files:number, phase:string}) => void}} [opts]
 * @returns {Promise<{configText:string, configPath:string, sysinfoText:string|null,
 *                    sysinfoPath:string|null, files:number, unpacked:number, ms:number}>}
 */
export async function extractFromTsf(file, opts = {}) {
  const t0 = performance.now();
  const onProgress = opts.onProgress || (() => {});

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('UNSUPPORTED_BROWSER');
  }

  // --- Tur tespiti uzantiya degil MAGIC BYTE'a gore ---
  // Dosyalar beklenmedik uzantilarla gelebiliyor (or. indirme araclarinin
  // sarmaladigi .tgz_tw). Uzantiya guvenmek kafa karistirici tar hatasi uretir.
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!(magic[0] === 0x1f && magic[1] === 0x8b)) {
    const hex = [...magic].map(b => b.toString(16).padStart(2, '0')).join(' ');
    const err = new Error('NOT_GZIP');
    err.detail = hex;
    throw err;
  }

  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const q = new ByteQueue();

  let best = null;          // {rank, text, path}
  let sysinfoText = null, sysinfoPath = null;
  let files = 0, unpacked = 0, streamDone = false;
  let pendingLongName = null;   // GNU 'L' kaydi

  /** Kuyrukta en az n bayt olana kadar besle. */
  async function fill(n) {
    while (q.length < n && !streamDone) {
      const { value, done } = await reader.read();
      if (done) { streamDone = true; break; }
      q.push(value);
      unpacked += value.length;
      if (unpacked > MAX_TOTAL_UNPACKED) throw new Error('DECOMPRESSION_LIMIT');
      if (unpacked > 64 * 1024 ** 2 && unpacked / file.size > MAX_EXPANSION_RATIO) {
        throw new Error('DECOMPRESSION_LIMIT');
      }
      if ((files & 15) === 0) onProgress({ bytes: unpacked, files, phase: 'scan' });
    }
    return q.length >= n;
  }

  try {
    while (true) {
      if (!(await fill(BLOCK))) break;
      const hdr = parseHeader(q.read(BLOCK));
      if (!hdr) break;                       // arsiv sonu

      const padded = Math.ceil(hdr.size / BLOCK) * BLOCK;

      // GNU uzun dosya adi kaydi: veri, BIR SONRAKI kaydin adidir
      if (hdr.type === 'L') {
        if (!(await fill(padded))) break;
        pendingLongName = cstr(q.read(padded));
        continue;
      }
      const path = pendingLongName || hdr.name;
      pendingLongName = null;

      // Yalnizca normal dosyalar; symlink/dizin/device atlanir
      if (hdr.type !== '0' && hdr.type !== '\0' && hdr.type !== ' ') {
        if (!(await fill(padded))) break;
        q.skip(padded);
        continue;
      }
      files++;

      const bn = baseName(path);
      const rank = CONFIG_PREF.indexOf(bn);
      const isXml = bn.toLowerCase().endsWith('.xml');
      const wantConfig = (rank !== -1 || isXml) &&
        hdr.size <= MAX_CONFIG_BYTES &&
        (!best || (rank === -1 ? CONFIG_PREF.length : rank) < best.rank);
      const wantSys = !sysinfoText && SYSINFO_RE.test(path) && hdr.size <= MAX_SYSINFO_BYTES;

      if (!wantConfig && !wantSys) {
        // --- Sicak yol: kopyalamadan atla ---
        let left = padded;
        while (left > 0) {
          if (q.length === 0 && !(await fill(1))) break;
          left -= q.skip(Math.min(left, q.length));
        }
        continue;
      }

      if (!(await fill(padded))) break;
      const block = q.read(padded);
      const data = block.subarray(0, hdr.size);

      if (wantSys) {
        sysinfoText = dec.decode(data);
        sysinfoPath = path;
      } else if (looksLikeConfig(data)) {
        best = { rank: rank === -1 ? CONFIG_PREF.length : rank, text: dec.decode(data), path };
      }

      // ERKEN CIKIS: rank 0 = running-config.xml, tercih listesinin en iyisi —
      // hicbir aday onu gecemez. sysinfo da elimizdeyse arsivin geri kalanini
      // acmanin faydasi yok.
      //
      // Olculdu (13 gercek TSF): hedeflerin ikisi de bazen arsivin ilk %1.7'sinde,
      // bazen %96'sinda cikiyor. Kotu durumda kazanc yok, iyi durumda 9.6 GB
      // yerine 170 MB aciliyor. Asla zarari yok.
      if (best && best.rank === 0 && sysinfoText) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* akis zaten kapali olabilir */ }
  }

  if (!best) throw new Error('CONFIG_NOT_FOUND');

  onProgress({ bytes: unpacked, files, phase: 'done' });
  return {
    configText: best.text, configPath: best.path,
    sysinfoText, sysinfoPath,
    files, unpacked, ms: Math.round(performance.now() - t0),
  };
}

export const _internal = { ByteQueue, parseHeader, parseSize, looksLikeConfig, baseName };
