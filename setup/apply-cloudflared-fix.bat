@echo off
:: Run as Administrator — fixes cloudflared config to add tally.majesticmall.net
echo Updating C:\ProgramData\cloudflared\config.yml ...

(
echo tunnel: ab6dd83b-5f2a-4712-bbd8-b5e26b6847d8
echo credentials-file: C:\ProgramData\cloudflared\ab6dd83b-5f2a-4712-bbd8-b5e26b6847d8.json
echo.
echo ingress:
echo   # ERP backend ^(Node.js on port 5001^)
echo   - hostname: erp.majesticmall.net
echo     service: http://localhost:5001
echo.
echo   # Tally Prime HTTP server ^(port 9000 — same machine^)
echo   - hostname: tally.majesticmall.net
echo     service: http://localhost:9000
echo.
echo   # Catch-all
echo   - service: http_status:404
) > "C:\ProgramData\cloudflared\config.yml"

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Could not write config. Run as Administrator.
    pause
    exit /b 1
)

echo Config updated. Restarting cloudflared service...
sc stop cloudflared
timeout /t 3 >nul
sc start cloudflared
timeout /t 4 >nul
sc query cloudflared | findstr STATE
echo.
echo Done. tally.majesticmall.net now points to localhost:9000
echo erp.majesticmall.net still points to localhost:5001
pause
