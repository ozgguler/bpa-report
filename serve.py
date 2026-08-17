#!/usr/bin/env python3
"""
Yerel gelistirme sunucusu + CORS proxy.

web/worker/index.js ile AYNI SOZLESMEYI uygular; boylece istemci kodu
(web/lib/api.js) yerelde ve Cloudflare'de degismeden calisir.
Uretimde bu dosya kullanilmaz — Worker kullanilir.
"""
import http.server
import json
import os
import socketserver
import ssl
import urllib.error
import urllib.parse
import urllib.request

# DOCROOT: statik dosyalarin kok dizini.
#   - Yerelde varsayilan proje kokudur; ornek TSF'lere de erisilebilsin diye.
#   - Docker imajinda DOCROOT=/app/web verilir; boylece "/" dogrudan uygulamadir.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.environ.get("DOCROOT") or HERE)
PORT = int(os.environ.get("PORT", "8765"))
BIND = os.environ.get("BIND", "127.0.0.1")
# Uygulama koke mi yerlesik, yoksa web/ altinda mi?
APP_AT_ROOT = os.path.isfile(os.path.join(ROOT, "index.html"))
os.chdir(ROOT)

AUTH_URL = "https://auth.apps.paloaltonetworks.com/oauth2/access_token"
API_BASE = "https://api.strata.paloaltonetworks.com/posture/checks/v1/reports"
STORAGE_HOSTS = {"storage.googleapis.com"}
MAX_UPLOAD = 64 * 1024 * 1024
CTX = ssl.create_default_context()


def out(method, url, headers=None, body=None, timeout=300):
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:                      # aga erisilemedi
        return 502, json.dumps({"error": "proxy_error", "detail": str(e)}).encode()


def check_storage(raw):
    """Imzali URL allowlist dogrulamasi — acik proxy'ye donusmeyi engeller."""
    if not raw:
        return None
    u = urllib.parse.urlsplit(raw)
    if u.scheme != "https" or u.hostname not in STORAGE_HOSTS:
        return None
    return raw


class _Bounded:
    """Yalnizca n bayt okumaya izin veren dosya sarmalayici (Range yanitlari icin)."""

    def __init__(self, f, n):
        self.f, self.left = f, n

    def read(self, size=-1):
        if self.left <= 0:
            return b""
        if size is None or size < 0:
            size = self.left
        data = self.f.read(min(size, self.left))
        self.left -= len(data)
        return data

    def close(self):
        self.f.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript"}

    # ---- yardimcilar ----
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type,Authorization,X-Upload-Url,X-Fetch-Url")

    def _send(self, status, payload, ctype="application/json"):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---- yonlendirme ----
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        p = urllib.parse.urlsplit(self.path).path

        if p == "/api/token":
            try:
                d = json.loads(self._body() or b"{}")
            except Exception:
                return self._send(400, {"error": "bad_json"})
            if not all(d.get(k) for k in ("clientId", "clientSecret", "tsgId")):
                return self._send(400, {"error": "missing_credentials"})
            form = urllib.parse.urlencode({
                "grant_type": "client_credentials",
                "client_id": d["clientId"], "client_secret": d["clientSecret"],
                "scope": f"tsg_id:{d['tsgId']}",
            }).encode()
            st, raw = out("POST", AUTH_URL,
                          {"Content-Type": "application/x-www-form-urlencoded"}, form)
            return self._send(st, raw)

        if p == "/api/task":
            auth = self.headers.get("Authorization")
            if not auth:
                return self._send(401, {"error": "missing_token"})
            st, raw = out("POST", f"{API_BASE}/config-file-upload",
                          {"Authorization": auth, "Accept": "application/json",
                           "Content-Type": "application/json"}, self._body())
            return self._send(st, raw)

        if p == "/api/upload":
            target = check_storage(self.headers.get("X-Upload-Url"))
            if not target:
                return self._send(400, {"error": "bad_target"})
            body = self._body()
            if len(body) > MAX_UPLOAD:
                return self._send(413, {"error": "too_large"})
            # Faz 0'da ampirik dogrulanan kombinasyon: ham govde + gzip beyani
            st, _ = out("PUT", target,
                        {"Content-Type": "text/plain", "Content-Encoding": "gzip"}, body)
            ok = 200 <= st < 300
            return self._send(200 if ok else 502, {"ok": ok, "status": st})

        return self._send(404, {"error": "not_found"})

    def send_head(self):
        """Range destegi — buyuk TSF'lerin parcali okunabilmesi icin."""
        rng = self.headers.get("Range")
        if not rng or not rng.startswith("bytes="):
            return super().send_head()
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        try:
            start_s, _, end_s = rng[6:].partition("-")
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else size - 1
        except ValueError:
            return super().send_head()
        end = min(end, size - 1)
        if start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        return _Bounded(f, end - start + 1)

    def do_GET(self):
        s = urllib.parse.urlsplit(self.path)
        p, q = s.path, urllib.parse.parse_qs(s.query)

        # Uygulama kokte degilse (yerel gelistirme) / adresi ona yonlendirilir.
        if p == "/" and not APP_AT_ROOT:
            self.send_response(302)
            self.send_header("Location", "/web/index.html")
            self.end_headers()
            return

        if p == "/api/status":
            auth = self.headers.get("Authorization")
            task = (q.get("task") or [""])[0]
            if not auth:
                return self._send(401, {"error": "missing_token"})
            if not task:
                return self._send(400, {"error": "bad_task"})
            st, raw = out("GET", f"{API_BASE}/{urllib.parse.quote(task)}/bpa-result",
                          {"Authorization": auth, "Accept": "application/json"})
            return self._send(st, raw)

        if p == "/api/fetch":
            target = check_storage(self.headers.get("X-Fetch-Url"))
            if not target:
                return self._send(400, {"error": "bad_target"})
            st, raw = out("GET", target)
            return self._send(st, raw)

        if p.startswith("/api/"):
            return self._send(404, {"error": "not_found"})
        return super().do_GET()

    def log_message(self, fmt, *args):
        line = args[0] if args else ""
        if "/api/" in str(line) or "GET /web/" in str(line):
            super().log_message(fmt, *args)


socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer((BIND, PORT), Handler) as httpd:
    print(f"Serving {ROOT} at http://{BIND}:{PORT}  (+ /api/* proxy)")
    httpd.serve_forever()
