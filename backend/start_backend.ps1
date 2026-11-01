# Nexus Matrix 后端后台启动 + 实时看日志
# 用法：
#   在 backend 目录下右键「使用 PowerShell 运行」，或终端执行：
#   cd d:\PycharmProjects\nexus-matrix\backend; .\start_backend.ps1
# 说明：
#   - 先停掉任何在跑的 main.py（避免端口 8010 冲突）
#   - 后台 detached 启动（关掉这个终端窗口，后端依然运行）
#   - 启动后会「实时跟随」日志；按 Ctrl+C 只是停止看日志，后端不退出
#   - 想重新看日志：powershell -Command "Get-Content -Encoding utf8 -Wait backend.log"
#   - 想彻底停止后端：Stop-Process -Name python

# ---- 修复中文在 Windows 控制台（GBK / UTF-8）下的乱码 ----
$null = chcp 65001
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

# ---- 路径与环境 ----
$BackendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PyVenv     = Join-Path $BackendDir 'venv\Scripts\python.exe'
$LogPath    = Join-Path $BackendDir 'backend.log'
$env:NEXUS_API_KEY = 'Xz2lZyHjnAuYCzR_cPffdsaEdcIAYQcB7CHzfm428bw'
$env:STATIC_DIR    = 'D:\PycharmProjects\nexus-matrix\frontend\dist'
# 强制 Python 以 UTF-8 写日志，避免 backend.log 中文乱码（与下方 Get-Content -Encoding utf8 对应）
$env:PYTHONUTF8 = '1'

# ---- 停掉已有的 main.py 实例（按命令行匹配，不动别的 python / cloudflared）----
Get-CimInstance Win32_Process -Filter "name='python.exe'" | Where-Object {
    $_.CommandLine -like '*main.py*'
} | ForEach-Object {
    Write-Host "停止旧实例 PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# ---- 后台 detached 启动，日志写入 backend.log（用 cmd /c 合并 stdout+stderr，避免 PowerShell 限制）----
Write-Host "启动后端（日志 -> $LogPath）..."
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', ".\venv\Scripts\python.exe main.py > backend.log 2>&1" `
    -WorkingDirectory $BackendDir -WindowStyle Hidden

# ---- 等启动，确认端口/健康 ----
Start-Sleep -Seconds 12
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8010/api/health' -UseBasicParsing -TimeoutSec 10
    Write-Host "健康检查：$($r.Content)"
} catch {
    Write-Host "健康检查未通过（可能还在起）：$($_.Exception.Message)"
}

# ---- 实时跟随日志（Ctrl+C 退出跟随，后端继续跑；-Encoding utf8 保证中文不乱）----
Write-Host "`n===== 实时日志（Ctrl+C 停止查看，后端不会退出）=====`n"
Get-Content -Encoding utf8 -Path $LogPath -Wait
