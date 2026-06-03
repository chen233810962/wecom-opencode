@echo off
chcp 65001 >nul
echo ========================================
echo   WeCom SDK Bridge
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Checking config...
if not exist "config.json" (
    echo [ERROR] config.json not found!
    echo.
    echo Please copy config.example.json to config.json and edit it.
    pause
    exit /b 1
)

echo [2/2] Starting bridge service...
echo.

node index.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Bridge exited with code: %errorlevel%
    pause
    exit /b %errorlevel%
)

pause
