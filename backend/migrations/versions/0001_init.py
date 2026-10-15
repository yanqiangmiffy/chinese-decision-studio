"""init: decision_logs / suites / cases / runs / run_results / bench_runs

Revision ID: 0001
Revises:
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 和 app/db/models.py 保持一致：Postgres 上是 BIGINT + JSONB；SQLite 上退化成 INTEGER（才能自增）+ JSON
BigIntPK = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
JSONType = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _now() -> sa.sql.elements.ColumnElement:
    return sa.func.now()


def upgrade() -> None:
    # 决策历史：实验台、场景、实验室发起的每一次决策
    op.create_table(
        "decision_logs",
        sa.Column("id", BigIntPK, sa.Identity(), primary_key=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("title", sa.String(200), nullable=False, server_default=""),
        sa.Column("state", JSONType, nullable=False),
        sa.Column("questions", JSONType, nullable=False),
        sa.Column("answers", JSONType, nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("model_step", sa.Integer(), nullable=True),
        sa.Column("labels", JSONType, nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
    )
    op.create_index("ix_decision_logs_source", "decision_logs", ["source"])
    op.create_index("ix_decision_logs_created_at", "decision_logs", ["created_at"])

    # 评测集与用例（格式与 CJ-Bench 一致）
    op.create_table(
        "suites",
        sa.Column("id", BigIntPK, sa.Identity(), primary_key=True),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.String(32), nullable=False, server_default="custom"),
        sa.Column("tags", JSONType, nullable=False),
        sa.Column("builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
    )
    op.create_table(
        "cases",
        sa.Column("id", BigIntPK, sa.Identity(), primary_key=True),
        sa.Column("suite_id", BigIntPK, sa.ForeignKey("suites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("state", JSONType, nullable=False),
        sa.Column("questions", JSONType, nullable=False),
        sa.Column("gold", JSONType, nullable=False),
        sa.Column("meta", JSONType, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
    )
    op.create_index("ix_cases_suite_id", "cases", ["suite_id"])

    # 评测运行与逐题结果（保留 logits，温度校准和阈值分析都基于它）
    op.create_table(
        "runs",
        sa.Column("id", BigIntPK, sa.Identity(), primary_key=True),
        sa.Column("suite_id", BigIntPK, sa.ForeignKey("suites.id", ondelete="SET NULL"), nullable=True),
        sa.Column("suite_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("name", sa.String(160), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("config", JSONType, nullable=False),
        sa.Column("model", JSONType, nullable=False),
        sa.Column("total", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("done", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("errors", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("metrics", JSONType, nullable=False),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("duration_ms", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_runs_suite_id", "runs", ["suite_id"])
    op.create_index("ix_runs_status", "runs", ["status"])
    op.create_index("ix_runs_created_at", "runs", ["created_at"])
    op.create_table(
        "run_results",
        sa.Column("id", BigIntPK, sa.Identity(), primary_key=True),
        sa.Column("run_id", BigIntPK, sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("case_id", BigIntPK, nullable=True),
        sa.Column("question", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("keys", JSONType, nullable=False),
        sa.Column("target", JSONType, nullable=False),
        sa.Column("logits", JSONType, nullable=False),
        sa.Column("probabilities", JSONType, nullable=False),
        sa.Column("prediction", sa.String(128), nullable=False, server_default=""),
        sa.Column("hard", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("correct", sa.Boolean(), nullable=True),
        sa.Column("p_max", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("tag", sa.String(64), nullable=False, server_default=""),
        sa.Column("llm", JSONType, nullable=True),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_run_results_run_id", "run_results", ["run_id"])

    # 压测记录
    op.create_table(
        "bench_runs",
        sa.Column("id", BigIntPK, sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False, server_default=""),
        sa.Column("config", JSONType, nullable=False),
        sa.Column("summary", JSONType, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
    )
    op.create_index("ix_bench_runs_created_at", "bench_runs", ["created_at"])


def downgrade() -> None:
    for table in ("bench_runs", "run_results", "runs", "cases", "suites", "decision_logs"):
        op.drop_table(table)
