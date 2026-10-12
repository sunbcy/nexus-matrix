# ============================================================
# Nexus Matrix - One-Click Startup Script (Windows PowerShell)
# Ports are configured in the .env file at project root
# ============================================================

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$EnvFile = Join-Path $RootDir ".env"

# --- Load .env configuration ---
$backendPort = "8010"
$frontendPort = "5180"

if (Test-Path $EnvFile) {
    Write-Host "Loading configuration from .env..." -ForegroundColor Cyan
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and $line -notmatch '^#' -and $line -match '^\s*([^=]+)\s*=\s*(.+)\s*$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")
            Set-Variable -Name $key -Value $value -Scope Script
        }
    }
    $backendPort = $BACKEND_PORT
    $frontendPort = $FRONTEND_PORT
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  NEXUS MATRIX - Starting..." -ForegroundColor Cyan
Write-Host "  Backend: http://localhost:$backendPort" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:$frontendPort" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# --- Check Python ---
Write-Host "`n[1/4] Checking Python environment..." -ForegroundColor Yellow
try {
    $pythonCmd = Get-Command python -ErrorAction Stop
    Write-Host "  Found: $($pythonCmd.Source)" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Python not found. Please install Python 3.11+" -ForegroundColor Red
    exit 1
}

# --- Activate venv and install backend deps ---
Write-Host "`n[2/4] Setting up backend..." -ForegroundColor Yellow
$venvActivate = Join-Path $BackendDir "venv\Scripts\Activate.ps1"
$venvPython = Join-Path $BackendDir "venv\Scripts\python.exe"

if (Test-Path $venvActivate) {
    Write-Host "  Activating virtual environment..." -ForegroundColor Green
    & $venvActivate
} else {
    Write-Host "  Creating virtual environment..." -ForegroundColor Yellow
    python -m venv (Join-Path $BackendDir "venv")
    & $venvActivate
}

Write-Host "  Installing Python dependencies..." -ForegroundColor Green
Set-Location $BackendDir
pip install -r requirements.txt -q

# --- Install frontend deps ---
Write-Host "`n[3/4] Setting up frontend..." -ForegroundColor Yellow
Set-Location $FrontendDir

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "  Installing frontend dependencies (yarn install)..." -ForegroundColor Green
    yarn install
} else {
    Write-Host "  Frontend dependencies already installed" -ForegroundColor Green
}

# --- Start backend server ---
Write-Host "`n[4/4] Starting services..." -ForegroundColor Yellow

Write-Host "  Starting backend server (http://localhost:$backendPort)..." -ForegroundColor Green
$backendJob = Start-Job -ScriptBlock {
    Set-Location $using:BackendDir
    $env:BACKEND_PORT = $using:backendPort
    & $using:venvPython main.py
}

Start-Sleep -Seconds 3

$backendCheck = Invoke-WebRequest -Uri "http://localhost:$backendPort/" -UseBasicParsing -ErrorAction SilentlyContinue
if ($backendCheck.StatusCode -eq 200) {
    Write-Host "  Backend is running!" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Backend may not have started properly" -ForegroundColor Yellow
}

Write-Host "  Starting frontend dev server (http://localhost:$frontendPort)..." -ForegroundColor Green
Set-Location $FrontendDir
yarn dev

Write-Host "`nStopping backend service..." -ForegroundColor Yellow
Stop-Job $backendJob
Remove-Job $backendJob
Write-Host "All services stopped" -ForegroundColor Cyan
