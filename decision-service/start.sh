#!/usr/bin/env bash
# 在 tmux 会话 decision 里启动服务（已在运行则先停掉）。查看日志：tmux attach -t decision 或 tail -f logs/serve.log
set -euo pipefail
cd "$(dirname "$0")"
SESSION=${SESSION:-decision}
tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" "GPU=${GPU:-2} PORT=${PORT:-8003} ./run.sh"
echo "started tmux session '$SESSION' (gpu=${GPU:-2}, port=${PORT:-8003})"
