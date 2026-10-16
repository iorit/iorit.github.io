@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish.ps1"
echo.
if errorlevel 1 (
    echo [FAILED] See error message above.
) else (
    echo [DONE]
)
pause
