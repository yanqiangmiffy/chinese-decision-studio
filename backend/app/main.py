"""FastAPI 入口：生命周期、CORS、异常映射、路由注册。"""

import asyncio
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app import mcp_server
from app.config import get_settings
from app.db.session import dispose_engine
from app.deps import get_decision_client, get_eval_runner, get_llm_service
from app.log import setup_logging
from app.routers import bench, decide, health, history, runs, suites
from app.services.decision_client import DecisionRejected, DecisionUnavailable

settings = get_settings()
setup_logging(settings.LOG_LEVEL)
mcp_asgi = mcp_server.build_http_app(settings) if settings.MCP_ENABLED else None


async def _warmup() -> None:
    """启动后在后台确认依赖状态，不阻塞启动。"""
    decision = await get_decision_client().health(ttl=0)
    llm_ok = await get_llm_service().available()
    logger.info(
        "启动完成 | 决策服务：{} | 对照大模型：{}",
        f"在线（step {decision.get('step')}）" if decision else f"不可达（{settings.DECISION_BASE_URL}）",
        "可用" if llm_ok else "未启用或不可达",
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    runner = get_eval_runner()
    try:
        await runner.recover()
    except Exception:  # noqa: BLE001
        logger.exception("恢复评测运行状态失败（数据库可能还没迁移）")
    task = asyncio.create_task(_warmup())
    async with AsyncExitStack() as stack:
        if mcp_asgi is not None:
            await stack.enter_async_context(mcp_server.mcp.session_manager.run())
        yield
    task.cancel()
    await runner.shutdown()
    await get_decision_client().close()
    await get_llm_service().close()
    await dispose_engine()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Chinese Decision 决策模型测试平台：实验台、场景库、鲁棒性实验室、评测中心、压测",
    lifespan=lifespan,
    # 后端的一切都在 /api 下：前端自己有 /docs 页面，nginx 也只需要反代 /api
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(DecisionUnavailable)
async def _unavailable(_: Request, __: DecisionUnavailable) -> JSONResponse:
    return JSONResponse({"detail": "决策服务暂时不可用，请检查服务状态后重试"}, status_code=503)


@app.exception_handler(DecisionRejected)
async def _rejected(_: Request, exc: DecisionRejected) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=422)


for module in (health, decide, history, suites, runs, bench):
    app.include_router(module.router)

# MCP：和平台共用 /api 前缀，nginx 不需要额外配置；lifespan 里启动 session manager
if mcp_asgi is not None:
    app.mount("/api/mcp", mcp_server.MCPAuthMiddleware(mcp_asgi, settings.MCP_AUTH_TOKEN))


# 非容器部署时可以让后端直接托管前端构建产物（STATIC_DIR=../frontend/dist）；容器里由 nginx 托管
_static = Path(settings.STATIC_DIR) if settings.STATIC_DIR else None
if _static and (_static / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=_static / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def _spa(path: str) -> FileResponse:
        candidate = _static / path
        if path and candidate.is_file() and _static in candidate.resolve().parents:
            return FileResponse(candidate)
        return FileResponse(_static / "index.html")
