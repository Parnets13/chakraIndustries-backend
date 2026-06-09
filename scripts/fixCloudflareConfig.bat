@echo off
REM ================================================================
REM  Fix Cloudflare Tunnel Config — Update service to point to port 5001
REM  Run this as Administrator to update the live Windows Service config.
REM ================================================================

echo.
echo ================================================================
echo  Cloudflare Tunnel Config Fix
echo  This updates the live service to point to Express (port 5001)
echo  instead of Tally (port 9000).
echo ================================================================
echo.

REM Check if running as admin
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo ERROR: This script must be run as Administrator.
    echo.
    echo Right-click this file and select "Run as administrator".
    pause
    exit /b 1
)

SET SOURCE_CONFIG="%~dp0..\setup\cloudflared-config.yml"
SET TARGET_DIR=C:\Windows\System32\config\systemprofile\.cloudflared
SET TARGET_CONFIG=%TARGET_DIR%\config.yml

echo Step 1: Create config directory if not exists...
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo Step 2: Copy updated cloudflared config...
if not exist %SOURCE_CONFIG% (
    echo ERROR: Source config not found at %SOURCE_CONFIG%
    pause
    exit /b 1
)

copy /Y %SOURCE_CONFIG% "%TARGET_CONFIG%"
if %errorLevel% NEQ 0 (
    echo ERROR: Failed to copy config file.
    echo Make sure you are running as Administrator.
    pause
    exit /b 1
)

echo.
echo ✓ Config copied to %TARGET_CONFIG%
echo.

echo Step 3: Copy credentials (if not already there)...
if exist "C:\Users\%USERNAME%\.cloudflared\f7706eef-df45-4902-b75f-45d641cd8e56.json" (
    copy /Y "C:\Users\%USERNAME%\.cloudflared\f7706eef-df45-4902-b75f-45d641cd8e56.json" "%TARGET_DIR%\" >nul 2>&1
    echo ✓ Credentials copied
)
if exist "C:\Users\%USERNAME%\.cloudflared\cert.pem" (
    copy /Y "C:\Users\%USERNAME%\.cloudflared\cert.pem" "%TARGET_DIR%\" >nul 2>&1
)

echo.
echo Step 4: Restart cloudflared service...
sc query cloudflared >nul 2>&1
if %errorLevel% EQU 0 (
    echo Stopping service...
    sc stop cloudflared >nul
    timeout /t 3 /nobreak >nul
    echo Starting service...
    sc start cloudflared >nul
    timeout /t 2 /nobreak >nul
    sc query cloudflared | findstr "RUNNING" >nul
    if %errorLevel% EQU 0 (
        echo ✓ Service is RUNNING
    ) else (
        echo ✗ Service failed to start. Check Event Viewer for errors.
    )
) else (
    echo ⚠ cloudflared service not installed.
    echo Run: cloudflared service install
)

echo.
echo ================================================================
echo  Fix complete.
echo  The tunnel now forwards traffic to http://127.0.0.1:5001
echo  (Express backend) instead of port 9000 (Tally).
echo ================================================================
echo.
echo Verify:
echo   1. curl https://erp.majesticmall.net/api/health
echo   2. Should return: {"ok":true,"status":"running",...}
echo.
pause
