"""请求模型：和前端的契约。响应大多直接透传决策服务的格式（hmm / System One），不在这里重复定义。"""

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

TestName = Literal["order", "naming", "distractor", "injection", "paraphrase"]


class DecideRequest(BaseModel):
    state: Any = Field(..., description="上下文：字符串或 JSON")
    questions: dict[str, dict[str, Any]] = Field(..., min_length=1, max_length=64)
    source: str = Field("playground", max_length=32, description="playground | scenario:<id> | lab")
    title: str = Field("", max_length=200)
    log: bool = Field(True, description="是否写入历史记录")
    compare_llm: bool = Field(False, description="同时用对照大模型回答（逐题调用）")


class BatchRequest(BaseModel):
    requests: list[dict[str, Any]] = Field(..., min_length=1, max_length=512)
    source: str = Field("scenario", max_length=32)


class TournamentRequest(BaseModel):
    state: Any
    question: dict[str, Any] = Field(..., description="choice 问题，候选数可以超过 26")
    group_size: int = Field(16, ge=3, le=26, description="每组最多几个候选；默认 16，即训练覆盖的最大候选数")
    keep: int = Field(2, ge=1, le=13, description="每组前几名晋级，不能超过 group_size // 2")
    seed: int = Field(0, ge=0, description="分组的随机种子")


class ExtractRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    types: dict[str, str] = Field(..., min_length=1, max_length=40, description="类型名 → 说明（说明可以为空串）")
    threshold: float = Field(0.0, ge=0.0, le=1.0, description="实体概率低于它就丢弃")

    @field_validator("types")
    @classmethod
    def _check_types(cls, types: dict[str, str]) -> dict[str, str]:
        for name, description in types.items():
            if not name.strip() or len(name) > 40:
                raise ValueError("类型名不能为空，且不超过 40 个字")
            if len(description) > 600:
                raise ValueError(f"类型“{name}”的说明超过 600 个字")
        return types


class UnifiedDecideRequest(BaseModel):
    state: Any
    questions: dict[str, dict[str, Any]] = Field(..., min_length=1, max_length=64)


class CompileRequest(BaseModel):
    state: Any
    questions: dict[str, dict[str, Any]] = Field(..., min_length=1, max_length=64)


class ExplainRequest(BaseModel):
    state: Any
    question: dict[str, Any]
    target: str | None = Field(None, description="要解释的候选项；默认解释当前胜出的候选（noul 解释 true）")


class RobustnessRequest(BaseModel):
    state: Any
    question: dict[str, Any]
    tests: list[TestName] = Field(default_factory=lambda: ["order", "naming", "distractor", "injection", "paraphrase"])
    paraphrases: list[str] = Field(default_factory=list, max_length=8)
    auto_paraphrase: bool = True


class LabelUpdate(BaseModel):
    labels: dict[str, Any] | None = None
    note: str | None = Field(None, max_length=2000)


class ToSuiteRequest(BaseModel):
    suite_id: int


class SuiteCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field("", max_length=2000)
    category: str = Field("custom", max_length=32)
    tags: list[str] = Field(default_factory=list)


class SuiteUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)
    tags: list[str] | None = None


class CaseIn(BaseModel):
    state: Any
    questions: dict[str, dict[str, Any]] = Field(..., min_length=1, max_length=64)
    gold: dict[str, Any]
    meta: dict[str, Any] = Field(default_factory=dict)
    external_id: str = ""


class RunCreate(BaseModel):
    suite_id: int
    name: str = Field("", max_length=160)
    temperature: float = Field(1.0, gt=0.05, le=10.0)
    compare_llm: bool = False
    limit: int | None = Field(None, ge=1, le=100000, description="只跑前 N 条用例（快速冒烟）")


class BenchRequest(BaseModel):
    preset: str | None = "ticket"
    body: dict[str, Any] | None = Field(None, description="自定义请求体；给了就忽略 preset")
    concurrency: int = Field(16, ge=1, le=512)
    total: int = Field(300, ge=1, le=100000)
    sweep: list[int] | None = Field(None, max_length=12, description="并发扫描：依次跑这些并发档位")
    name: str = Field("", max_length=160)
