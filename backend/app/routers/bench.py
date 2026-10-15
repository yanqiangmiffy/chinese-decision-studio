"""压测：SSE 实时推送；结束后写一条压测记录。"""

from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import BenchRun
from app.db.session import get_db, get_sessionmaker
from app.deps import get_decision_client
from app.schemas.api import BenchRequest
from app.services.bench_service import PRESETS, run_bench
from app.services.decision_client import DecisionClient
from app.services.decision_math import options_for
from app.utils.sse import SSE_DONE, SSE_HEADERS, sse

router = APIRouter(prefix="/api/bench", tags=["bench"])


@router.get("/presets")
async def presets() -> list[dict[str, Any]]:
    return [{"id": k, "label": v["label"], "body": v["body"]} for k, v in PRESETS.items()]


@router.post("")
async def bench(req: BenchRequest, client: DecisionClient = Depends(get_decision_client)) -> StreamingResponse:
    settings = get_settings()
    if req.body:
        body = req.body
        questions = body.get("questions")
        if body.get("state") is None or not isinstance(questions, dict) or not questions:
            raise HTTPException(422, "自定义请求体需要 state 和非空的 questions")
        try:
            for q in questions.values():
                options_for(q)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        label = "自定义请求"
    else:
        if req.preset not in PRESETS:
            raise HTTPException(422, "未知的预设")
        body, label = PRESETS[req.preset]["body"], PRESETS[req.preset]["label"]
    levels = req.sweep or [req.concurrency]
    if max(levels) > settings.BENCH_MAX_CONCURRENCY or req.total * len(levels) > settings.BENCH_MAX_REQUESTS:
        raise HTTPException(
            422, f"并发上限 {settings.BENCH_MAX_CONCURRENCY}，总请求数上限 {settings.BENCH_MAX_REQUESTS}"
        )
    config = {
        "preset": req.preset if not req.body else None,
        "label": label,
        "levels": levels,
        "total": req.total,
        "questions": len(body["questions"]),
        "sweep": bool(req.sweep),
    }

    async def events() -> AsyncIterator[str]:
        summary = None
        try:
            async for event in run_bench(client, {"body": body, "levels": levels, "total": req.total}):
                if event["type"] == "summary":
                    summary = event
                yield sse(event)
        except Exception:  # noqa: BLE001
            logger.exception("压测失败")
            yield sse({"type": "error", "message": "压测出错，详情见服务日志"})
        if summary:
            async with get_sessionmaker()() as session:
                record = BenchRun(
                    name=req.name or f"{label} · 并发 {'/'.join(map(str, levels))}",
                    config=config,
                    summary={k: v for k, v in summary.items() if k != "type"},
                )
                session.add(record)
                await session.commit()
                yield sse({"type": "saved", "id": record.id})
        yield SSE_DONE

    return StreamingResponse(events(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/history")
async def bench_history(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    rows = (await db.scalars(select(BenchRun).order_by(BenchRun.id.desc()).limit(30))).all()
    return [
        {"id": r.id, "name": r.name, "config": r.config, "summary": r.summary, "created_at": r.created_at} for r in rows
    ]


@router.delete("/history/{bench_id}")
async def delete_bench(bench_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    await db.execute(delete(BenchRun).where(BenchRun.id == bench_id))
    await db.commit()
    return {"ok": True}
