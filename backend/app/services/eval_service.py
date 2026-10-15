"""评测运行：后台任务分批调用 /v1/batch，逐批写结果、推送进度，结束时一次性算完整报告。

- 进度通过进程内的发布/订阅推给 SSE（GET /api/runs/{id}/events）；
- 每批结果立即落库，服务中途重启时，启动阶段会把"运行中"的记录标成失败；
- 后台任务自己开数据库会话，不复用请求级会话。
"""

import asyncio
import random
import time
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.db.models import Case, Run, RunResult
from app.services.decision_client import DecisionClient, DecisionUnavailable
from app.services.decision_math import hmm_confidence, options_for, prediction_of, softmax, target_for
from app.services.llm_service import LLMService
from app.services.metrics import compare_llm, summarize_run

TERMINAL = ("completed", "failed", "cancelled")


def result_row(r: RunResult) -> dict[str, Any]:
    return {
        "id": r.id,
        "case_id": r.case_id,
        "question": r.question,
        "kind": r.kind,
        "keys": r.keys,
        "target": r.target,
        "logits": r.logits,
        "probabilities": r.probabilities,
        "prediction": r.prediction,
        "hard": r.hard,
        "correct": r.correct,
        "p_max": r.p_max,
        "confidence": r.confidence,
        "tag": r.tag,
        "llm": r.llm,
        "error": r.error,
    }


class EvalRunner:
    def __init__(
        self,
        client: DecisionClient,
        llm: LLMService,
        sessionmaker: async_sessionmaker[AsyncSession],
        settings: Settings,
    ):
        self.client = client
        self.llm = llm
        self.sessionmaker = sessionmaker
        self.settings = settings
        self.tasks: dict[int, asyncio.Task] = {}
        self.cancelled: set[int] = set()
        self.subscribers: dict[int, set[asyncio.Queue]] = defaultdict(set)
        self.snapshots: dict[int, dict[str, Any]] = {}

    # ------------------------------------------------------------------ 发布 / 订阅
    def subscribe(self, run_id: int) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        self.subscribers[run_id].add(queue)
        return queue

    def unsubscribe(self, run_id: int, queue: asyncio.Queue) -> None:
        self.subscribers[run_id].discard(queue)

    def publish(self, run_id: int, event: dict[str, Any]) -> None:
        self.snapshots[run_id] = event
        for queue in list(self.subscribers[run_id]):
            if queue.full():
                queue.get_nowait()  # 慢订阅者丢最旧的进度帧；终态帧是最后一帧，不会被丢
            queue.put_nowait(event)

    def snapshot(self, run_id: int) -> dict[str, Any] | None:
        return self.snapshots.get(run_id)

    # ------------------------------------------------------------------ 生命周期
    async def recover(self) -> None:
        """服务启动时：上次没跑完的运行标记为失败。"""
        async with self.sessionmaker() as session:
            await session.execute(
                update(Run)
                .where(Run.status.in_(("queued", "running")))
                .values(status="failed", error="平台服务重启，运行被中断", finished_at=datetime.now(UTC))
            )
            await session.commit()

    def start(self, run_id: int) -> None:
        task = asyncio.create_task(self._run(run_id), name=f"eval-run-{run_id}")
        self.tasks[run_id] = task
        task.add_done_callback(lambda _: self.tasks.pop(run_id, None))

    def cancel(self, run_id: int) -> bool:
        if run_id in self.tasks:
            self.cancelled.add(run_id)
            return True
        return False

    async def shutdown(self) -> None:
        for task in list(self.tasks.values()):
            task.cancel()

    # ------------------------------------------------------------------ 主流程
    async def _set(self, run_id: int, **values: Any) -> None:
        async with self.sessionmaker() as session:
            await session.execute(update(Run).where(Run.id == run_id).values(**values))
            await session.commit()

    async def _run(self, run_id: int) -> None:
        started = time.perf_counter()
        try:
            async with self.sessionmaker() as session:
                run = await session.get(Run, run_id)
                if run is None:
                    return
                cases = list(await session.scalars(select(Case).where(Case.suite_id == run.suite_id).order_by(Case.id)))
                config = dict(run.config or {})
            temperature = float(config.get("temperature") or 1.0)
            limit = config.get("limit")
            if limit:
                cases = cases[: int(limit)]
            total = sum(len(c.questions) for c in cases)
            try:
                info = await self.client.info()
                model = {**info.get("checkpoint", {}), "prompt_version": info.get("prompt_version")}
            except DecisionUnavailable:
                model = {}
            await self._set(run_id, status="running", total=total, model=model)
            self.publish(
                run_id,
                {
                    "type": "progress",
                    "status": "running",
                    "phase": "decision",
                    "done": 0,
                    "total": total,
                    "correct": 0,
                    "hard": 0,
                    "elapsed_ms": 0,
                },
            )

            rows: list[dict[str, Any]] = []
            done = correct = hard_seen = errors = 0
            size = self.settings.EVAL_BATCH_SIZE
            for start in range(0, len(cases), size):
                if run_id in self.cancelled:
                    raise asyncio.CancelledError
                chunk = cases[start : start + size]
                response = await self.client.batch(
                    [{"state": c.state, "questions": c.questions} for c in chunk], debug=True
                )
                records = []
                for case, result in zip(chunk, response["results"], strict=True):
                    tag = str((case.meta or {}).get("tag") or "")
                    for name, question in case.questions.items():
                        record = self._evaluate(run_id, case, name, question, result, temperature, tag)
                        records.append(record)
                        done += 1
                        if record.error:
                            errors += 1
                            continue
                        if record.hard:
                            hard_seen += 1
                            correct += int(bool(record.correct))
                async with self.sessionmaker() as session:
                    session.add_all(records)
                    await session.commit()
                    rows.extend(result_row(r) for r in records)
                await self._set(run_id, done=done, errors=errors)
                self.publish(
                    run_id,
                    {
                        "type": "progress",
                        "status": "running",
                        "phase": "decision",
                        "done": done,
                        "total": total,
                        "correct": correct,
                        "hard": hard_seen,
                        "errors": errors,
                        "elapsed_ms": 1000 * (time.perf_counter() - started),
                    },
                )

            decision_seconds = time.perf_counter() - started  # 吞吐只算决策模型这一段，不含大模型对照
            ok_rows = [r for r in rows if not r["error"]]
            if config.get("compare_llm") and ok_rows and await self.llm.available():
                await self._compare_llm(run_id, cases, ok_rows, started)

            metrics = summarize_run(ok_rows)
            metrics["llm"] = compare_llm(ok_rows)
            metrics["throughput"] = {"decisions": done, "seconds": decision_seconds}
            duration = 1000 * (time.perf_counter() - started)
            await self._set(
                run_id, status="completed", metrics=metrics, duration_ms=duration, finished_at=datetime.now(UTC)
            )
            self.publish(
                run_id, {"type": "done", "status": "completed", "done": done, "total": total, "elapsed_ms": duration}
            )
        except asyncio.CancelledError:
            await self._set(
                run_id,
                status="cancelled",
                finished_at=datetime.now(UTC),
                duration_ms=1000 * (time.perf_counter() - started),
            )
            self.publish(run_id, {"type": "done", "status": "cancelled"})
        except DecisionUnavailable:
            await self._set(
                run_id, status="failed", error="决策服务不可达，请检查服务状态后重试", finished_at=datetime.now(UTC)
            )
            self.publish(run_id, {"type": "done", "status": "failed", "error": "决策服务不可达"})
        except Exception:  # noqa: BLE001
            logger.exception("评测运行 {} 失败", run_id)
            await self._set(
                run_id, status="failed", error="评测运行出错，详情见服务日志", finished_at=datetime.now(UTC)
            )
            self.publish(run_id, {"type": "done", "status": "failed", "error": "评测运行出错"})
        finally:
            self.cancelled.discard(run_id)

    def _evaluate(self, run_id, case, name, question, result, temperature, tag) -> RunResult:
        base = {
            "run_id": run_id,
            "case_id": case.id,
            "question": name,
            "kind": str(question.get("type", "")),
            "tag": tag[:64],
        }
        try:
            options = options_for(question)
            keys = [k for k, _ in options]
            target = target_for(case.gold.get(name), keys, question["type"])
        except (ValueError, TypeError, AttributeError) as exc:
            return RunResult(**base, keys=[], target=[], error=f"用例不合法：{exc}")
        if "error" in result:
            return RunResult(**base, keys=keys, target=target, error=str(result["error"])[:500])
        answer = result["answers"][name]
        logits = [float(answer["logits"][k]) for k in keys]
        probabilities = softmax(logits, temperature)
        prediction = prediction_of(question["type"], keys, probabilities)
        hard = max(target) >= 1 - 1e-6
        label = keys[max(range(len(target)), key=target.__getitem__)]
        return RunResult(
            **base,
            keys=keys,
            target=target,
            logits=logits,
            probabilities=probabilities,
            prediction=prediction,
            hard=hard,
            correct=(prediction == label) if hard else None,
            p_max=max(probabilities),
            confidence=hmm_confidence(probabilities),
        )

    async def _compare_llm(self, run_id: int, cases: list[Case], rows: list[dict[str, Any]], started: float) -> None:
        by_case = {c.id: c for c in cases}
        pool = list(rows)
        limit = self.settings.LLM_EVAL_LIMIT
        if len(pool) > limit:
            pool = random.Random(run_id).sample(pool, limit)
        semaphore = asyncio.Semaphore(self.settings.LLM_CONCURRENCY)
        finished = 0

        async def one(row: dict[str, Any]) -> None:
            nonlocal finished
            case = by_case[row["case_id"]]
            async with semaphore:
                try:
                    row["llm"] = await self.llm.decide(case.state, case.questions[row["question"]])
                except Exception as exc:  # noqa: BLE001
                    logger.info("对照大模型调用失败：{!r}", exc)
                    row["llm"] = None
            finished += 1
            if finished % 5 == 0 or finished == len(pool):
                self.publish(
                    run_id,
                    {
                        "type": "progress",
                        "status": "running",
                        "phase": "llm",
                        "done": finished,
                        "total": len(pool),
                        "elapsed_ms": 1000 * (time.perf_counter() - started),
                    },
                )

        await asyncio.gather(*(one(r) for r in pool))
        async with self.sessionmaker() as session:
            for row in pool:
                if row.get("llm"):
                    await session.execute(update(RunResult).where(RunResult.id == row["id"]).values(llm=row["llm"]))
            await session.commit()
