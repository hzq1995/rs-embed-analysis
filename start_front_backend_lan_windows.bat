@echo off
setlocal

REM Windows 双击启动脚本（局域网访问版）
REM 直接双击即可；内部调用 PowerShell 执行主脚本

set "SCRIPT_DIR=%~dp0"
set "PS1_SCRIPT=%SCRIPT_DIR%start_front_backend_lan_windows.ps1"

if not exist "%PS1_SCRIPT%" (
  echo [Error] 未找到脚本: "%PS1_SCRIPT%"
  pause
  exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
  echo [Error] 未找到 PowerShell，无法启动。
  pause
  exit /b 1
)

echo [INFO] 正在启动局域网前后端服务...
echo [INFO] 如首次运行被系统拦截，请允许 PowerShell 执行。
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1_SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [Error] 启动脚本退出，退出码: %EXIT_CODE%
) else (
  echo [Success] 启动脚本已结束。
)

pause
exit /b %EXIT_CODE%
