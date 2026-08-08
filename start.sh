#!/bin/bash
set -e

# ── Colors ──
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    Muse Studio — 启动脚本               ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Kill existing processes ──
echo -e "${YELLOW}[1/5] 清理端口...${NC}"
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:3001 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:3002 2>/dev/null | xargs kill -9 2>/dev/null || true
echo -e "${GREEN}  ✓ 端口 3000, 3001, 3002 已释放${NC}"
echo ""

# ── 2. Check .env ──
echo -e "${YELLOW}[2/5] 检查环境变量...${NC}"
ENV_FILE="$ROOT_DIR/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}  ✗ 未找到 $ENV_FILE${NC}"
  echo -e "${YELLOW}    请创建文件并填入 AI_API_KEY:${NC}"
  echo "    echo 'AI_API_KEY=your-api-key' > $ENV_FILE"
  exit 1
fi
# 检查是否填了真正的 key（不是占位符）
KEY=$(grep -E '^(AI_API_KEY|DEEPSEEK_API_KEY)=' "$ENV_FILE" | tail -n 1 | cut -d= -f2-)
if [ -z "$KEY" ] || [ "$KEY" = "your-api-key" ] || [ "$KEY" = "sk-your-deepseek-api-key-here" ]; then
  echo -e "${RED}  ✗ AI_API_KEY 未设置或为占位值${NC}"
  echo -e "${YELLOW}    请在 $ENV_FILE 中填入你的 Team Router API Key${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ 环境变量就绪${NC}"
echo ""

# ── 3. Install dependencies ──
echo -e "${YELLOW}[3/5] 检查依赖...${NC}"
if [ ! -d "$ROOT_DIR/backend/node_modules" ]; then
  echo "  安装后端依赖..."
  cd "$ROOT_DIR/backend" && npm install --legacy-peer-deps --silent
  echo -e "${GREEN}  ✓ 后端依赖已安装${NC}"
else
  echo -e "${GREEN}  ✓ 后端依赖已存在${NC}"
fi

if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  echo "  安装前端依赖..."
  cd "$ROOT_DIR/frontend" && npm install --legacy-peer-deps --silent
  echo -e "${GREEN}  ✓ 前端依赖已安装${NC}"
else
  echo -e "${GREEN}  ✓ 前端依赖已存在${NC}"
fi

if [ ! -d "$ROOT_DIR/sandbox/node_modules" ]; then
  echo "  安装沙箱依赖..."
  cd "$ROOT_DIR/sandbox" && npm install --legacy-peer-deps --silent
  echo -e "${GREEN}  ✓ 沙箱依赖已安装${NC}"
else
  echo -e "${GREEN}  ✓ 沙箱依赖已存在${NC}"
fi

# 确保 data 目录存在
mkdir -p "$ROOT_DIR/backend/data"
echo ""

# ── 4. Build backend services ──
echo -e "${YELLOW}[4/5] 构建后端服务...${NC}"
cd "$ROOT_DIR/sandbox" && npm run build 2>&1 | sed 's/^/  /'
echo -e "${GREEN}  ✓ 沙箱构建完成${NC}"
cd "$ROOT_DIR/backend" && npx nest build 2>&1 | sed 's/^/  /'
echo -e "${GREEN}  ✓ 后端构建完成${NC}"
echo ""

# ── 5. Start services ──
echo -e "${YELLOW}[5/5] 启动服务...${NC}"
echo ""

# Start sandbox service (background)
cd "$ROOT_DIR/sandbox"
node dist/service.js 2>&1 &
SANDBOX_PID=$!

sleep 2

# Start backend (foreground — logs show here)
cd "$ROOT_DIR/backend"
npx nest start 2>&1 &
BACKEND_PID=$!

# Wait for backend to be ready
sleep 3

# Start frontend in development mode for Fast Refresh
cd "$ROOT_DIR/frontend"
npx next dev --port 3000 2>&1 &
FRONTEND_PID=$!

sleep 2

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   🚀 服务启动成功！                       ║${NC}"
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}║   前端:  http://localhost:3000             ║${NC}"
echo -e "${GREEN}║   后端:  http://localhost:3001             ║${NC}"
echo -e "${GREEN}║   沙箱:  http://localhost:3002             ║${NC}"
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}║   管理后台: http://localhost:3000/admin    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}按 Ctrl+C 停止所有服务${NC}"
echo ""

# Trap Ctrl+C to clean up both processes
trap "echo ''; echo -e '${YELLOW}正在停止服务...${NC}'; kill $SANDBOX_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null; wait; echo -e '${GREEN}已停止${NC}'; exit 0" SIGINT SIGTERM

# Wait for backend (foreground) — its logs stream to terminal
wait $BACKEND_PID
