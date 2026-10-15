# 常用命令。Windows 上没有 make 的话，直接复制每条命令执行即可。
.PHONY: help up down logs ps restart deploy-model dev-backend dev-frontend test lint build seed screenshots

help:          ## 列出所有命令
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

up:            ## 一键启动平台（Postgres + 后端 + 前端）
	docker compose up -d --build

down:          ## 停止（数据卷保留）
	docker compose down

logs:          ## 跟踪后端日志
	docker compose logs -f backend

ps:            ## 查看容器状态
	docker compose ps

restart:       ## 改了 .env 之后重启后端
	docker compose up -d backend

deploy-model:  ## 部署 / 重启 GPU 服务器上的决策服务
	./decision-service/deploy.sh

dev-backend:   ## 本地跑后端（默认用 backend/.env 里的 DATABASE_URL）
	cd backend && uvicorn app.main:app --reload --port 8090

dev-frontend:  ## 本地跑前端（Vite 把 /api 代理到 localhost:8090）
	cd frontend && npm run dev

test:          ## 后端测试（不依赖任何外部服务）
	cd backend && python -m pytest

lint:          ## 后端 ruff + 前端类型检查和 oxlint
	cd backend && ruff check . && ruff format --check .
	cd frontend && npm run typecheck && npm run lint

build:         ## 前端生产构建
	cd frontend && npm run build

seed:          ## 导入内置评测集（幂等）
	docker compose exec backend python -m app.scripts.seed

screenshots:   ## 重新生成 README 截图（RUN=评测运行 id）
	python scripts/screenshots.py --run $(RUN)
