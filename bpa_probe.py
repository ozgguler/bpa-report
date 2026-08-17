#!/usr/bin/env python3
"""
BPA Probe — Faz 0 dogrulama scripti.

Amac: kalici kod yazmadan once mimarideki bilinmezleri kapatmak ve
tasarimin girdisi olan HAM BPA JSON'ini elde etmek.

Kapattigi sorular:
  R2  Upload'da dogru Content-Type / Content-Encoding kombinasyonu ne?
  R3  GCS signed URL CORS'a izin veriyor mu?
  R4  family alani hangi degeri kabul ediyor?
  R6  TSF icindeki config yolu ne? (arsiv manifestosu cikarilir)

Bagimlilik yok — sadece Python 3 standart kutuphanesi. venv/pip gerekmez.

KULLANIM
--------
1) Sadece dosyayi incele (credential GEREKMEZ, hicbir sey disari gitmez):

       python3 bpa_probe.py --inspect-only /path/to/techsupport.tgz

2) Tam uctan uca akis:

       export PANW_CLIENT_ID='...'
       export PANW_CLIENT_SECRET='...'
       export PANW_TSG_ID='...'
       python3 bpa_probe.py /path/to/techsupport.tgz

   Girdi olarak .tgz/.tar.gz (TSF) veya .xml (named config snapshot) verilebilir.

3) R2 testi — farkli upload header kombinasyonlari:

       python3 bpa_probe.py config.xml --upload-mode plain
       python3 bpa_probe.py config.xml --upload-mode gzip

GUVENLIK
--------
Credential'lar yalnizca ortam degiskeninden okunur, asla ekrana basilmaz ve
diske yazilmaz. Signed URL'ler ciktida maskelenir.
"""

import argparse
import gzip
import io
import json
import os
import re
import ssl
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

AUTH_URL = "https://auth.apps.paloaltonetworks.com/oauth2/access_token"
API_BASE = "https://api.strata.paloaltonetworks.com/posture/checks/v1/reports"

# Dekompresyon bombasi korumasi: acilmis toplam bayt tavani (8 GB)
MAX_TOTAL_UNPACKED = 8 * 1024**3
# Tek bir config XML icin makul tavan (256 MB)
MAX_CONFIG_BYTES = 256 * 1024**2
# techsupport dump'i icin tavan — olculen ornek 7.8 MB idi
MAX_TEXT_PROBE = 64 * 1024**2

POLL_BACKOFF = [2, 3, 5, 8, 10, 15]
POLL_TIMEOUT_SEC = 15 * 60


# --------------------------------------------------------------------------
# Cikti yardimcilari
# --------------------------------------------------------------------------

def step(n, title):
    print(f"\n{'=' * 72}\n[{n}] {title}\n{'=' * 72}")


def info(msg):
    print(f"  {msg}")


def ok(msg):
    print(f"  [OK] {msg}")


def warn(msg):
    print(f"  [!]  {msg}")


def fail(msg):
    print(f"  [X]  {msg}")


def mask_url(url):
    """Signed URL'i loglanabilir hale getir — query string credential esdegeridir."""
    if not url:
        return "(bos)"
    parts = urllib.parse.urlsplit(url)
    q = "?<imza-gizlendi>" if parts.query else ""
    return f"{parts.scheme}://{parts.netloc}{parts.path}{q}"


# --------------------------------------------------------------------------
# HTTP (stdlib)
# --------------------------------------------------------------------------

def http(method, url, headers=None, body=None, timeout=120):
    """Tek noktadan HTTP. (status, headers_dict, body_bytes) doner."""
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


# --------------------------------------------------------------------------
# TSF / config ayristirma
# --------------------------------------------------------------------------

# Oncelik sirasi PAZARLIK KONUSU DEGIL. Gercek bir TSF'de kokü <config> olan
# onlarca XML bulunur (candidatecfg.*.xml, template-config.xml, panorama_pushed/*,
# last-candidatecfg.xml ...). "Ilk bulunani al" densaydi 20 MB'lik bir CANDIDATE
# config gonderilip yanlis rapor uretilirdi.
CONFIG_PREF = ["running-config.xml", "merged-running-config.xml", "candidate-config.xml"]

# Otoriter metadata kaynagi: 'show system info' ciktisini iceren techsupport dump'i.
# Olculen yerlesim: ./tmp/cli/techsupport_<hostname>_<YYYYMMDD>_<HHMM>.txt
SYSINFO_FILE = re.compile(r"(^|/)tmp/cli/techsupport_[^/]*\.txt$")

# Ekranda gosterilecek alanlar
SYSINFO_KEYS = ["hostname", "serial", "model", "family", "sw-version", "ip-address"]


def parse_system_info(text):
    """
    'show system info' blogunu ayristir.

    Loglarda korlemesine 'serial:' aramak GUVENILMEZ — olculen TSF'de log
    dosyalarinda cihaza ait olmayan baska serial'lar da geciyordu. Yalnizca bu
    blok otoriter kabul edilir.
    """
    i = text.find("> show system info")
    if i == -1:
        i = text.find("\nhostname:")
        if i == -1:
            return {}
    out = {}
    for line in text[i:i + 6000].splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith(">") and out:      # sonraki komut promptu -> blok bitti
            break
        m = re.match(r"^([a-z][\w.-]*)\s*:\s*(.*)$", s, re.I)
        if m and m.group(2).strip():
            out[m.group(1)] = m.group(2).strip()
    return out


def looks_like_config(head: bytes) -> bool:
    txt = head[:4096].decode("utf-8", "replace").lstrip()
    txt = re.sub(r"^<\?xml[^>]*\?>\s*", "", txt)
    return txt.startswith("<config")


def inspect_tsf(path, verbose_manifest=True):
    """
    TSF'i streaming olarak tarar. Doner:
        (config_bytes, config_member_name, sysinfo_dict, manifest_list)

    Arsiv ikinci kez taranmaz; aday config ve sysinfo ayni geciste toplanir.
    """
    config_bytes = None
    config_name = None
    config_rank = len(CONFIG_PREF) + 1
    sysinfo = {}
    manifest = []
    total = 0

    with open(path, "rb") as fh:
        with tarfile.open(fileobj=fh, mode="r|gz") as tar:
            for m in tar:
                if not m.isfile():
                    if m.issym() or m.islnk():
                        warn(f"link member atlandi: {m.name}")
                    continue

                total += m.size
                if total > MAX_TOTAL_UNPACKED:
                    raise RuntimeError("Dekompresyon tavani asildi — bozuk/kotu niyetli arsiv?")

                manifest.append((m.name, m.size))
                # Bastaki nokta soyulur: gercek TSF'de '.merged-running-config.xml'
                # gibi gizli dosya adlari var, aksi halde tercih listesine takilmaz.
                base = os.path.basename(m.name).lstrip(".")

                # --- config adayi ---
                rank = CONFIG_PREF.index(base) if base in CONFIG_PREF else None
                is_xml = base.endswith(".xml")

                if (rank is not None or is_xml) and m.size <= MAX_CONFIG_BYTES:
                    f = tar.extractfile(m)
                    if f is not None:
                        data = f.read()
                        if looks_like_config(data):
                            r = rank if rank is not None else len(CONFIG_PREF)
                            if r < config_rank:
                                config_rank, config_bytes, config_name = r, data, m.name
                    continue

                # --- sysinfo: yalnizca otoriter techsupport dump'i ---
                if not sysinfo and SYSINFO_FILE.search(m.name) and m.size <= MAX_TEXT_PROBE:
                    f = tar.extractfile(m)
                    if f is not None:
                        found = parse_system_info(f.read().decode("utf-8", "replace"))
                        if found.get("serial") or found.get("model"):
                            found["_source"] = m.name
                            sysinfo = found

    if verbose_manifest:
        info(f"Arsivde {len(manifest)} dosya, toplam {total / 1024**2:.1f} MB acilmis")
        xmls = [(n, s) for n, s in manifest if n.endswith(".xml")]
        if xmls:
            info("XML uyeleri (R6 icin kritik — gercek yerlesim):")
            for n, s in sorted(xmls, key=lambda x: -x[1])[:20]:
                info(f"    {s / 1024:9.1f} KB  {n}")

    return config_bytes, config_name, sysinfo, manifest


def metadata_from_config(xml_bytes):
    """
    Config XML'den cikarilabilenler.

    DIKKAT — olculen tuzaklar:
      * <config version="11.2.0"> CONFIG SEMA surumudur, PAN-OS surumu DEGILDIR.
        Ayni cihazda gercek sw-version 11.2.7-h8 idi. API'ye bu deger
        gonderilirse yanlis best-practice seti uygulanabilir.
      * Ilk <ip-address> etiketi rastgele bir arayuze aittir; yonetim IP'si
        degildir. Hedefli yol kullanilir.
    """
    out = {}
    head = xml_bytes[:8192].decode("utf-8", "replace")
    m = re.search(r"<config\b[^>]*\bversion\s*=\s*[\"']([^\"']+)[\"']", head)
    if m:
        out["config-schema-version"] = m.group(1)

    # Hedefli: deviceconfig/system altindaki degerler
    try:
        import xml.etree.ElementTree as ET
        root = ET.fromstring(xml_bytes)
        sysnode = root.find(".//deviceconfig/system")
        if sysnode is not None:
            for tag in ("hostname", "ip-address"):
                el = sysnode.find(tag)
                if el is not None and el.text:
                    out[tag] = el.text.strip()
    except Exception as e:
        warn(f"Config XML ayristirilamadi ({e.__class__.__name__}) — hostname atlandi")
    return out


# Olculen TSF'lerden dogrulanmis istisnalar
FAMILY_EXACT = {"PA-220": "220"}


def derive_family(model):
    """
    Model adindan family TURETIR — YALNIZCA SON CARE.

    TSF varken cagrilmaz: cihaz 'show system info' ciktisinda family'yi kendisi
    soyler. "Ilk haneler + 00" kurali her modelde tutmuyor:
        PA-3440 -> 3400  ✓
        PA-445  -> 400   ✓
        PA-220  -> 220   ✗ kural "200" uretir, cihaz "220" diyor
    """
    if not model:
        return None
    key = str(model).upper().strip()
    if key in FAMILY_EXACT:
        return FAMILY_EXACT[key]
    if key.startswith("VM"):
        return "vm"
    m = re.search(r"PA-(\d+)", key)
    if not m:
        return None
    d = m.group(1)
    return d[:-2] + "00" if len(d) >= 3 else d


# --------------------------------------------------------------------------
# JSON sema ozeti — PDF tasariminin girdisi
# --------------------------------------------------------------------------

def schema_tree(obj, prefix="", depth=0, max_depth=4, lines=None):
    if lines is None:
        lines = []
    pad = "  " * depth
    if isinstance(obj, dict):
        for k, v in list(obj.items())[:40]:
            t = type(v).__name__
            if isinstance(v, dict):
                lines.append(f"{pad}{k}/  ({len(v)} anahtar)")
                if depth < max_depth:
                    schema_tree(v, prefix, depth + 1, max_depth, lines)
            elif isinstance(v, list):
                lines.append(f"{pad}{k}[]  ({len(v)} oge)")
                if v and depth < max_depth:
                    schema_tree(v[0], prefix, depth + 1, max_depth, lines)
            else:
                s = str(v)
                s = s[:60] + "..." if len(s) > 60 else s
                lines.append(f"{pad}{k}: {t} = {s}")
    elif isinstance(obj, list):
        if obj:
            lines.append(f"{pad}[0]:")
            schema_tree(obj[0], prefix, depth + 1, max_depth, lines)
    return lines


def summarize_report(report):
    """BPA JSON'inin ozetini cikar — kac check, kaci gecti/kaldi."""
    bp = report.get("best_practices")
    if not isinstance(bp, dict):
        warn("'best_practices' anahtari beklenen yerde yok — sema degismis olabilir (R8)")
        return
    passed = failed = excluded = 0
    per_section = {}
    for sname, sval in bp.items():
        if not isinstance(sval, dict):
            continue
        cnt = 0
        for _ctype, cval in sval.items():
            items = cval if isinstance(cval, list) else [cval]
            for item in items:
                if not isinstance(item, dict):
                    continue
                for chk in item.get("warnings") or []:
                    if not isinstance(chk, dict):
                        continue
                    cnt += 1
                    if chk.get("check_excluded"):
                        excluded += 1
                    elif chk.get("check_passed"):
                        passed += 1
                    else:
                        failed += 1
        if cnt:
            per_section[sname] = cnt

    total = passed + failed + excluded
    info(f"Toplam kontrol : {total}")
    info(f"  Gecti        : {passed}")
    info(f"  Kaldi        : {failed}")
    info(f"  Haric        : {excluded}")
    if per_section:
        info("Bolum kirilimi:")
        for k, v in sorted(per_section.items(), key=lambda x: -x[1]):
            info(f"    {v:6d}  {k}")


# --------------------------------------------------------------------------
# API adimlari
# --------------------------------------------------------------------------

def get_token(cid, secret, tsg):
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": cid,
        "client_secret": secret,
        "scope": f"tsg_id:{tsg}",
    }).encode()
    st, _, raw = http("POST", AUTH_URL,
                      {"Content-Type": "application/x-www-form-urlencoded"}, body)
    if st != 200:
        fail(f"Token alinamadi (HTTP {st})")
        try:
            info(json.dumps(json.loads(raw), indent=2)[:800])
        except Exception:
            info(raw[:400].decode("utf-8", "replace"))
        if st in (400, 401):
            info("-> Client ID / Secret / TSG ID dogrulugunu ve servis hesabi rolunu kontrol et (R5).")
        sys.exit(1)
    tok = json.loads(raw).get("access_token")
    if not tok:
        fail("Yanitta access_token yok")
        sys.exit(1)
    ok(f"Token alindi (uzunluk {len(tok)}, deger basilmiyor)")
    return tok


def create_task(token, meta):
    body = json.dumps({
        "family": meta["family"],
        "model": meta["model"],
        "requester-email": meta["email"],
        "requester-name": meta["name"],
        "serial": meta["serial"],
        "version": meta["version"],
    }).encode()
    info("Istek govdesi:")
    info(json.dumps(json.loads(body), indent=2).replace("\n", "\n  "))

    st, _, raw = http("POST", f"{API_BASE}/config-file-upload", {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }, body)

    if st == 429:
        fail("HTTP 429 — tenant'ta 5 aktif is limiti dolu. Biri bitene kadar bekle.")
        sys.exit(1)
    if st not in (200, 201, 202):
        fail(f"Task olusturulamadi (HTTP {st})")
        info(raw[:800].decode("utf-8", "replace"))
        if st == 403:
            info("-> R1: Posture API bu tenant'ta lisansli olmayabilir (Essentials vs Pro).")
        if st == 400:
            info("-> R4: 'family' degeri reddedilmis olabilir. --family ile elle dene.")
        sys.exit(1)

    resp = json.loads(raw)
    info("Yanit anahtarlari: " + ", ".join(resp.keys()))
    task_id = resp.get("task_id") or resp.get("taskId") or resp.get("id")
    upload_url = resp.get("upload_url") or resp.get("uploadUrl") or resp.get("url")
    if not task_id or not upload_url:
        fail("task_id / upload_url beklenen alanlarda yok — sema degismis (R8)")
        info(json.dumps(resp, indent=2)[:1500])
        sys.exit(1)
    ok(f"task_id = {task_id}")
    ok(f"upload_url = {mask_url(upload_url)}")
    return task_id, upload_url


def probe_cors(upload_url):
    """R3: signed URL tarayicidan dogrudan PUT'a izin veriyor mu?"""
    st, h, _ = http("OPTIONS", upload_url, {
        "Origin": "https://bpa.example.com",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
    }, timeout=30)
    acao = h.get("access-control-allow-origin")
    acam = h.get("access-control-allow-methods")
    info(f"OPTIONS -> HTTP {st}")
    if acao:
        ok(f"access-control-allow-origin: {acao}")
        ok(f"access-control-allow-methods: {acam}")
        ok("R3 SONUC: CORS ACIK — tarayici dosyayi dogrudan yukleyebilir, proxy gerekmez.")
    else:
        warn("access-control-allow-origin YOK")
        warn("R3 SONUC: CORS KAPALI — config XML de proxy uzerinden gecmeli.")


UPLOAD_MODES = {
    # Referans dokumandaki kombinasyon: ham govde, ama gzip beyani
    "doc":   {"Content-Type": "text/plain", "Content-Encoding": "gzip"},
    "plain": {"Content-Type": "text/plain"},
    "xml":   {"Content-Type": "application/xml"},
    "gzip":  {"Content-Type": "text/plain", "Content-Encoding": "gzip"},  # govde gercekten sikistirilir
}


def upload(upload_url, data, mode):
    headers = dict(UPLOAD_MODES[mode])
    body = gzip.compress(data) if mode == "gzip" else data
    info(f"Mod '{mode}' — headers: {headers}")
    info(f"Govde: {len(body)} bayt" + (f" (gzip, ham {len(data)})" if mode == "gzip" else " (ham)"))
    st, h, raw = http("PUT", upload_url, headers, body, timeout=300)
    if 200 <= st < 300:
        ok(f"Yukleme basarili (HTTP {st})")
        if h.get("x-goog-generation"):
            info(f"x-goog-generation: {h['x-goog-generation']}")
    else:
        fail(f"Yukleme basarisiz (HTTP {st})")
        info(raw[:500].decode("utf-8", "replace"))
        sys.exit(1)


def poll(token, task_id):
    url = f"{API_BASE}/{task_id}/bpa-result"
    hdr = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    started = time.time()
    i = 0
    while time.time() - started < POLL_TIMEOUT_SEC:
        st, _, raw = http("GET", url, hdr)
        try:
            resp = json.loads(raw)
        except Exception:
            fail(f"JSON olmayan yanit (HTTP {st}): {raw[:200]}")
            sys.exit(1)
        status = resp.get("status", "?")
        el = int(time.time() - started)
        print(f"  [{el:4d}s] status = {status}   {resp.get('message', '')}")
        if status == "COMPLETED":
            return resp
        if status == "FAILED":
            fail("Is FAILED durumunda bitti")
            info(json.dumps(resp, indent=2)[:1000])
            sys.exit(1)
        time.sleep(POLL_BACKOFF[min(i, len(POLL_BACKOFF) - 1)])
        i += 1
    fail("Polling zaman asimi")
    sys.exit(1)


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="BPA Probe — Faz 0 dogrulama")
    ap.add_argument("path", help="TSF (.tgz/.tar.gz) veya config XML")
    ap.add_argument("--inspect-only", action="store_true",
                    help="Sadece dosyayi incele; API cagrisi yapma, credential isteme")
    ap.add_argument("--upload-mode", default="doc", choices=list(UPLOAD_MODES),
                    help="R2 testi: upload header kombinasyonu (varsayilan: doc)")
    ap.add_argument("--family", help="Otomatik turetmeyi ez (R4 testi)")
    ap.add_argument("--model")
    ap.add_argument("--serial")
    ap.add_argument("--version")
    ap.add_argument("--email", default=os.environ.get("PANW_REQUESTER_EMAIL", ""))
    ap.add_argument("--name", default=os.environ.get("PANW_REQUESTER_NAME", ""))
    ap.add_argument("--outdir", default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()

    if not os.path.isfile(args.path):
        fail(f"Dosya bulunamadi: {args.path}")
        sys.exit(1)

    # ---- 1. Dosya analizi -------------------------------------------------
    step(1, "Girdi dosyasi analizi")
    size_mb = os.path.getsize(args.path) / 1024**2
    info(f"Dosya: {args.path} ({size_mb:.1f} MB)")

    # Tur tespiti uzantiya degil magic byte'a gore yapilir: gercek dosyalar
    # .tgz_tw gibi beklenmedik uzantilarla gelebiliyor (bkz. Prisma Browser).
    with open(args.path, "rb") as f:
        magic = f.read(4)

    is_gzip = magic[:2] == b"\x1f\x8b"
    is_xmlish = magic[:1] == b"<"

    if not is_gzip and not is_xmlish:
        fail(f"Taninmayan dosya formati — ilk baytlar: {magic.hex(' ')}")
        info("Beklenen: gzip (1f 8b ...) veya XML ('<').")
        info("Dosya indirilirken sarmalanmis/sifrelenmis olabilir — ornegin Prisma")
        info("Access Browser indirmeleri paketleyip uzantiya ek koyuyor (.tgz_tw).")
        info("-> TSF'i standart bir tarayici veya SCP/CLI ile yeniden indir.")
        sys.exit(1)

    sysinfo = {}
    if is_gzip:
        info("Tur: gzip arsivi (Tech Support File) — streaming olarak taraniyor...")
        cfg, cfg_name, sysinfo, _ = inspect_tsf(args.path)
        if not cfg:
            fail("Arsiv icinde config XML bulunamadi")
            sys.exit(1)
        ok(f"Config bulundu: {cfg_name} ({len(cfg) / 1024**2:.2f} MB)")
        if sysinfo:
            ok(f"system info bulundu: {sysinfo.get('_source')}")
            for k in SYSINFO_KEYS:
                if k in sysinfo:
                    info(f"    {k:12s} = {sysinfo[k]}")
        else:
            warn("system info bulunamadi — serial/model elle girilmeli (R6 notu)")
    else:
        info("Tur: config XML")
        with open(args.path, "rb") as f:
            cfg = f.read()
        if not looks_like_config(cfg):
            warn("Kok eleman <config> degil — gecerli bir NGFW config'i olmayabilir")

    from_cfg = metadata_from_config(cfg)
    if from_cfg:
        info("Config XML'den cikarilan:")
        for k, v in from_cfg.items():
            info(f"    {k:12s} = {v}")

    # ---- Metadata birlestir ----------------------------------------------
    model = args.model or sysinfo.get("model")
    serial = args.serial or sysinfo.get("serial")
    # sw-version YALNIZCA sysinfo'dan gelir. Config'teki version sema surumudur.
    version = args.version or sysinfo.get("sw-version")
    # family cihazin kendisinden gelir; turetme sadece son care.
    family = args.family or sysinfo.get("family") or derive_family(model)

    if not version and from_cfg.get("config-schema-version"):
        warn(f"PAN-OS surumu bulunamadi. Config sema surumu "
             f"{from_cfg['config-schema-version']} — bu PAN-OS surumu DEGILDIR, "
             f"kullanilmadi. --version ile elle gir.")

    if args.inspect_only:
        step(2, "Inceleme modu — API cagrisi yapilmadi")
        info("Tespit edilen metadata:")
        for k, v in [("family", family), ("model", model),
                     ("serial", serial), ("version", version),
                     ("hostname", sysinfo.get("hostname") or from_cfg.get("hostname"))]:
            print(f"    {k:10s} = {v if v else '(BULUNAMADI — elle girilmeli)'}")
        print("\n  Hicbir veri disari gonderilmedi.")
        return

    # ---- Credential -------------------------------------------------------
    cid = os.environ.get("PANW_CLIENT_ID")
    secret = os.environ.get("PANW_CLIENT_SECRET")
    tsg = os.environ.get("PANW_TSG_ID")
    missing = [n for n, v in [("PANW_CLIENT_ID", cid), ("PANW_CLIENT_SECRET", secret),
                              ("PANW_TSG_ID", tsg)] if not v]
    if missing:
        fail("Eksik ortam degiskeni: " + ", ".join(missing))
        info("Once --inspect-only ile dosyayi inceleyebilirsin (credential gerekmez).")
        sys.exit(1)

    if not all([family, model, serial, version]):
        fail("Eksik metadata — asagidakileri parametre olarak ver:")
        for k, v in [("--family", family), ("--model", model),
                     ("--serial", serial), ("--version", version)]:
            if not v:
                info(f"    {k}")
        sys.exit(1)

    meta = {"family": family, "model": model, "serial": serial, "version": version,
            "email": args.email or "noreply@example.com",
            "name": args.name or "BPA Probe"}

    # ---- 2. Token ---------------------------------------------------------
    step(2, "OAuth token (R1: lisans/yetki dogrulamasi)")
    token = get_token(cid, secret, tsg)

    # ---- 3. Task ----------------------------------------------------------
    step(3, "BPA upload task olustur (R4: family degeri)")
    task_id, upload_url = create_task(token, meta)

    # ---- 4. CORS ----------------------------------------------------------
    step(4, "R3: signed URL CORS testi")
    probe_cors(upload_url)

    # ---- 5. Upload --------------------------------------------------------
    step(5, f"R2: config yukleme (mod = {args.upload_mode})")
    upload(upload_url, cfg, args.upload_mode)

    # ---- 6. Poll ----------------------------------------------------------
    step(6, "Is durumu takibi")
    result = poll(token, task_id)
    ok("Is COMPLETED")

    # ---- 7. Sonuc ---------------------------------------------------------
    step(7, "Sonucu indir")
    info("bpa-result yanit yapisi:")
    for line in schema_tree(result, max_depth=2)[:40]:
        info("    " + line)

    dl = (result.get("result") or {}).get("custom_check_url")
    if not dl:
        fail("result.custom_check_url bos — sema degismis olabilir (R8)")
        info(json.dumps(result, indent=2)[:2000])
        sys.exit(1)
    info(f"Indirme URL'i: {mask_url(dl)}")

    st, _, raw = http("GET", dl, timeout=300)
    if st != 200:
        fail(f"Rapor indirilemedi (HTTP {st})")
        sys.exit(1)
    report = json.loads(raw)
    ok(f"Rapor indirildi ({len(raw) / 1024:.1f} KB)")

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    host = (sysinfo.get("hostname") or from_cfg.get("hostname") or "device")
    host = re.sub(r"[^A-Za-z0-9_.-]", "_", host)
    # Model ve seri no BPA JSON'unda YOKTUR — bunlari TSF'ten cikardik.
    # Rapor ureteci kullanabilsin diye sonuca iliskiyoruz.
    report["_device_metadata"] = {
        "hostname": sysinfo.get("hostname") or from_cfg.get("hostname"),
        "model": model, "serial": serial, "family": family,
        "sw-version": version,
        "source": sysinfo.get("_source") or os.path.basename(args.path),
    }

    out = os.path.join(args.outdir, f"bpa_raw_{host}_{ts}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    ok(f"Kaydedildi: {out}")

    # ---- 8. Sema ozeti ----------------------------------------------------
    step(8, "JSON sema ozeti (PDF tasariminin girdisi)")
    info("Ust seviye anahtarlar: " + ", ".join(report.keys()))
    print()
    for line in schema_tree(report, max_depth=3)[:80]:
        info(line)
    print()
    summarize_report(report)

    print(f"\n{'=' * 72}")
    print("  FAZ 0 TAMAM. Sonraki adim: uretilen JSON'a bakip PDF sablonunu tasarlamak.")
    print(f"{'=' * 72}\n")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nIptal edildi.")
        sys.exit(130)
