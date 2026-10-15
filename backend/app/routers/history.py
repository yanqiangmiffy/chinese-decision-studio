"""决策历史：浏览、标注正确答案、转成评测用例。"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Case, DecisionLog, Suite, utcnow
from app.db.session import get_db
from app.schemas.api import LabelUpdate, ToSuiteRequest
from app.services.decision_math import options_for, target_for

router = APIRouter(prefix="/api/history", tags=["history"])


def to_dict(log: DecisionLog, full: bool = True) -> dict[str, Any]:
    data = {
        "id": log.id,
        "source": log.source,
        "title": log.title,
        "state": log.state,
        "questions": log.questions,
        "answers": log.answers,
        "latency_ms": log.latency_ms,
        "input_tokens": log.input_tokens,
        "model_step": log.model_step,
        "labels": log.labels or {},
        "note": log.note,
        "created_at": log.created_at,
    }
    if not full and isinstance(log.state, str) and len(log.state) > 400:
        data["state"] = log.state[:400] + "…"
    return data


@router.get("")
async def list_history(
    db: AsyncSession = Depends(get_db),
    q: str = Query("", max_length=100),
    source: str = Query("", max_length=32),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    query = select(DecisionLog)
    if source:
        query = query.where(DecisionLog.source.startswith(source))
    if q:
        # JSON 列在 Postgres / SQLite 上都能 cast 成文本做模糊匹配
        query = query.where(or_(cast(DecisionLog.state, String).contains(q), DecisionLog.title.contains(q)))
    total = await db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = (await db.scalars(query.order_by(DecisionLog.id.desc()).offset((page - 1) * size).limit(size))).all()
    items = [to_dict(r, full=False) for r in rows]
    sources = (await db.execute(select(DecisionLog.source, func.count()).group_by(DecisionLog.source))).all()
    return {
        "items": items,
        "total": total,
        "page": page,
        "size": size,
        "sources": [{"source": s, "n": n} for s, n in sources],
    }


@router.get("/{log_id}")
async def get_history(log_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    log = await db.get(DecisionLog, log_id)
    if log is None:
        raise HTTPException(404, "记录不存在")
    return to_dict(log)


@router.patch("/{log_id}")
async def update_history(log_id: int, body: LabelUpdate, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    log = await db.get(DecisionLog, log_id)
    if log is None:
        raise HTTPException(404, "记录不存在")
    if body.labels is not None:
        for name, gold in body.labels.items():
            question = log.questions.get(name)
            if question is None:
                raise HTTPException(422, f"没有名为 {name} 的问题")
            try:
                target_for(gold, [k for k, _ in options_for(question)], question["type"])
            except ValueError as exc:
                raise HTTPException(422, f"问题 {name}：{exc}") from exc
        log.labels = {k: v for k, v in body.labels.items() if v is not None}
    if body.note is not None:
        log.note = body.note
    await db.commit()
    return to_dict(log)


@router.delete("/{log_id}")
async def delete_history(log_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    await db.execute(delete(DecisionLog).where(DecisionLog.id == log_id))
    await db.commit()
    return {"ok": True}


@router.post("/{log_id}/to-suite")
async def history_to_suite(log_id: int, body: ToSuiteRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """把一条已标注的历史记录加入评测集：只带上标注过的问题。"""
    log = await db.get(DecisionLog, log_id)
    suite = await db.get(Suite, body.suite_id)
    if log is None or suite is None:
        raise HTTPException(404, "记录或评测集不存在")
    labels = log.labels or {}
    if not labels:
        raise HTTPException(422, "请先标注至少一个问题的正确答案")
    case = Case(
        suite_id=suite.id,
        external_id=f"history-{log.id}",
        state=log.state,
        questions={k: v for k, v in log.questions.items() if k in labels},
        gold=labels,
        meta={"tag": log.source, "note": log.note},
    )
    db.add(case)
    suite.updated_at = utcnow()
    await db.commit()
    return {"case_id": case.id, "suite_id": suite.id}
