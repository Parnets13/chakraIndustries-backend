@echo off
:: Fix cloudflared Windows service to use ProgramData config
:: Must run as Administrator

echo Updating cloudflared service binary path...
sc config cloudflared binPath= "\"C:\Program Files (x86)\cloudflared\cloudflared.exe\" --config \"C:\ProgramData\cloudflared\config.yml\" tunnel run"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: sc config failed
    pause
    exit /b 1
)
echo OK - binary path updated

echo Starting cloudflared service...
sc start cloudflared
timeout /t 4 >nul
sc query cloudflared | findstr STATE
