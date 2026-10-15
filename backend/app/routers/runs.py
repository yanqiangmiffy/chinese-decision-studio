"""评测运行：创建、进度（SSE）、报告、逐题结果、取消、删除。"""

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Case, Run, RunResult, Suite
from app.db.session import get_db
from app.deps import get_eval_runner
from app.schemas.api import RunCreate
from app.services.eval_service import TERMINAL, EvalRunner, result_row
from app.utils.sse import SSE_DONE, SSE_HEADERS, sse

router = APIRouter(prefix="/api/runs", tags=["runs"])


def run_dict(r: Run, full: bool = False) -> dict[str, Any]:
    overall = (r.metrics or {}).get("overall") or {}
    data = {
        "id": r.id,
        "suite_id": r.suite_id,
        "suite_name": r.suite_name,
        "name": r.name,
        "status": r.status,
        "config": r.config,
        "model": r.model,
        "total": r.total,
        "done": r.done,
        "errors": r.errors,
        "error": r.error,
        "duration_ms": r.duration_ms,
        "created_at": r.created_at,
        "finished_at": r.finished_at,
        "accuracy": overall.get("accuracy"),
        "ece": overall.get("ece"),
        "nll": overall.get("nll"),
    }
    if full:
        data["metrics"] = r.metrics
    return data


@router.post("")
async def create_run(
    body: RunCreate, db: AsyncSession = Depends(get_db), runner: EvalRunner = Depends(get_eval_runner)
) -> dict[str, Any]:
    suite = await db.get(Suite, body.suite_id)
    if suite is None:
        raise HTTPException(404, "评测集不存在")
    if not await db.scalar(select(func.count()).select_from(Case).where(Case.suite_id == suite.id)):
        raise HTTPException(422, "评测集里还没有用例")
    run = Run(
        suite_id=suite.id,
        suite_name=suite.name,
        name=body.name or f"{suite.name} · T={body.temperature:g}",
        config={"temperature": body.temperature, "compare_llm": body.compare_llm, "limit": body.limit},
    )
    db.add(run)
    await db.commit()
    runner.start(run.id)
    return run_dict(run)


@router.get("")
async def list_runs(
    db: AsyncSession = Depends(get_db), suite_id: int | None = None, limit: int = Query(50, ge=1, le=200)
) -> list[dict[str, Any]]:
    query = select(Run).order_by(Run.id.desc()).limit(limit)
    if suite_id:
        query = query.where(Run.suite_id == suite_id)
    return [run_dict(r) for r in (await db.scalars(query)).all()]


@router.get("/{run_id}")
async def get_run(run_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    run = await db.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "运行不存在")
    return run_dict(run, full=True)


@router.get("/{run_id}/events")
async def run_events(
    run_id: int, db: AsyncSession = Depends(get_db), runner: EvalRunner = Depends(get_eval_runner)
) -> StreamingResponse:
    run = await db.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "运行不存在")
    status = run.status

    async def events() -> AsyncIterator[str]:
        if status in TERMINAL:
            yield sse({"type": "done", "status": status})
            yield SSE_DONE
            return
        queue = runner.subscribe(run_id)
        try:
            snapshot = runner.snapshot(run_id)
            if snapshot:
                yield sse(snapshot)
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    if run_id not in runner.tasks:
                        yield sse({"type": "done", "status": "unknown"})
                        break
                    continue
                yield sse(event)
                if event.get("type") == "done":
                    break
        finally:
            runner.unsubscribe(run_id, queue)
        yield SSE_DONE

    return StreamingResponse(events(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/{run_id}/results")
async def run_results(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    filter: str = Query("all", pattern="^(all|wrong|correct|uncertain|errors|disagree)$"),
    kind: str = Query("", pattern="^(|noul|choice|score)$"),
    tag: str = Query("", max_length=64),
    sort: str = Query("id", pattern="^(id|confidence|-confidence)$"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    query = select(RunResult).where(RunResult.run_id == run_id)
    if filter == "wrong":
        query = query.where(RunResult.correct.is_(False))
    elif filter == "correct":
        query = query.where(RunResult.correct.is_(True))
    elif filter == "uncertain":
        query = query.where(RunResult.p_max < 0.6, RunResult.error == "")
    elif filter == "errors":
        query = query.where(RunResult.error != "")
    if kind:
        query = query.where(RunResult.kind == kind)
    if tag:
        query = query.where(RunResult.tag == tag)
    order = {"id": RunResult.id, "confidence": RunResult.p_max, "-confidence": RunResult.p_max.desc()}[sort]
    rows = (await db.scalars(query.order_by(order))).all()
    if filter == "disagree":
        rows = [r for r in rows if r.llm and r.llm.get("prediction") != r.prediction]
    total = len(rows)
    rows = rows[(page - 1) * size : page * size]
    cases = {c.id: c for c in (await db.scalars(select(Case).where(Case.id.in_([r.case_id for r in rows])))).all()}
    items = []
    for r in rows:
        case = cases.get(r.case_id)
        items.append(
            {
                **result_row(r),
                "state": case.state if case else None,
                "question_body": case.questions.get(r.question) if case else None,
                "gold": case.gold.get(r.question) if case else None,
            }
        )
    return {"items": items, "total": total, "page": page, "size": size}


@router.post("/{run_id}/cancel")
async def cancel_run(run_id: int, runner: EvalRunner = Depends(get_eval_runner)) -> dict[str, bool]:
    return {"ok": runner.cancel(run_id)}


@router.delete("/{run_id}")
async def delete_run(
    run_id: int, db: AsyncSession = Depends(get_db), runner: EvalRunner = Depends(get_eval_runner)
) -> dict[str, bool]:
    if run_id in runner.tasks:
        raise HTTPException(409, "运行还没结束，请先取消")
    await db.execute(delete(RunResult).where(RunResult.run_id == run_id))
    await db.execute(delete(Run).where(Run.id == run_id))
    await db.commit()
    return {"ok": True}
