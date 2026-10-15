"""ORM 模型。表结构变更一律走 Alembic 迁移（migrations/versions），不要依赖 create_all。"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, ForeignKey, Identity, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Postgres 上是 BIGINT + JSONB；单元测试用的 SQLite 自动退化成 INTEGER + JSON
BigIntPK = BigInteger().with_variant(Integer(), "sqlite")
JSONType = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class DecisionLog(Base):
    """每一次通过平台发起的决策：实验台、场景、鲁棒性实验室。人工标注后可以转成评测用例。"""

    __tablename__ = "decision_logs"

    id: Mapped[int] = mapped_column(BigIntPK, Identity(), primary_key=True)
    source: Mapped[str] = mapped_column(String(32), index=True)  # playground | scenario:<id> | lab | api
    title: Mapped[str] = mapped_column(String(200), default="")
    state: Mapped[Any] = mapped_column(JSONType)  # 字符串或 JSON 对象
    questions: Mapped[dict[str, Any]] = mapped_column(JSONType)
    answers: Mapped[dict[str, Any]] = mapped_column(JSONType)
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    model_step: Mapped[int | None] = mapped_column(Integer)
    labels: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)  # 问题名 → 正确答案
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Suite(Base):
    """评测集：一组带标准答案的决策用例。"""

    __tablename__ = "suites"

    id: Mapped[int] = mapped_column(BigIntPK, Identity(), primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(32), default="custom")
    tags: Mapped[list[str]] = mapped_column(JSONType, default=list)
    builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Case(Base):
    """评测用例，格式与 CJ-Bench 一致：state + questions + gold（每个问题一个标准答案或概率分布）。"""

    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(BigIntPK, Identity(), primary_key=True)
    suite_id: Mapped[int] = mapped_column(ForeignKey("suites.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(128), default="")
    state: Mapped[Any] = mapped_column(JSONType)
    questions: Mapped[dict[str, Any]] = mapped_column(JSONType)
    gold: Mapped[dict[str, Any]] = mapped_column(JSONType)
    meta: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Run(Base):
    """一次评测运行。metrics 在运行结束时一次性写入。"""

    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(BigIntPK, Identity(), primary_key=True)
    suite_id: Mapped[int | None] = mapped_column(ForeignKey("suites.id", ondelete="SET NULL"), index=True)
    suite_name: Mapped[str] = mapped_column(String(120), default="")
    name: Mapped[str] = mapped_column(String(160), default="")
    status: Mapped[str] = mapped_column(
        String(16), default="queued", index=True
    )  # queued|running|completed|failed|cancelled
    config: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    model: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)  # 运行时的检查点信息
    total: Mapped[int] = mapped_column(Integer, default=0)  # 决策数（问题数）
    done: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[int] = mapped_column(Integer, default=0)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    duration_ms: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RunResult(Base):
    """评测运行里每个问题的结果：保留原始 logits，温度校准和阈值分析都在它上面做。"""

    __tablename__ = "run_results"

    id: Mapped[int] = mapped_column(BigIntPK, Identity(), primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    case_id: Mapped[int | None] = mapped_column(BigIntPK)
    question: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(8))
    keys: Mapped[list[str]] = mapped_column(JSONType)
    target: Mapped[list[float]] = mapped_column(JSONType)
    logits: Mapped[list[float]] = mapped_column(JSONType, default=list)
    probabilities: Mapped[list[float]] = mapped_column(JSONType, default=list)
    prediction: Mapped[str] = mapped_column(String(128), default="")
    hard: Mapped[bool] = mapped_column(Boolean, default=True)
    correct: Mapped[bool | None] = mapped_column(Boolean)
    p_max: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    tag: Mapped[str] = mapped_column(String(64), default="")
    llm: Mapped[dict[str, Any] | None] = mapped_column(JSONType)  # 对照大模型的结果
    error: Mapped[str] = mapped_column(Text, default="")


class BenchRun(Base):
    """一次压测（或一次并发扫描）。"""

    __tablename__ = "bench_runs"

    id: Mapped[int] = mapped_column(BigIntPK, Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), default="")
    config: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    summary: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
