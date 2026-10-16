@echo off
chcp 65001 >nul
cd /d "%~dp0"
if "%~1"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\set-wallpaper.ps1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\set-wallpaper.ps1" "%~1"
)
echo.
pause
