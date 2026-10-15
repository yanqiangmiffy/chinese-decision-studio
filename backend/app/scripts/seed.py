"""导入内置评测集：backend/data/suites/index.json 里列出的每个 JSONL。

幂等：评测集按 slug 判断，已存在就跳过（不会覆盖你在平台里改过的用例）。
文件不存在时跳过（例如 CJ-Bench 抽样需要先运行 scripts/sample_cj_bench.py 生成）。

  python -m app.scripts.seed
"""

import asyncio
import json
from pathlib import Path

from loguru import logger
from sqlalchemy import select

from app.db.models import Case, Suite
from app.db.session import dispose_engine, get_sessionmaker
from app.log import setup_logging
from app.services.suite_service import parse_upload

DATA = Path(__file__).resolve().parents[2] / "data" / "suites"


async def seed() -> None:
    index = json.loads((DATA / "index.json").read_text(encoding="utf-8"))
    async with get_sessionmaker()() as session:
        for item in index:
            path = DATA / item["file"]
            if await session.scalar(select(Suite.id).where(Suite.slug == item["slug"])):
                logger.info("评测集已存在，跳过：{}", item["name"])
                continue
            if not path.exists():
                logger.info("文件不存在，跳过：{}", path.name)
                continue
            result = parse_upload(path.name, path.read_bytes(), limit=100000)
            for error in result.errors:
                logger.warning("{} {}", path.name, error)
            suite = Suite(
                slug=item["slug"],
                name=item["name"],
                description=item.get("description", ""),
                category=item.get("category", "builtin"),
                tags=item.get("tags", []),
                builtin=True,
            )
            session.add(suite)
            await session.flush()
            session.add_all(Case(suite_id=suite.id, **c) for c in result.cases)
            await session.commit()
            logger.info("导入评测集 {}：{} 条（跳过 {} 条）", item["name"], len(result.cases), result.skipped)
    await dispose_engine()


if __name__ == "__main__":
    setup_logging()
    asyncio.run(seed())
