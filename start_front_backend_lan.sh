#!/bin/bash

# 前后端一键启动脚本（局域网访问版）
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

# 查找可用端口：从起始端口开始，找到第一个未被占用的端口
find_free_port() {
    local port=$1
    while ss -tlnH "sport = :$port" 2>/dev/null | grep -q ":$port"; do
        echo -e "${YELLOW}[INFO]${NC} 端口 $port 已被占用，尝试 $((port + 1))..." >&2
        port=$((port + 1))
    done
    echo "$port"
}

# 获取本机局域网 IPv4，优先使用默认路由出口地址
detect_lan_ip() {
    local ip

    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") {print $(i + 1); exit}}')
    if [ -n "$ip" ] && [[ "$ip" != 127.* ]]; then
        echo "$ip"
        return 0
    fi

    ip=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -vE '^(127\.|172\.17\.)' | head -n 1)
    if [ -n "$ip" ]; then
        echo "$ip"
        return 0
    fi

    return 1
}

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

LAN_IP="${LAN_IP:-$(detect_lan_ip || true)}"
if [ -z "$LAN_IP" ]; then
    echo -e "${RED}[Error]${NC} 无法自动探测本机局域网 IP"
    echo -e "${YELLOW}[INFO]${NC} 可手动设置环境变量后重试: LAN_IP=你的IP ./start_front_backend_lan.sh"
    exit 1
fi

BACKEND_BIND_HOST="0.0.0.0"
FRONTEND_BIND_HOST="0.0.0.0"

echo -e "${GREEN}[Start]${NC} 启动前后端服务（局域网访问模式）..."
echo -e "${YELLOW}[INFO]${NC} 检测到本机局域网 IP: ${LAN_IP}"

# 先确定本次启动要绑定的前后端端口，保证两边使用同一组配置
BACKEND_PORT=$(find_free_port 8000)
FRONTEND_PORT=$(find_free_port 5173)

BACKEND_URL="http://${LAN_IP}:${BACKEND_PORT}"
FRONTEND_URL="http://${LAN_IP}:${FRONTEND_PORT}"
ALLOWED_ORIGINS="${FRONTEND_URL},http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}"

# 启动后端服务
echo -e "${YELLOW}[INFO]${NC} 启动后端服务 (FastAPI)..."
cd "$BACKEND_DIR"

# 检查是否安装了依赖
if [ ! -d "venv" ] && [ ! -d ".venv" ]; then
    echo -e "${YELLOW}[INFO]${NC} 未检测到虚拟环境，尝试直接运行..."
fi

ALLOWED_ORIGINS="$ALLOWED_ORIGINS" \
uvicorn backend.app.main:app --host "$BACKEND_BIND_HOST" --port "$BACKEND_PORT" --reload > /tmp/backend_${BACKEND_PORT}.log 2>&1 &
BACKEND_PID=$!
PIDS+=($BACKEND_PID)
echo -e "${GREEN}[Success]${NC} 后端已启动 (PID: $BACKEND_PID, 端口: $BACKEND_PORT)"

# 启动前端服务
echo -e "${YELLOW}[INFO]${NC} 启动前端服务 (React + Vite)..."
cd "$FRONTEND_DIR"

# 检查是否安装了依赖
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[INFO]${NC} 安装前端依赖..."
    npm install
fi

VITE_API_BASE_URL="$BACKEND_URL" \
npm run dev -- --host "$FRONTEND_BIND_HOST" --port "$FRONTEND_PORT" --strictPort > /tmp/frontend_${FRONTEND_PORT}.log 2>&1 &
FRONTEND_PID=$!
PIDS+=($FRONTEND_PID)
echo -e "${GREEN}[Success]${NC} 前端已启动 (PID: $FRONTEND_PID, 端口: $FRONTEND_PORT)"

# 输出日志文件位置
echo -e "\n${GREEN}[Success]${NC} 所有服务已启动！"
echo -e "${YELLOW}[INFO]${NC} 后端日志: /tmp/backend_${BACKEND_PORT}.log"
echo -e "${YELLOW}[INFO]${NC} 前端日志: /tmp/frontend_${FRONTEND_PORT}.log"
echo -e "${YELLOW}[INFO]${NC} 后端监听: http://${BACKEND_BIND_HOST}:${BACKEND_PORT}"
echo -e "${YELLOW}[INFO]${NC} 前端监听: http://${FRONTEND_BIND_HOST}:${FRONTEND_PORT}"
echo -e "${YELLOW}[INFO]${NC} 局域网前端访问地址: ${FRONTEND_URL}"
echo -e "${YELLOW}[INFO]${NC} 本次前端将请求: ${BACKEND_URL}"
echo -e "${YELLOW}[INFO]${NC} 本次后端允许来源: ${ALLOWED_ORIGINS}"
echo -e "\n${YELLOW}[INFO]${NC} 局域网其它机器请访问: ${FRONTEND_URL}"
echo -e "${YELLOW}[INFO]${NC} 按 Ctrl+C 停止所有服务...\n"

# 等待所有后台进程
wait
