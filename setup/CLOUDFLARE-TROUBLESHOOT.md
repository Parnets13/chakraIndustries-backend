# Cloudflare Tunnel Troubleshoot & Fix Guide

## Root Cause of "connection forcibly closed by remote host"

The Cloudflare tunnel was configured to forward traffic to **port 9000** (Tally Prime)
instead of **port 5001** (Express/Node.js backend).

```
WRONG:  erp.majesticmall.net → 127.0.0.1:9000   ← Tally (speaks XML only, not HTTP REST)
RIGHT:  erp.majesticmall.net → 127.0.0.1:5001   ← Express backend (serves all /api/* routes)
```

When `erp.majesticmall.net/api/tally/stats` hit port 9000, Tally tried to parse the
HTTP request as XML, couldn't, and forcibly closed the connection. This affected every
`/api/*` route including `/api/notifications`.

---

## Fix — Update the live cloudflared service config

### Step 1 — Confirm which config the service is using

```cmd
cloudflared tunnel list
```

The live tunnel ID in use is: `f7706eef-df45-4902-b75f-45d641cd8e56`

### Step 2 — Copy updated config to system profile

The corrected config is already in `setup\cloudflared-config.yml`.
Copy it to where the Windows Service reads it:

```cmd
copy /Y "D:\chakara\chakar-backened\chakraIndustries-backend\setup\cloudflared-config.yml" "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml"
```

If access is denied, open CMD as Administrator first.

### Step 3 — Copy credentials file (if not already there)

```cmd
copy /Y "C:\Users\DELL\.cloudflared\f7706eef-df45-4902-b75f-45d641cd8e56.json" "C:\Windows\System32\config\systemprofile\.cloudflared\"
copy /Y "C:\Users\DELL\.cloudflared\cert.pem" "C:\Windows\System32\config\systemprofile\.cloudflared\"
```

### Step 4 — Restart cloudflared service

```cmd
sc stop cloudflared
sc start cloudflared
sc query cloudflared
```

Expected: `STATE: 4 RUNNING`

### Step 5 — Verify the fix

```cmd
curl https://erp.majesticmall.net/api/health
```

Expected response:
```json
{"ok":true,"status":"running","service":"Sri Chakra ERP Backend",...}
```

---

## Fix — Configure Tally URL so sync works

After fixing the tunnel, the backend needs to know where to reach Tally Prime.
Tally is on a **separate machine** — the ERP server cannot talk to it without
its own URL.

### Option A — Tally on the same local network (LAN)

On the Tally PC, run `ipconfig` and note the IPv4 address (e.g. `192.168.1.50`).

Set in `.env`:
```
TALLY_LOCAL_URL=http://192.168.1.50
TALLY_PORT=9000
```

Then seed the DB:
```cmd
cd D:\chakara\chakar-backened\chakraIndustries-backend
node scripts/fixTallyConfig.js
```

### Option B — Tally on a different network (internet, RECOMMENDED)

On the **Tally PC**:
1. Download `cloudflared.exe` from https://github.com/cloudflare/cloudflared/releases/latest
2. Place at `C:\tally-tunnel\cloudflared.exe`
3. Edit `C:\tally-tunnel\start-tally-tunnel.bat` → paste your Cloudflare tunnel token
4. Run the bat file as Administrator

In Cloudflare dashboard (dash.cloudflare.com → Zero Trust → Networks → Tunnels):
- Create a tunnel named `tally-client`
- Public hostname: `tally.majesticmall.net`
- Service: `http://localhost:9000`

Then set in `.env` on the ERP server:
```
TALLY_LOCAL_URL=https://tally.majesticmall.net
TALLY_PORT=443
```

Seed the DB:
```cmd
node scripts/fixTallyConfig.js
```

### Option C — Via ERP UI (no .env change needed)

1. Open https://erp.majesticmall.net
2. Go to Tally → Configuration
3. Set **Tally Local URL** to the Tally PC's URL (LAN IP or tunnel URL)
4. Click Save → Test Connection

---

## Architecture Diagram (correct state)

```
BROWSER / FRONTEND
        ↓  HTTPS
erp.majesticmall.net
        ↓  Cloudflare Tunnel (f7706eef) → port 5001
EXPRESS BACKEND (port 5001)
        ↓  XML POST (Content-Type: text/xml)
        ↓  to TALLY_LOCAL_URL (e.g. https://tally.majesticmall.net or http://192.168.1.50:9000)
TALLY PRIME HTTP SERVER (port 9000, on the client PC)
```

---

## Quick Verification Checklist

| Check | Command | Expected |
|---|---|---|
| Backend listening on 5001 | `netstat -an \| findstr 5001` | `0.0.0.0:5001 LISTENING` |
| Health check via tunnel | `curl https://erp.majesticmall.net/api/health` | `{"ok":true}` |
| Tally reachable (LAN) | `curl -X POST http://192.168.1.50:9000 -H "Content-Type: text/xml" -d "<test/>"` | Any response (not refused) |
| Tally reachable (tunnel) | `curl -X POST https://tally.majesticmall.net -H "Content-Type: text/xml" -d "<test/>"` | Any response |
| Sync stats API | `curl -H "Authorization: Bearer TOKEN" https://erp.majesticmall.net/api/tally/stats` | JSON response |

---

## What was also fixed in code

### `services/oemTallyService.js` — broken REST calls replaced with XML

The original `oemTallyService.js` was calling:
- `POST ${tallyBaseUrl}/vouchers/create`  — **does not exist** in Tally Prime
- `POST ${tallyBaseUrl}/ledgers/update`   — **does not exist** in Tally Prime

These are REST JSON endpoints. Tally Prime only accepts XML at its root endpoint (`/`).

Fixed: all calls now POST proper Tally XML envelopes (`<ENVELOPE><HEADER><TALLYREQUEST>Import Data...`)
to the root URL, matching the protocol used by `tallyService.js` and `tallyFetchEngine.js`.
