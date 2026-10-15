"""健康检查、总览数据、模型信息与热更新。"""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import BenchRun, Case, DecisionLog, Run, Suite
from app.db.session import get_db, ping
from app.deps import get_decision_client, get_llm_service
from app.services.decision_client import DecisionClient, DecisionRejected, DecisionUnavailable
from app.services.llm_service import LLMService

router = APIRouter(prefix="/api", tags=["health"])


async def _optional(coro) -> Any:
    try:
        return await asyncio.wait_for(coro, timeout=8)
    except (DecisionUnavailable, DecisionRejected, TimeoutError):
        return None


@router.get("/health")
async def health(
    client: DecisionClient = Depends(get_decision_client), llm: LLMService = Depends(get_llm_service)
) -> dict[str, Any]:
    db_ok, decision, llm_ok = await asyncio.gather(ping(), client.health(), llm.available())
    return {
        "status": "ok" if db_ok else "degraded",
        "app": get_settings().APP_NAME,
        "version": get_settings().APP_VERSION,
        "database": db_ok,
        "decision": {"base_url": client.base_url, "online": decision is not None, **(decision or {})},
        "llm": {"configured": llm.configured, "online": llm_ok, "model": llm.model if llm.configured else None},
        "can_reload": client.can_reload,
    }


@router.get("/model/info")
async def model_info(client: DecisionClient = Depends(get_decision_client)) -> dict[str, Any]:
    return await client.info()


@router.get("/model/training")
async def model_training(client: DecisionClient = Depends(get_decision_client)) -> dict[str, Any]:
    return await client.training()


@router.post("/model/reload")
async def model_reload(client: DecisionClient = Depends(get_decision_client)) -> dict[str, Any]:
    if not client.can_reload:
        raise HTTPException(403, "平台没有配置 DECISION_ADMIN_TOKEN，不能热更新检查点")
    return await client.reload()


@router.get("/overview")
async def overview(
    db: AsyncSession = Depends(get_db),
    client: DecisionClient = Depends(get_decision_client),
    llm: LLMService = Depends(get_llm_service),
) -> dict[str, Any]:
    info, training, llm_ok = await asyncio.gather(
        _optional(client.info()), _optional(client.training()), llm.available()
    )
    now = datetime.now(UTC)
    since = now - timedelta(days=13)
    start_of_window = datetime(since.year, since.month, since.day, tzinfo=UTC)
    created = (await db.scalars(select(DecisionLog.created_at).where(DecisionLog.created_at >= start_of_window))).all()
    daily: dict[str, int] = {(start_of_window + timedelta(days=i)).strftime("%m-%d"): 0 for i in range(14)}
    for ts in created:
        ts = ts if ts.tzinfo else ts.replace(tzinfo=UTC)
        key = ts.astimezone(UTC).strftime("%m-%d")
        if key in daily:
            daily[key] += 1
    latencies = (await db.scalars(select(DecisionLog.latency_ms).order_by(DecisionLog.id.desc()).limit(200))).all()
    runs = (await db.scalars(select(Run).order_by(Run.id.desc()).limit(6))).all()
    best_bench = None
    for bench in (await db.scalars(select(BenchRun).order_by(BenchRun.id.desc()).limit(50))).all():
        best = (bench.summary or {}).get("best") or {}
        if best and (best_bench is None or best.get("decisions_per_s", 0) > best_bench["decisions_per_s"]):
            best_bench = {
                "decisions_per_s": best.get("decisions_per_s", 0),
                "concurrency": best.get("concurrency"),
                "p50": best.get("p50"),
                "created_at": bench.created_at,
            }
    return {
        "decision": info,
        "training": training,
        "llm": {"configured": llm.configured, "online": llm_ok, "model": llm.model if llm.configured else None},
        "platform": {
            "decisions_total": await db.scalar(select(func.count()).select_from(DecisionLog)) or 0,
            "decisions_14d": [{"day": k, "n": v} for k, v in daily.items()],
            "latency_p50_ms": sorted(latencies)[len(latencies) // 2] if latencies else None,
            "suites": await db.scalar(select(func.count()).select_from(Suite)) or 0,
            "cases": await db.scalar(select(func.count()).select_from(Case)) or 0,
            "runs": await db.scalar(select(func.count()).select_from(Run)) or 0,
            "best_bench": best_bench,
        },
        "recent_runs": [
            {
                "id": r.id,
                "name": r.name,
                "suite_name": r.suite_name,
                "status": r.status,
                "accuracy": ((r.metrics or {}).get("overall") or {}).get("accuracy"),
                "ece": ((r.metrics or {}).get("overall") or {}).get("ece"),
                "total": r.total,
                "created_at": r.created_at,
            }
            for r in runs
        ],
    }
