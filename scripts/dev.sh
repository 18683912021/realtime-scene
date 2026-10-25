#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
BACK_PID=""
FRONT_PID=""

cleanup() {
  if [[ -n "$FRONT_PID" ]] && kill -0 "$FRONT_PID" 2>/dev/null; then
    kill "$FRONT_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACK_PID" ]] && kill -0 "$BACK_PID" 2>/dev/null; then
    kill "$BACK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ ! -d "$BACKEND/.venv" ]]; then
  echo "→ 创建 Python 虚拟环境并安装依赖…"
  python3 -m venv "$BACKEND/.venv"
  "$BACKEND/.venv/bin/pip" install --upgrade pip -q
  "$BACKEND/.venv/bin/pip" install -r "$BACKEND/requirements.txt" -q
fi

if [[ ! -d "$FRONTEND/node_modules" ]]; then
  echo "→ 安装前端依赖…"
  (cd "$FRONTEND" && npm install)
fi

if [[ ! -f "$FRONTEND/public/assets/manifest.json" ]]; then
  echo "→ 生成原型素材…"
  python3 "$ROOT/scripts/generate_assets.py"
fi

echo "→ 启动 Mira 后端 http://127.0.0.1:8000"
(cd "$BACKEND" && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000) &
BACK_PID=$!

echo "→ 启动前端 http://127.0.0.1:5173"
(cd "$FRONTEND" && npm run dev -- --host 127.0.0.1) &
FRONT_PID=$!

echo ""
echo "  雨停之前 · MIRA"
echo "  打开 http://127.0.0.1:5173"
echo "  模式：${APP_MODE:-auto}（auto：有 LLM Key 时为 LIVE，否则为 MOCK）"
echo "  Ctrl+C 同时停止两端。"
echo ""

wait
