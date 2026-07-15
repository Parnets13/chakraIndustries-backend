# Sri Chakra ERP — Always-On Setup Guide

Fully automated setup: Cloudflare Tunnel + Node.js backend start on every Windows boot.
No manual CMD commands required after this setup.

---

## Architecture

```
Internet → erp.majesticmall.net
              ↓  (Cloudflare Tunnel — Windows Service, auto-start)
         localhost:5001
              ↓  (Node.js/Express backend — PM2, auto-start)
         localhost:9000
              ↓  (Tally Prime HTTP Server)
```

---

## STEP 1 — Install PM2

Run **once** in CMD as Administrator:

```cmd
npm install -g pm2 pm2-windows-startup
```

---

## STEP 2 — Start backend with PM2

```cmd
cd D:\chakara\chakar-backened\chakraIndustries-backend

rem Create logs folder
mkdir D:\chakara\logs

rem Start the app
pm2 start setup\ecosystem.config.cjs

rem Save the process list (survives reboots)
pm2 save
```

---

## STEP 3 — Install PM2 Windows startup service

```cmd
pm2-startup install
```

This creates a Windows Scheduled Task that launches PM2 (and all saved apps) on every boot.

---

## STEP 4 — Set up Cloudflare Tunnel as a Windows Service

> Prerequisites: cloudflared is already installed at  
> `C:\Program Files (x86)\cloudflared\cloudflared.exe`

### 4a. Log in to Cloudflare (one-time)

```cmd
cloudflared tunnel login
```

A browser opens → log in → select `majesticmall.net` → cert saved automatically.

### 4b. Create the tunnel (one-time, skip if already exists)

```cmd
cloudflared tunnel create erp-chakra
```

Note the **tunnel ID** printed (e.g. `abc123...`).

### 4c. Create DNS route (one-time)

```cmd
cloudflared tunnel route dns erp-chakra erp.majesticmall.net
```

### 4d. Copy credentials to system profile

The credentials JSON is created at:
`C:\Users\DELL\.cloudflared\<TUNNEL_ID>.json`

Copy it to the system profile so the Windows Service can access it:

```cmd
mkdir "C:\Windows\System32\config\systemprofile\.cloudflared"
copy "C:\Users\DELL\.cloudflared\*.json" "C:\Windows\System32\config\systemprofile\.cloudflared\"
copy "C:\Users\DELL\.cloudflared\cert.pem" "C:\Windows\System32\config\systemprofile\.cloudflared\"
```

### 4e. Update the config file tunnel ID

Edit `setup\cloudflared-config.yml`:
```yaml
tunnel: <YOUR_TUNNEL_ID>        ← replace with the actual UUID (from: cloudflared tunnel list)
credentials-file: C:\Windows\System32\config\systemprofile\.cloudflared\<TUNNEL_ID>.json
```

> ⚠️ **CRITICAL**: The ingress service MUST point to `http://127.0.0.1:5001` (Express backend).
> Do NOT point it to port 9000 — that is Tally Prime and cannot serve REST/JSON API requests.
> Pointing the tunnel at port 9000 causes "connection forcibly closed" errors for all /api/* routes.

### 4f. Install Cloudflare Tunnel as Windows Service

```cmd
cloudflared service install
```

Then copy your config:

```cmd
copy "D:\chakara\chakar-backened\chakraIndustries-backend\setup\cloudflared-config.yml" "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml"
```

### 4g. Start the service

```cmd
sc start cloudflared
```

Verify it's running:
```cmd
sc query cloudflared
```

Should show `STATE: 4 RUNNING`.

---

## STEP 5 — Tally Prime HTTP Server

Inside Tally Prime:
1. Press `F12` → Configure
2. Advanced Configuration
3. **Enable ODBC/HTTP Server** → `Yes`
4. **Port** → `9000`
5. Accept

Tally must be open (not minimised to tray, actually running) for sync to work.

---

## STEP 6 — Trigger the Tally data sync

Once Tally is running and tunnel is up:

```cmd
cd D:\chakara\chakar-backened\chakraIndustries-backend
node scripts/syncWhenTallyUp.js
```

This auto-waits until Tally responds, then imports all vendors/clients/ledgers.

---

## Verification Checklist

| Check | Command | Expected |
|---|---|---|
| Cloudflare tunnel service | `sc query cloudflared` | `STATE: 4 RUNNING` |
| Backend running via PM2 | `pm2 list` | `chakra-erp-backend` → `online` |
| Backend responding | `curl http://localhost:5000/api/api/health` | `{"ok":true}` |
| Tally reachable locally | `curl -X POST http://localhost:9000 -d "<test/>"` | Any response (not refused) |
| Tunnel reachable externally | Open `https://erp.majesticmall.net/api/health` | `{"ok":true}` |

---

## Daily Operations (nothing needed — it's all automatic)

- System boots → PM2 Scheduled Task starts → backend starts
- System boots → `cloudflared` Windows Service starts → tunnel is live
- If backend crashes → PM2 restarts it within 5 seconds
- If cloudflared crashes → Windows Service Manager restarts it

---

## Logs

| Log | Location |
|---|---|
| Backend stdout | `D:\chakara\logs\erp-out.log` |
| Backend errors | `D:\chakara\logs\erp-error.log` |
| Cloudflare tunnel | Windows Event Viewer → Application → cloudflared |
| PM2 status | `pm2 list` |
| PM2 logs live | `pm2 logs chakra-erp-backend` |

---

## Quick troubleshoot commands

```cmd
rem Backend status
pm2 list
pm2 logs chakra-erp-backend --lines 50

rem Restart backend
pm2 restart chakra-erp-backend

rem Tunnel status
sc query cloudflared

rem Restart tunnel
sc stop cloudflared & sc start cloudflared

rem Check Tally is reachable
curl -X POST http://localhost:9000 -H "Content-Type: text/xml" -d "<test/>" --max-time 5
```
