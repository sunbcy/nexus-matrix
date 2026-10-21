@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  Nexus Matrix backend launcher
echo ============================================

echo [1/2] Killing old backend on port 8010 (including uvicorn reloader parent)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $pp=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$_.OwningProcess)).ParentProcessId; Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue; if($pp){Stop-Process -Id $pp -Force -ErrorAction SilentlyContinue} }"
timeout /t 1 >nul

echo [2/2] Starting backend (FastAPI, 0.0.0.0:8010)...
cd /d "%~dp0backend"

REM Pick interpreter: prefer python, fall back to py
set PYEXE=python
where python >nul 2>&1 || set PYEXE=py

REM Uncomment the next line if you use a virtualenv:
REM call "%~dp0backend\venv\Scripts\activate.bat"

echo Using interpreter: %PYEXE%
%PYEXE% main.py

echo.
echo [backend exited] exit code %errorlevel%. Press any key to close...
pause

endlocal
