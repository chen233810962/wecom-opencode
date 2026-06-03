@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-bridge.ps1"
if %errorlevel% equ 0 (
    echo Done.
) else (
    echo [FAIL] Exit code: %errorlevel%
)
pause
