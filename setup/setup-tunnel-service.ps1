# setup-tunnel-service.ps1
# Run as Administrator in PowerShell
# Installs Cloudflare Tunnel as Windows Service using ProgramData config path

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Sri Chakra ERP - Cloudflare Tunnel Service Setup" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$CF_EXE      = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$TUNNEL_ID   = "ab6dd83b-5f2a-4712-bbd8-b5e26b6847d8"
$USER_DIR    = "$env:USERPROFILE\.cloudflared"
# ProgramData is accessible by all Windows services (no SYSTEM restriction)
$CF_DATA_DIR = "C:\ProgramData\cloudflared"
$CONFIG_FILE = "$CF_DATA_DIR\config.yml"

# ── 1. Create config directory in ProgramData ─────────────────────────────
Write-Host "[1/4] Creating config directory at $CF_DATA_DIR ..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $CF_DATA_DIR -Force | Out-Null
Write-Host "      OK" -ForegroundColor Green

# ── 2. Copy credentials ────────────────────────────────────────────────────
Write-Host "[2/4] Copying tunnel credentials..." -ForegroundColor Yellow

$certSrc = "$USER_DIR\cert.pem"
$jsonSrc = "$USER_DIR\$TUNNEL_ID.json"

if (-not (Test-Path $certSrc)) {
    Write-Host "      ERROR: $certSrc not found. Run: cloudflared tunnel login" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $jsonSrc)) {
    Write-Host "      ERROR: $jsonSrc not found." -ForegroundColor Red
    Write-Host "      Run: cloudflared tunnel token --cred-file `"$jsonSrc`" tally-tunnel" -ForegroundColor Red
    exit 1
}

Copy-Item $certSrc  "$CF_DATA_DIR\cert.pem" -Force
Copy-Item $jsonSrc  "$CF_DATA_DIR\$TUNNEL_ID.json" -Force
Write-Host "      OK: cert.pem and credentials JSON copied" -ForegroundColor Green

# ── 3. Write config.yml ────────────────────────────────────────────────────
Write-Host "[3/4] Writing config.yml to $CONFIG_FILE ..." -ForegroundColor Yellow

$configContent = @"
tunnel: $TUNNEL_ID
credentials-file: $CF_DATA_DIR\$TUNNEL_ID.json

ingress:
  - hostname: erp.majesticmall.net
    service: http://localhost:5001
  - service: http_status:404
"@

Set-Content -Path $CONFIG_FILE -Value $configContent -Encoding UTF8
Write-Host "      OK" -ForegroundColor Green

# ── 4. Install / restart Windows Service ──────────────────────────────────
Write-Host "[4/4] Installing cloudflared Windows Service..." -ForegroundColor Yellow

# Remove existing
$existing = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service  -Name "cloudflared" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    & $CF_EXE service uninstall 2>&1 | Out-Null
    Start-Sleep -Seconds 2
}

# Install with explicit config path
& $CF_EXE --config $CONFIG_FILE service install
Start-Sleep -Seconds 2

# Set auto-start
Set-Service -Name "cloudflared" -StartupType Automatic -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Start
Start-Service -Name "cloudflared" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4

$svc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "      OK: cloudflared service RUNNING" -ForegroundColor Green
} else {
    $status = if ($svc) { $svc.Status } else { "not found" }
    Write-Host "      WARNING: cloudflared service status = $status" -ForegroundColor Yellow
    Write-Host "      Checking Windows Event Log for errors..." -ForegroundColor Gray
    try {
        $events = Get-EventLog -LogName Application -Source "cloudflared" -Newest 3 -ErrorAction SilentlyContinue
        foreach ($e in $events) { Write-Host "      LOG: $($e.Message.Substring(0,[Math]::Min(200,$e.Message.Length)))" -ForegroundColor Gray }
    } catch {}
}

# ── Summary ────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Cloudflare Tunnel Service installed" -ForegroundColor Green
Write-Host "   Config: $CONFIG_FILE" -ForegroundColor White
Write-Host "   Tunnel: tally-tunnel ($TUNNEL_ID)" -ForegroundColor White
Write-Host "   Route : erp.majesticmall.net -> localhost:5001" -ForegroundColor White
Write-Host ""
Write-Host " Quick checks:" -ForegroundColor White
Write-Host "   sc query cloudflared" -ForegroundColor Cyan
Write-Host "   curl https://erp.majesticmall.net/api/health" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
