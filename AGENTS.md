# AGENTS.md

写给编码智能体（Claude Code、Codex、Cursor……）的项目说明。人也可以读。

## 这是什么

Chinese Decision 决策模型的测试平台：FastAPI + React + SSE + PostgreSQL，`docker compose up -d --build` 一条命令启动。推理服务不在本仓库：它在 chinese-decision 仓库（GPU 版 `scripts/serve_gpu.py`，CPU 版 `scripts/serve.py`），平台通过 `DECISION_BASE_URL` 调用它。

## 目录地图

```text
backend/app/
├── main.py              # 入口：生命周期、异常映射、路由注册；Swagger 在 /api/docs
├── config.py            # 所有配置（pydantic-settings），都能被环境变量覆盖
├── deps.py              # 服务装配：懒加载单例，路由里用 Depends 注入
├── routers/             # 只做协议转换：校验入参、包装 SSE
├── services/
│   ├── decision_client.py   # 唯一调用决策服务的地方
│   ├── decision_math.py     # 题型展开、标准答案、softmax —— 与 chinese-decision 的 schema 保持一致
│   ├── metrics.py           # 评测指标（CJ-Bench 口径）、选择性预测、温度拟合
│   ├── eval_service.py      # 评测运行：后台任务 + 发布订阅
│   ├── analysis_service.py  # 证据归因、鲁棒性测试
│   ├── bench_service.py     # 压测
│   ├── llm_service.py       # 对照大模型（logprobs）
│   └── suite_service.py     # 评测集导入解析
├── db/                  # ORM 模型和会话；表结构变更走 backend/migrations
└── scripts/seed.py      # 导入内置评测集
backend/data/suites/     # 内置评测集；改用例改 build.py 再重新生成
frontend/src/
├── api.ts / types.ts    # 所有请求、SSE 解析、类型
├── lib/                 # decision.ts（题型、温度重算）、presets.ts、scenarios.ts、format.ts
├── components/          # ui.tsx、charts.tsx（手写 SVG）、decision.tsx
└── pages/               # 每个页面一个文件；场景在 pages/scenarios/
```

## 常用命令

```bash
cd backend && python -m pytest && ruff check . && ruff format --check .
cd frontend && npm run build && npm run lint
docker compose up -d --build
python scripts/screenshots.py --run <id>     # 重新生成 README 截图
```

## 必须遵守的约定

1. **提示词编译器只有一份**：决策服务直接用 chinese-decision 的 `decision` 包；后端 `decision_math.py` 里的 `options_for` / `user_prompt` 必须和它保持一致（`user_prompt` 只用于给对照大模型提问）。
2. **前端只请求相对路径 `/api`**；后端的一切（包括 Swagger）都在 `/api` 下，前端自己有 `/docs` 页面。
3. **数据库变更只能走 Alembic**；`alembic.ini` 只能写 ASCII。
4. **决策服务 / 大模型不可达时要降级**：决策服务挂了返回 503 和通用文案；大模型没配置或挂了，对照功能自动隐藏。
5. **后台任务和流式生成器里不要用请求级数据库会话**，自己开会话。
6. **配置一律走 `app/config.py`**，新增配置项要同时更新 `.env.example` 和 `docker-compose.yml` 的 `x-app-env`。
7. **场景里的问法要在真实模型上验证过**：改问法之前先用批量接口对比几种写法（见 README“实测发现”），把结论写进代码注释。
8. GPU 是共用的：压测、批量评测不要无节制地加大并发和 token 预算。
9. 不要提交 `.env`、`.admin-token` 和 CJ-Bench 抽样文件。

## 完成的定义

- `cd backend && python -m pytest` 全部通过，`ruff check .` 无报错；
- 改了前端：`cd frontend && npm run build` 通过；
- 改了决策服务：重新部署后 `curl $DECISION_BASE_URL/health` 正常，并在实验台跑一次；
- 改了行为：README / 文档页同步更新。
