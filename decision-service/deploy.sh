#!/usr/bin/env bash
# 从本机把决策服务部署到 GPU 服务器并（重新）启动。
#
#   ./decision-service/deploy.sh                 # 默认：gpu-server.example.com:22，GPU 2，端口 8003
#   GPU=5 PORT=8013 ./decision-service/deploy.sh
#
# 提示词编译器直接取自 chinese-decision 仓库的 decision 包（CHINESE_DECISION 指向它），
# 保证服务和训练、评测用的是同一份代码。
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
HOST=${HOST:-user@gpu-server.example.com}
SSH_PORT=${SSH_PORT:-22}
KEY=${KEY:-$HOME/.ssh/id_ed25519}
REMOTE=${REMOTE:-/data/decision-service}
CHINESE_DECISION=${CHINESE_DECISION:-$HERE/../../chinese-decision}
SSH="ssh -i $KEY -o IdentitiesOnly=yes -p $SSH_PORT $HOST"

$SSH "mkdir -p $REMOTE/decision $REMOTE/logs"
tar -C "$CHINESE_DECISION" -cf - decision/__init__.py decision/schema.py decision/model.py decision/api.py \
  | $SSH "tar -C $REMOTE -xf -"
tar -C "$HERE" -cf - serve.py run.sh start.sh snapshot.sh | $SSH "tar -C $REMOTE -xf - && sed -i 's/\r$//' $REMOTE/*.sh && chmod +x $REMOTE/*.sh"
$SSH "cd $REMOTE && ([ -f .admin-token ] || (head -c 18 /dev/urandom | base64 | tr -d '/+=' > .admin-token && chmod 600 .admin-token)) \
  && ./snapshot.sh && GPU=${GPU:-2} PORT=${PORT:-8003} ./start.sh"
echo "deployed to $HOST:$REMOTE — health: curl http://${HOST#*@}:${PORT:-8003}/health"
