# Deployment

The application is deployed as **Cloudflare Pages + Pages Functions**. Static files and the
relay run on the same origin, so no CORS configuration is needed between them and a single
command deploys both.

**Cost: zero.** The free tier gives 100,000 requests/day, unlimited bandwidth and a
`*.pages.dev` subdomain, with no commercial-use restriction.

---

## What gets deployed

```
web/                          ← Pages root (the directory you deploy)
  index.html                  application
  assets/app.css  app.js      UI — no inline script, so CSP can stay strict
  lib/                        tsf · metadata · api · report
  functions/api/[[path]].js   relay (Pages Function → /api/*)
  _headers                    CSP and security headers
```

---

## First deployment

```bash
cd ~/Desktop/BPA && npx wrangler login
```

A Cloudflare OAuth page opens in your browser. **Approve it immediately** — the local
callback listener shuts down after a few minutes, and approving late gives you a
`localhost:8976` connection error.

> Your Cloudflare account **must have a verified email address**, otherwise creating the
> project fails with `Your user email must been verified [code: 8000077]`. There is no
> public API to resend the verification mail; it has to be done from the dashboard.

Create the project once:

```bash
npx wrangler pages project create bpa-report --production-branch main
```

Then, for every deployment:

```bash
cd ~/Desktop/BPA/web && npx wrangler pages deploy . --project-name bpa-report
```

### ⚠️ The command must be run from inside `web/`

Cloudflare looks for the `functions/` directory **relative to the working directory**, not
inside the directory being deployed. Running `wrangler pages deploy web` from the project
root will:

- **Succeed silently** and publish the static files
- But not compile the function — `/api/*` requests fall through to the static handler
- Symptom: `POST /api/token` → **405**, `GET /api/nope` → **200**

When it works, wrangler prints these two lines:

```
✨ Compiled Worker successfully
✨ Uploading Functions bundle
```

If they're missing, the relay is not live.

---

## Post-deployment verification

Locally, `serve.py` imitates the relay — but it **is not** the relay. The Cloudflare Workers
runtime is not Node. Everything below was verified against the live deployment.

| # | Check | Status |
|---|---|---|
| 1 | Security headers applied | ✅ CSP · HSTS · nosniff · no-referrer · COOP · Permissions-Policy |
| 2 | Relay actually reaches PANW | ✅ Token issued, HTTP 200, **334 ms** |
| 3 | Relay guard rails | ✅ Open-proxy attempt `400` · http downgrade `400` · missing token `401` · path traversal `400` · unknown endpoint `404` |
| 4 | `/api/*` not cached | ✅ `no-store` — *but it had to be fixed in code, see below* |
| 5 | Does CSP break the report? | ✅ **No.** Inline `<style>` applies inside a `blob:` document (h1 = 25pt, donut colour correct) |
| 6 | 6.5 MB configuration uploads | ✅ Real run with a large TSF — no Workers body-size limit hit |
| 7 | 23 MB result downloads | ✅ Same run, via `/api/fetch` |
| 8 | CPU time limit | ✅ Not exceeded (the relay mostly waits on I/O, which doesn't count as CPU) |
| 9 | Rate limiting | ✅ 1–8 → `400` (~190 ms, reaches PANW) · 9+ → `429` (~60 ms, **stopped at the edge**) |

On item 9, the important part is that the `429` comes back in ~60 ms: from the ninth attempt
onward, credential guessing **never reaches** Palo Alto's auth endpoint. That is what keeps
this tool from being a useful relay for credential stuffing.

> **Why 6–8 couldn't be tested automatically:** with `connect-src 'self'` in the CSP, the
> live site cannot fetch a file from anywhere else — including a local server. That is the
> **correct** behaviour and must not be relaxed for testing. They were verified by dragging
> a real file into the browser.

### `_headers` does NOT cover Function responses

Measured on the live site: the `/api/*` rule in `_headers` was not being applied — on Pages
that file is only processed for **static assets**. Endpoints carrying credentials must not
be cached, so those headers have to be set inside the function code (the `HDR` constant).
This difference is invisible locally, because `serve.py` doesn't read `_headers` at all.

---

## Also configure in the dashboard

- **Rate limiting rule** — the in-isolate limiter in the code is not sufficient on its own,
  because Cloudflare isolates are short-lived. Add a dashboard rule for `/api/token`, around
  10 requests per minute per IP.
- **Turnstile** *(optional)* — can be added to the token endpoint if abuse appears.

---

## Restricting access

To keep the site private while gathering feedback, use Cloudflare Zero Trust:

**Dashboard → Zero Trust → Access → Applications → Add an application → Self-hosted**
- Domain: `bpa-report-dit.pages.dev`
- Policy: `Emails` → only the addresses that should have access

Free for up to 50 users.

---

## Container image

The image is built and published by GitHub Actions on every push to `main` — no local Docker
required, and the build is **multi-architecture** (`linux/amd64` + `linux/arm64`), which a
local build on a single machine would not be.

The workflow verifies before it publishes: it builds the image, runs it, and checks that the
static files are served, that the relay guard rails hold, and that the container is not
running as root. If any of that fails, nothing is published.

```bash
docker run -p 8080:8080 ghcr.io/ozgguler/bpa-report
```
