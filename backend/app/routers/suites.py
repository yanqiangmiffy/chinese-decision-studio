"""评测集与用例：增删改查、文件导入、导出。"""

import json
import re
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Case, Run, Suite, utcnow
from app.db.session import get_db
from app.schemas.api import CaseIn, SuiteCreate, SuiteUpdate
from app.services.suite_service import normalize, parse_upload

router = APIRouter(prefix="/api", tags=["suites"])


def suite_dict(s: Suite, stats: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": s.id,
        "slug": s.slug,
        "name": s.name,
        "description": s.description,
        "category": s.category,
        "tags": s.tags or [],
        "builtin": s.builtin,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
        **(stats or {}),
    }


def case_dict(c: Case) -> dict[str, Any]:
    return {
        "id": c.id,
        "suite_id": c.suite_id,
        "external_id": c.external_id,
        "state": c.state,
        "questions": c.questions,
        "gold": c.gold,
        "meta": c.meta or {},
        "created_at": c.created_at,
    }


async def _unique_slug(db: AsyncSession, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "suite"
    slug, i = base, 1
    while await db.scalar(select(Suite.id).where(Suite.slug == slug)):
        i += 1
        slug = f"{base}-{i}"
    return slug


async def _stats(db: AsyncSession, suite_ids: list[int]) -> dict[int, dict[str, Any]]:
    if not suite_ids:
        return {}
    counts = dict(
        (
            await db.execute(
                select(Case.suite_id, func.count()).where(Case.suite_id.in_(suite_ids)).group_by(Case.suite_id)
            )
        ).all()
    )
    kinds: dict[int, dict[str, int]] = {i: {} for i in suite_ids}
    for suite_id, questions in (
        await db.execute(select(Case.suite_id, Case.questions).where(Case.suite_id.in_(suite_ids)))
    ).all():
        for q in (questions or {}).values():
            kind = q.get("type", "?")
            kinds[suite_id][kind] = kinds[suite_id].get(kind, 0) + 1
    last_runs: dict[int, dict[str, Any]] = {}
    for run in (
        await db.scalars(
            select(Run).where(Run.suite_id.in_(suite_ids), Run.status == "completed").order_by(Run.id.desc())
        )
    ).all():
        if run.suite_id not in last_runs:
            overall = (run.metrics or {}).get("overall") or {}
            last_runs[run.suite_id] = {
                "id": run.id,
                "accuracy": overall.get("accuracy"),
                "ece": overall.get("ece"),
                "created_at": run.created_at,
            }
    return {
        i: {"case_count": counts.get(i, 0), "kinds": kinds.get(i, {}), "last_run": last_runs.get(i)} for i in suite_ids
    }


# ------------------------------------------------------------------ 评测集
@router.get("/suites")
async def list_suites(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    suites = (await db.scalars(select(Suite).order_by(Suite.builtin.desc(), Suite.id))).all()
    stats = await _stats(db, [s.id for s in suites])
    return [suite_dict(s, stats.get(s.id)) for s in suites]


@router.post("/suites")
async def create_suite(body: SuiteCreate, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    suite = Suite(
        slug=await _unique_slug(db, body.name),
        name=body.name,
        description=body.description,
        category=body.category,
        tags=body.tags,
    )
    db.add(suite)
    await db.commit()
    return suite_dict(suite, {"case_count": 0, "kinds": {}, "last_run": None})


@router.get("/suites/{suite_id}")
async def get_suite(suite_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    suite = await db.get(Suite, suite_id)
    if suite is None:
        raise HTTPException(404, "评测集不存在")
    return suite_dict(suite, (await _stats(db, [suite_id]))[suite_id])


@router.patch("/suites/{suite_id}")
async def update_suite(suite_id: int, body: SuiteUpdate, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    suite = await db.get(Suite, suite_id)
    if suite is None:
        raise HTTPException(404, "评测集不存在")
    for field in ("name", "description", "tags"):
        value = getattr(body, field)
        if value is not None:
            setattr(suite, field, value)
    suite.updated_at = utcnow()
    await db.commit()
    return suite_dict(suite)


@router.delete("/suites/{suite_id}")
async def delete_suite(suite_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    await db.execute(delete(Case).where(Case.suite_id == suite_id))
    await db.execute(delete(Suite).where(Suite.id == suite_id))
    await db.commit()
    return {"ok": True}


@router.post("/suites/import")
async def import_suite(
    file: UploadFile = File(...),
    name: str = Form("", max_length=120),
    description: str = Form("", max_length=2000),
    suite_id: int | None = Form(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """上传 JSONL / JSON / CSV。给了 suite_id 就追加到已有评测集，否则新建一个。"""
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(413, "文件不能超过 50 MB")
    result = parse_upload(file.filename or "upload.jsonl", data, get_settings().IMPORT_MAX_CASES)
    if not result.cases:
        raise HTTPException(422, {"message": "没有可导入的用例", "errors": result.errors})
    if suite_id:
        suite = await db.get(Suite, suite_id)
        if suite is None:
            raise HTTPException(404, "评测集不存在")
    else:
        title = name.strip() or (file.filename or "导入的评测集").rsplit(".", 1)[0]
        suite = Suite(slug=await _unique_slug(db, title), name=title, description=description, category="custom")
        db.add(suite)
        await db.flush()
    db.add_all(Case(suite_id=suite.id, **c) for c in result.cases)
    suite.updated_at = utcnow()
    await db.commit()
    return {"suite_id": suite.id, "imported": len(result.cases), "skipped": result.skipped, "errors": result.errors}


@router.get("/suites/{suite_id}/export")
async def export_suite(suite_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    suite = await db.get(Suite, suite_id)
    if suite is None:
        raise HTTPException(404, "评测集不存在")
    cases = (await db.scalars(select(Case).where(Case.suite_id == suite_id).order_by(Case.id))).all()
    lines = [
        json.dumps(
            {
                "id": c.external_id or str(c.id),
                "state": c.state,
                "questions": c.questions,
                "gold": c.gold,
                "meta": c.meta,
            },
            ensure_ascii=False,
        )
        for c in cases
    ]
    return Response(
        "\n".join(lines) + "\n",
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="{suite.slug}.jsonl"'},
    )


# ------------------------------------------------------------------ 用例
@router.get("/suites/{suite_id}/cases")
async def list_cases(
    suite_id: int,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
) -> dict[str, Any]:
    total = await db.scalar(select(func.count()).select_from(Case).where(Case.suite_id == suite_id)) or 0
    rows = (
        await db.scalars(
            select(Case).where(Case.suite_id == suite_id).order_by(Case.id).offset((page - 1) * size).limit(size)
        )
    ).all()
    return {"items": [case_dict(c) for c in rows], "total": total, "page": page, "size": size}


@router.post("/suites/{suite_id}/cases")
async def add_case(suite_id: int, body: CaseIn, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    suite = await db.get(Suite, suite_id)
    if suite is None:
        raise HTTPException(404, "评测集不存在")
    try:
        data = normalize(body.model_dump())
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    case = Case(suite_id=suite_id, **data)
    db.add(case)
    suite.updated_at = utcnow()
    await db.commit()
    return case_dict(case)


@router.get("/cases/{case_id}")
async def get_case(case_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    case = await db.get(Case, case_id)
    if case is None:
        raise HTTPException(404, "用例不存在")
    return case_dict(case)


@router.put("/cases/{case_id}")
async def update_case(case_id: int, body: CaseIn, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    case = await db.get(Case, case_id)
    if case is None:
        raise HTTPException(404, "用例不存在")
    try:
        data = normalize(body.model_dump())
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    for key, value in data.items():
        setattr(case, key, value)
    await db.commit()
    return case_dict(case)


@router.delete("/cases/{case_id}")
async def delete_case(case_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    await db.execute(delete(Case).where(Case.id == case_id))
    await db.commit()
    return {"ok": True}
