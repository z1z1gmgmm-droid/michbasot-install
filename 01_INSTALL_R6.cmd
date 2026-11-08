@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL_R6.ps1"
if errorlevel 1 (
  echo INSTALL STOPPED. See the result file in Notepad. No manual copying.
  pause
  exit /b 1
)
echo INSTALL SUCCESS. Restart the office app.
pause
