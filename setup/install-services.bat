@echo off
:: ============================================================
:: Sri Chakra ERP — Auto-Start Services Installer
:: Run this ONCE as Administrator
:: ============================================================

echo.
echo ============================================================
echo  Sri Chakra ERP — Installing Auto-Start Services
echo ============================================================
echo.

:: Check admin
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Please run this script as Administrator.
    echo Right-click install-services.bat ^> Run as administrator
    pause
    exit /b 1
)

set BACKEND_DIR=D:\chakara\chakar-backened\chakraIndustries-backend
set LOGS_DIR=D:\chakara\logs
set CF_EXE=C:\Program Files (x86)\cloudflared\cloudflared.exe
set CF_SYS_DIR=C:\Windows\System32\config\systemprofile\.cloudflared
set CF_USER_DIR=%USERPROFILE%\.cloudflared

echo [1/6] Creating logs directory...
if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"
echo       Created: %LOGS_DIR%

echo.
echo [2/6] Installing PM2 globally...
call npm install -g pm2 pm2-windows-startup
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed. Make sure Node.js is installed and npm is in PATH.
    pause
    exit /b 1
)
echo       PM2 installed OK

echo.
echo [3/6] Starting ERP backend with PM2...
cd /d "%BACKEND_DIR%"
call pm2 delete chakra-erp-backend 2>nul
call pm2 start setup\ecosystem.config.cjs
call pm2 save
echo       Backend started and saved to PM2

echo.
echo [4/6] Installing PM2 Windows startup (Scheduled Task)...
call pm2-startup install
echo       PM2 startup task installed

echo.
echo [5/6] Setting up Cloudflare Tunnel Windows Service...

:: Copy credentials from user profile to system profile
if not exist "%CF_SYS_DIR%" mkdir "%CF_SYS_DIR%"

if exist "%CF_USER_DIR%\cert.pem" (
    copy "%CF_USER_DIR%\cert.pem" "%CF_SYS_DIR%\cert.pem" >nul
    echo       Copied cert.pem to system profile
) else (
    echo WARNING: cert.pem not found in %CF_USER_DIR%
    echo          Run: cloudflared tunnel login
    echo          Then re-run this script.
)

:: Copy tunnel credentials JSON (there should be one .json file)
for %%f in ("%CF_USER_DIR%\*.json") do (
    copy "%%f" "%CF_SYS_DIR%\" >nul
    echo       Copied %%~nxf to system profile
)

:: Copy our config.yml
copy "%BACKEND_DIR%\setup\cloudflared-config.yml" "%CF_SYS_DIR%\config.yml" >nul
echo       Copied cloudflared config.yml

:: Stop existing service if running
sc stop cloudflared 2>nul
sc delete cloudflared 2>nul

:: Install tunnel as Windows service
"%CF_EXE%" service install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install cloudflared service.
    echo        Make sure cloudflared.exe is at: %CF_EXE%
    pause
    exit /b 1
)

:: Set service to auto-start
sc config cloudflared start= auto
sc start cloudflared

echo       Cloudflare tunnel service installed and started

echo.
echo [6/6] Verifying services...
echo.

timeout /t 3 >nul

echo --- PM2 Status ---
call pm2 list

echo.
echo --- Cloudflare Tunnel Service ---
sc query cloudflared | findstr "STATE"

echo.
echo ============================================================
echo  SETUP COMPLETE
echo ============================================================
echo.
echo  Next steps:
echo  1. Open Tally Prime
echo  2. Press F12 ^> Configure ^> Advanced Configuration
echo     ^> Enable HTTP Server: Yes, Port: 9000
echo  3. Run Tally sync:
echo     node scripts\syncWhenTallyUp.js
echo.
echo  Verify everything is working:
echo     curl http://localhost:5001/api/health
echo     curl https://erp.majesticmall.net/api/health
echo.
pause
