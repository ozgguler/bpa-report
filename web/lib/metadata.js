/**
 * Cihaz metadata cikarimi — tarayici tarafi.
 *
 * Posture API `family`, `model`, `serial`, `version` alanlarini ZORUNLU ister.
 * Referans dokumandaki akista bunlari kullanici elle yazar; biz TSF'ten
 * otomatik cikariyoruz.
 *
 * OLCULEN TUZAKLAR (bpa_probe.py ile ayni):
 *   1. <config version="11.2.0"> CONFIG SEMA surumudur, PAN-OS surumu DEGILDIR.
 *      Ayni cihazda gercek sw-version 11.2.7-h8 idi.
 *   2. Config'teki ilk <ip-address> rastgele bir arayuze aittir; yonetim IP'si
 *      degildir. Hedefli yol kullanilir.
 *   3. Loglarda 'serial:' aramak guvenilmezdir — olculen TSF'in log
 *      dosyalarinda cihaza ait olmayan baska serial'lar da geciyordu.
 *      Yalnizca 'show system info' blogu otoriter kabul edilir.
 */

/**
 * 'show system info' blogunu ayristirir.
 * @param {string|null} text techsupport dump icerigi
 * @returns {Record<string,string>}
 */
export function parseSystemInfo(text) {
  if (!text) return {};
  let i = text.indexOf('> show system info');
  if (i === -1) i = text.indexOf('\nhostname:');
  if (i === -1) return {};

  const out = {};
  for (const raw of text.slice(i, i + 6000).split('\n')) {
    const s = raw.trim();
    if (!s) continue;
    if (s.startsWith('>') && Object.keys(out).length) break;   // sonraki komut promptu
    const m = /^([A-Za-z][\w.-]*)\s*:\s*(.*)$/.exec(s);
    if (m && m[2].trim()) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * Config XML'den cikarilabilenler. Tam DOM kurulmaz — buyuk config'lerde
 * bellek patlamasin diye yalnizca deviceconfig/system dugumu hedeflenir.
 */
export function parseConfigXml(xmlText) {
  const out = {};

  const v = /<config\b[^>]*\bversion\s*=\s*["']([^"']+)["']/.exec(xmlText.slice(0, 8192));
  if (v) out.configSchemaVersion = v[1];       // DIKKAT: PAN-OS surumu DEGIL

  // Hedefli: <deviceconfig>...<system>...</system>...</deviceconfig>
  const dc = xmlText.indexOf('<deviceconfig>');
  if (dc !== -1) {
    const sysStart = xmlText.indexOf('<system>', dc);
    if (sysStart !== -1) {
      const sysEnd = xmlText.indexOf('</system>', sysStart);
      const sys = xmlText.slice(sysStart, sysEnd === -1 ? sysStart + 20000 : sysEnd);
      const h = /<hostname>([^<]+)<\/hostname>/.exec(sys);
      if (h) out.hostname = h[1].trim();
      const ip = /<ip-address>([^<]+)<\/ip-address>/.exec(sys);
      if (ip) out.ipAddress = ip[1].trim();
    }
  }
  return out;
}

/**
 * Model adindan family TURETIR — YALNIZCA SON CARE.
 *
 * TSF varken bu fonksiyon CAGRILMAZ: cihaz 'show system info' ciktisinda
 * family'yi kendisi soyler. Yalnizca ciplak config XML yuklendiginde devreye
 * girer ve sonucu KESIN DEGILDIR.
 *
 * "Ilk hane(ler) + 00" kurali her modelde tutmuyor — olculen ornek:
 *     PA-3440 -> 3400  ✓ kural dogru
 *     PA-445  -> 400   ✓ kural dogru
 *     PA-220  -> 220   ✗ kural "200" uretir, cihaz "220" diyor
 *
 * Bu yuzden olcumle dogrulanmis istisnalar acikca listelenir; geri kalanda
 * kural uygulanir ama sonuc "tahmin" olarak isaretlenir (bkz. buildMetadata).
 */
const FAMILY_EXACT = {
  // Olculen gercek TSF'lerden dogrulandi (17 Agu 2026)
  'PA-220': '220',      // kural "200" uretirdi
  'PA-5430': '5400f',   // kural "5400" uretirdi — cihaz sonuna 'f' ekliyor
  'PA-5440': '5400f',
};

export function deriveFamily(model) {
  if (!model) return '';
  const key = String(model).toUpperCase().trim();
  if (FAMILY_EXACT[key]) return FAMILY_EXACT[key];
  if (/^VM/i.test(key)) return 'vm';
  const m = /PA-(\d+)/i.exec(key);
  if (!m) return '';
  const d = m[1];
  return d.length >= 3 ? d.slice(0, -2) + '00' : d;
}

/**
 * TSF cikarim sonucundan API istek govdesi icin metadata uretir.
 *
 * @returns {{family:string, model:string, serial:string, version:string,
 *            hostname:string, ipAddress:string, missing:string[], source:string}}
 */
export function buildMetadata({ configText, sysinfoText, sysinfoPath }) {
  const sys = parseSystemInfo(sysinfoText);
  const cfg = parseConfigXml(configText || '');

  const model = sys.model || '';
  const familyFromDevice = sys.family || sys['platform-family'] || '';
  const meta = {
    // family cihazin kendisinden gelir; turetme yalnizca yedek
    family: familyFromDevice || deriveFamily(model),
    // Turetilmis family KESIN DEGILDIR (bkz. deriveFamily) — arayuz bunu
    // kullaniciya onaylatmali, sessizce gondermemeli.
    familyGuessed: !familyFromDevice,
    model,
    serial: sys.serial || '',
    // sw-version YALNIZCA sysinfo'dan. Config'teki version sema surumudur.
    version: sys['sw-version'] || '',
    hostname: sys.hostname || cfg.hostname || '',
    ipAddress: sys['ip-address'] || cfg.ipAddress || '',
    configSchemaVersion: cfg.configSchemaVersion || '',
    source: sysinfoPath || '',
  };
  meta.missing = ['family', 'model', 'serial', 'version'].filter(k => !meta[k]);
  return meta;
}
