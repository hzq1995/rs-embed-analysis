$ErrorActionPreference = "Stop"

# 前后端一键启动脚本（Windows 局域网访问版）
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\start_front_backend_lan_windows.ps1
#   $env:LAN_IP="192.168.1.10"; powershell -ExecutionPolicy Bypass -File .\start_front_backend_lan_windows.ps1

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = $ScriptDir
$FrontendDir = Join-Path $ScriptDir "react-google-earth-test"
$Pids = New-Object System.Collections.Generic.List[int]

function Write-Info($Message) {
    Write-Host "[INFO] $Message" -ForegroundColor Yellow
}

function Write-Success($Message) {
    Write-Host "[Success] $Message" -ForegroundColor Green
}

function Write-ErrorAndExit($Message) {
    Write-Host "[Error] $Message" -ForegroundColor Red
    exit 1
}

function Find-FreePort([int]$StartPort) {
    $port = $StartPort
    while ($true) {
        $inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $inUse) {
            return $port
        }
        Write-Info "端口 $port 已被占用，尝试 $($port + 1)..."
        $port++
    }
}

function Get-LanIp {
    if ($env:LAN_IP) {
        return $env:LAN_IP
    }

    $candidate = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.PrefixOrigin -ne "WellKnown"
        } |
        Sort-Object -Property InterfaceMetric, SkipAsSource |
        Select-Object -First 1 -ExpandProperty IPAddress

    if ($candidate) {
        return $candidate
    }

    return $null
}

function Stop-Processes {
    if ($Pids.Count -eq 0) {
        return
    }

    Write-Info "正在清理进程..."
    foreach ($pid in $Pids) {
        try {
            $process = Get-Process -Id $pid -ErrorAction Stop
            Write-Info "停止进程 PID: $pid"
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
        } catch {
        }
    }
    Write-Success "所有进程已清理"
}

if (-not (Test-Path $BackendDir -PathType Container)) {
    Write-ErrorAndExit "后端目录不存在: $BackendDir"
}

if (-not (Test-Path $FrontendDir -PathType Container)) {
    Write-ErrorAndExit "前端目录不存在: $FrontendDir"
}

$LanIp = Get-LanIp
if (-not $LanIp) {
    Write-ErrorAndExit "无法自动探测本机局域网 IP。可先设置环境变量 LAN_IP 后重试。"
}

$BackendBindHost = "0.0.0.0"
$FrontendBindHost = "0.0.0.0"
$BackendPort = Find-FreePort 8000
$FrontendPort = Find-FreePort 5173
$BackendUrl = "http://$LanIp`:$BackendPort"
$FrontendUrl = "http://$LanIp`:$FrontendPort"
$AllowedOrigins = "$FrontendUrl,http://localhost:$FrontendPort,http://127.0.0.1:$FrontendPort"
$BackendLog = Join-Path $env:TEMP "backend_$BackendPort.log"
$FrontendLog = Join-Path $env:TEMP "frontend_$FrontendPort.log"

Write-Success "启动前后端服务（Windows 局域网访问模式）..."
Write-Info "检测到本机局域网 IP: $LanIp"

try {
    Write-Info "启动后端服务 (FastAPI)..."
    $backendCommand = "Set-Location '$BackendDir'; " +
        "`$env:ALLOWED_ORIGINS='$AllowedOrigins'; " +
        "uvicorn backend.app.main:app --host $BackendBindHost --port $BackendPort --reload *> '$BackendLog'"
    $backendProc = Start-Process powershell -ArgumentList @(
        "-NoProfile",
        "-Command",
        $backendCommand
    ) -PassThru -WindowStyle Hidden
    $Pids.Add($backendProc.Id)
    Write-Success "后端已启动 (PID: $($backendProc.Id), 端口: $BackendPort)"

    Write-Info "启动前端服务 (React + Vite)..."
    if (-not (Test-Path (Join-Path $FrontendDir "node_modules") -PathType Container)) {
        Write-Info "安装前端依赖..."
        Push-Location $FrontendDir
        try {
            npm install
        } finally {
            Pop-Location
        }
    }

    $frontendCommand = "Set-Location '$FrontendDir'; " +
        "`$env:VITE_API_BASE_URL='$BackendUrl'; " +
        "npm run dev -- --host $FrontendBindHost --port $FrontendPort --strictPort *> '$FrontendLog'"
    $frontendProc = Start-Process powershell -ArgumentList @(
        "-NoProfile",
        "-Command",
        $frontendCommand
    ) -PassThru -WindowStyle Hidden
    $Pids.Add($frontendProc.Id)
    Write-Success "前端已启动 (PID: $($frontendProc.Id), 端口: $FrontendPort)"

    Write-Host ""
    Write-Success "所有服务已启动！"
    Write-Info "后端日志: $BackendLog"
    Write-Info "前端日志: $FrontendLog"
    Write-Info "后端监听: http://$BackendBindHost`:$BackendPort"
    Write-Info "前端监听: http://$FrontendBindHost`:$FrontendPort"
    Write-Info "局域网前端访问地址: $FrontendUrl"
    Write-Info "本次前端将请求: $BackendUrl"
    Write-Info "本次后端允许来源: $AllowedOrigins"
    Write-Host ""
    Write-Info "局域网其它机器请访问: $FrontendUrl"
    Write-Info "按 Ctrl+C 停止所有服务..."
    Write-Host ""

    while ($true) {
        Start-Sleep -Seconds 2
        foreach ($pid in @($Pids)) {
            if (-not (Get-Process -Id $pid -ErrorAction SilentlyContinue)) {
                throw "检测到子进程已退出，请检查日志。"
            }
        }
    }
} catch {
    Write-Host "[Error] $($_.Exception.Message)" -ForegroundColor Red
} finally {
    Stop-Processes
}
