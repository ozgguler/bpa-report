# BPA Report Tool

Turns a Palo Alto Networks NGFW **Tech Support File** into a readable **Best Practice
Assessment** report. Drop the file in, get a printable report out — in English, Turkish
or Russian.

**→ [bpa-report-dit.pages.dev](https://bpa-report-dit.pages.dev)**

> Not an official Palo Alto Networks product. This is an independent client for the
> publicly documented Strata Cloud Manager Posture API.

---

## Why this exists

The old "On-Demand BPA" dashboard was retired on 30 April 2026 and replaced by the Posture
API. The API is capable, but using it means service accounts, OAuth, signed URLs, polling
and raw JSON. What a field engineer actually needs hasn't changed: **give it the file, get
the report.**

| | Raw Posture API | This tool |
|---|---|---|
| Input | Configuration XML only | **Tech Support File or configuration XML** |
| Device details | Typed in by hand | **Read from the file automatically** |
| Output | Raw JSON | **Printable report (EN / TR / RU)** |

---

## Two ways to use it

### 1. Just use the website — nothing to install

**[bpa-report-dit.pages.dev](https://bpa-report-dit.pages.dev)**

This is right for almost everyone. Your Tech Support File is opened **in your browser** and
never uploaded anywhere — only the configuration XML inside it is sent on for analysis,
typically less than 1% of the file.

### 2. Run it on your own machine

Only needed if your organisation objects to credentials passing through a relay server (see
[What happens to your data](#what-happens-to-your-data)). In this mode everything runs
locally and nothing touches a third-party server.

Step-by-step instructions for **[macOS](#running-it-on-macos)** and
**[Windows](#running-it-on-windows)** are below. No prior Docker experience needed.

---

## Before you start — you need a service account

Either way, you need Palo Alto Networks API credentials. This is a one-time setup and takes
about two minutes.

1. Go to the [Palo Alto Networks Hub](https://apps.paloaltonetworks.com/hub)
2. Open **Common Services → Identity & Access**
3. Pick the tenant (TSG) the assessment should run against
4. Click **Add Identity** → Identity Type: **Service Account**
5. Give it a name you'll recognise later, e.g. `bpa-report`
6. Copy the **Client ID** and **Client secret**
   ⚠️ **The secret is shown only once.** If you lose it you have to rotate the account.
7. Assign a role. Palo Alto's own reference guide suggests
   `All Apps & Services` + `Superuser`.

The **TSG ID** is shown in the tenant selector on the Identity & Access screen.

You'll end up with three values that look roughly like this:

```
Client ID      name@1234567890.iam.panserviceaccount.com
Client secret  a1b2c3d4-5678-90ab-cdef-1234567890ab
TSG ID         1234567890
```

---

## Running it on macOS

Docker is a tool that runs a pre-packaged application without you having to install its
parts one by one. You install it once; after that, running this tool is a single command.

**1 · Install Docker Desktop**

- Go to **[docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)**
- Click **Download for Mac**. Pick the right build:
  - **Apple Silicon** — Mac with M1/M2/M3/M4 chip
  - **Intel Chip** — older Macs
  - Not sure? Click the  menu → **About This Mac**. If it says "Apple M…", choose
    Apple Silicon.

**2 · Install it**

- Open the downloaded `Docker.dmg`
- Drag the **Docker** icon onto the **Applications** folder
- Open **Applications** and double-click **Docker**
- macOS will warn that it was downloaded from the internet — click **Open**
- Docker asks for your **Mac password** once, to install a helper component. This is normal.
- Accept the service agreement. You can skip the sign-in — an account is not required.

**3 · Wait until Docker is ready**

Look for the whale icon 🐳 in the menu bar at the top of the screen. While it's starting it
animates; when it stops moving, Docker is running. First start takes a minute or two.

**4 · Run the tool**

- Open **Terminal** (press `Cmd + Space`, type `Terminal`, press Enter)
- Copy this line, paste it into the Terminal window, press Enter:

```bash
docker run --rm -p 8080:8080 ghcr.io/ozgguler/bpa-report
```

The first run downloads the tool (about 60 MB) and takes a few seconds. You'll see a line
ending in `Serving … (+ /api/* proxy)` — that means it's running.

**5 · Open it**

Go to **http://localhost:8080** in your browser.

**To stop it:** click the Terminal window and press `Ctrl + C`.
**To start it again later:** repeat step 4. Docker won't re-download anything.

---

## Running it on Windows

**1 · Install Docker Desktop**

- Go to **[docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)**
- Click **Download for Windows** (choose **AMD64** unless you have an ARM device such as a
  Surface Pro X)
- Run the downloaded installer
- Leave **"Use WSL 2 instead of Hyper-V"** ticked — this is the default and the one you want
- When it finishes it may ask you to **restart Windows**. Do it.

> If Windows says a component called **WSL** is missing, open **PowerShell as
> Administrator** and run `wsl --install`, then restart. Docker Desktop needs it.

**2 · Start Docker Desktop**

- Open **Docker Desktop** from the Start menu
- Accept the service agreement. You can skip the sign-in — an account is not required.
- Wait until the whale icon in the system tray (bottom right, near the clock) stops
  animating. First start takes a minute or two.

**3 · Run the tool**

- Open **PowerShell** (press the Windows key, type `PowerShell`, press Enter)
- Copy this line, paste it in (right-click pastes in PowerShell), press Enter:

```powershell
docker run --rm -p 8080:8080 ghcr.io/ozgguler/bpa-report
```

The first run downloads the tool (about 60 MB). You'll see a line ending in
`Serving … (+ /api/* proxy)` — that means it's running.

**4 · Open it**

Go to **http://localhost:8080** in your browser.

**To stop it:** click the PowerShell window and press `Ctrl + C`.
**To start it again later:** repeat step 3.

---

### If port 8080 is already in use

Some other program may already be using that port. Use a different one — here 9090:

```bash
docker run --rm -p 9090:8080 ghcr.io/ozgguler/bpa-report
```

Then open **http://localhost:9090** instead.

### Getting a newer version

```bash
docker pull ghcr.io/ozgguler/bpa-report
```

### A note on Docker Desktop licensing

Docker Desktop is free for personal use, education and small businesses, but **larger
companies need a paid subscription**. If that's a problem in your organisation,
[Podman Desktop](https://podman-desktop.io/) and
[Rancher Desktop](https://rancherdesktop.io/) are free alternatives that run the same
image — replace `docker` with `podman` in the command above if you use Podman.

---

## What happens to your data

- **This tool stores nothing.** Not your credentials, not your configuration, not the
  report. There is no database and nothing is written to disk. Close the tab and it's gone.

- **Your Tech Support File never leaves your computer.** The archive is opened in your
  browser. The logs, core dumps and user data inside it are never transmitted — only the
  configuration XML is sent on, typically less than 1% of the file.

- **Your configuration is uploaded to Palo Alto Networks.** That's where the analysis runs,
  and the file is stored in PANW storage **under your own tenant**. We don't retain it, but
  Palo Alto does — that is simply how the Posture API works.

- **On the hosted site, your credentials pass through a relay.** Palo Alto's endpoints don't
  allow direct calls from a browser (CORS is closed), so requests have to go through a small
  server. It stores and logs nothing, but the data does pass through it in transit. If you'd
  rather it didn't, run the tool on your own machine — then the relay is on your computer.

---

## How it works

**About 90% of the work happens in your browser.** The server is a thin relay that exists
only because Palo Alto's endpoints don't permit direct browser calls. That's why the whole
thing fits in free hosting tiers and why no data is stored anywhere.

```
Browser                              Relay                    Palo Alto Networks
──────────────────────────────       ───────────────          ──────────────────
open the TSF, extract config   ─┐
read device details             │
state machine, polling          ├──▶  /api/*            ──▶   OAuth · Posture API
render the report               ─┘    no state, no logs        signed storage
```

Design decisions and the reasoning behind them: **[ARCHITECTURE.md](ARCHITECTURE.md)**
Deployment: **[DEPLOY.md](DEPLOY.md)**

---

## Repository layout

```
web/                        Cloudflare Pages root (what gets deployed)
  index.html
  assets/app.css  app.js    UI — no inline script, so CSP can stay strict
  lib/
    tsf.js                  TSF extraction (DecompressionStream + tar parser)
    metadata.js             device detail extraction
    api.js                  Posture API state machine
    report.js               report generator (EN/TR/RU)
  functions/api/[[path]].js the relay
  _headers                  CSP and security headers

serve.py                    local dev server — same /api contract as the relay
tools/render.mjs            generate a report from JSON on the command line
tools/test-extractor.html   TSF extraction test harness (local only)
bpa_probe.py                Phase 0 script — exercises the whole API flow end to end
Dockerfile · compose.yaml   run it on your own machine
```

**Development**

```bash
python3 serve.py            # http://127.0.0.1:8765
```

**Generate a report from saved JSON**

```bash
node tools/render.mjs bpa_raw_*.json --all
```

---

## Things worth knowing

Findings from testing against 13 real Tech Support Files (PA-220 through PA-7500, PAN-OS
10.2–12.1, hardware, virtual and an HA pair). These are easy to get wrong:

- **The `severity` field is always empty.** Severity comes from `check_type`.
- **`<config version="…">` is not the PAN-OS version** — it's the config schema version. On
  one device the schema said `11.2.0` while PAN-OS was `11.2.7-h8`.
- **`family` is read from the device, never derived.** The obvious rule breaks:
  `PA-220 → 220` (not 200) and `PA-5430 → 5400f` (with an `f`).
- **Config selection order matters.** A TSF contains `.ha-remote-rc.xml` — the HA *peer's*
  configuration — at almost the same size as the real one. Pick wrong and you produce a
  report for the wrong device.
- **`_headers` does not apply to Pages Functions**, only to static assets. Headers for
  `/api/*` have to be set in the function code.
- **Raw non-compliance counts are misleading.** One real device showed 2,531 non-compliant
  results — but only 86 distinct findings, with a single check accounting for 1,827 of them.
  The report leads with distinct findings for that reason.

---

## Open items

| | |
|---|---|
| Minimum role | The reference guide suggests `Superuser` for the service account; most organisations won't approve that. The narrowest role that actually works hasn't been established yet. |
| Russian translation | Completeness verified programmatically; **accuracy has not been reviewed by a native speaker.** |
