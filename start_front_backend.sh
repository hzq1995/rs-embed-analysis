#!/bin/bash

# 前后端一键启动脚本
# 此脚本会启动后端 FastAPI 服务和前端 React 开发服务器
# 退出时会自动清理所有子进程

set -e

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 定义后端和前端目录
BACKEND_DIR="$SCRIPT_DIR"
FRONTEND_DIR="$SCRIPT_DIR/react-google-earth-test"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 进程 ID 数组
declare -a PIDS=()

# 清理函数：杀死所有子进程
cleanup() {
    echo -e "\n${YELLOW}[INFO]${NC} 正在清理进程..."
    
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            echo -e "${YELLOW}[INFO]${NC} 停止进程 PID: $pid"
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done
    
    # 等待子进程结束
    sleep 1
    
    # 强制杀死仍然存活的进程
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
    done
    
    echo -e "${GREEN}[Success]${NC} 所有进程已清理"
    exit 0
}

# 捕获信号
trap cleanup SIGINT SIGTERM EXIT

# 检查目录是否存在
if [ ! -d "$BACKEND_DIR" ]; then
    echo -e "${RED}[Error]${NC} 后端目录不存在: $BACKEND_DIR"
    exit 1
fi

if [ ! -d "$FRONTEND_DIR" ]; then
    echo -e "${RED}[Error]${NC} 前端目录不存在: $FRONTEND_DIR"
    exit 1
fi

echo -e "${GREEN}[Start]${NC} 启动前后端服务..."

# 启动后端服务
echo -e "${YELLOW}[INFO]${NC} 启动后端服务 (FastAPI)..."
cd "$BACKEND_DIR"

# 检查是否安装了依赖
if [ ! -d "venv" ] && [ ! -d ".venv" ]; then
    echo -e "${YELLOW}[INFO]${NC} 未检测到虚拟环境，尝试直接运行..."
fi

# 使用 uvicorn 启动后端
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
PIDS+=($BACKEND_PID)
echo -e "${GREEN}[Success]${NC} 后端已启动 (PID: $BACKEND_PID, 端口: 8000)"

# 启动前端服务
echo -e "${YELLOW}[INFO]${NC} 启动前端服务 (React + Vite)..."
cd "$FRONTEND_DIR"

# 检查是否安装了依赖
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[INFO]${NC} 安装前端依赖..."
    npm install
fi

# 启动前端开发服务器
npm run dev > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
PIDS+=($FRONTEND_PID)
echo -e "${GREEN}[Success]${NC} 前端已启动 (PID: $FRONTEND_PID)"

# 输出日志文件位置
echo -e "\n${GREEN}[Success]${NC} 所有服务已启动！"
echo -e "${YELLOW}[INFO]${NC} 后端日志: /tmp/backend.log"
echo -e "${YELLOW}[INFO]${NC} 前端日志: /tmp/frontend.log"
echo -e "${YELLOW}[INFO]${NC} 后端地址: http://localhost:8000"
echo -e "${YELLOW}[INFO]${NC} 前端地址: http://localhost:5173 (或显示的其他端口)"
echo -e "\n${YELLOW}[INFO]${NC} 按 Ctrl+C 停止所有服务...\n"

# 等待所有后台进程
wait
