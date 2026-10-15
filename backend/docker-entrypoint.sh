#!/bin/sh
set -e

# 迁移和种子数据只让 API 容器做；worker 复用同一镜像时设置 RUN_MIGRATIONS=false
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] alembic upgrade head"
  alembic upgrade head
  echo "[entrypoint] seed builtin suites"
  # 种子脚本是幂等的：重复执行不报错、不重复插数据，也不会覆盖你在后台改过的文档
  python -m app.scripts.seed
fi

# exec 让 uvicorn 接替成为 1 号进程，docker stop 时才能收到 SIGTERM 优雅退出
exec "$@"
