#!/usr/bin/env bash
# Local convenience: start in live mode using the LLM and Tencent ASR variables
# already present in a sibling interview-assistant checkout. Only these
# server-side variables are read; they are never printed, copied into this
# repo, or sent to the browser.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF_ENV="${INTERVIEW_ASSISTANT_ENV:-$ROOT/../file/proiect/interview-assistant/backend/.env}"

if [[ -f "$REF_ENV" ]]; then
  eval "$(grep -E '^(QWEN_API_KEY|QWEN_BASE_URL|QWEN_MODEL|ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL|DEEPSEEK_MODEL|TENCENT_ASR_APP_ID|TENCENT_ASR_SECRET_ID|TENCENT_ASR_SECRET_KEY)=' "$REF_ENV" | sed 's/^/export /')"
else
  echo "未找到参考环境文件：$REF_ENV"
  echo "可以设置 INTERVIEW_ASSISTANT_ENV，或直接 export LLM_* 变量后运行 ./scripts/dev.sh"
fi

export APP_MODE=live
exec "$ROOT/scripts/dev.sh"
