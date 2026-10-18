"""测试夹具：不依赖任何外部服务——决策服务和对照大模型用假的，数据库用临时 SQLite 文件。"""

import os
import tempfile
from typing import Any

_DB = os.path.join(tempfile.mkdtemp(prefix="studio-test-"), "test.db")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB}"
os.environ["DECISION_ADMIN_TOKEN"] = ""
os.environ["LLM_BASE_URL"] = ""

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db.models import Base  # noqa: E402
from app.db.session import get_sessionmaker  # noqa: E402
from app.deps import get_decision_client, get_eval_runner, get_llm_service  # noqa: E402
from app.main import app  # noqa: E402
from app.services.decision_client import DecisionRejected  # noqa: E402
from app.services.decision_math import hmm_confidence, options_for, softmax, text  # noqa: E402
from app.services.eval_service import EvalRunner  # noqa: E402


class FakeDecision:
    """可预测的假决策服务：候选键或描述出现在上下文里，就给它更高的 logit。"""

    base_url = "http://fake-decision"
    can_reload = False

    def __init__(self) -> None:
        self.calls: list[str] = []

    def _answer(self, state: Any, question: dict[str, Any]) -> dict[str, Any]:
        options = options_for(question)
        content = text(state)
        logits = [3.0 if (k in content or v in content) else 0.0 for k, v in options]
        if question["type"] == "noul":
            logits = [0.0, 3.0] if "是" in content or "true" in content else [3.0, 0.0]
        probabilities = softmax(logits)
        answer = {
            "type": question["type"],
            "probabilities": {k: p for (k, _), p in zip(options, probabilities, strict=True)},
            "confidence": hmm_confidence(probabilities),
            "logits": {k: x for (k, _), x in zip(options, logits, strict=True)},
            "input_tokens": 10,
        }
        best = max(range(len(options)), key=probabilities.__getitem__)
        if question["type"] == "noul":
            answer["noul"] = probabilities[1]
        elif question["type"] == "choice":
            answer["choice"] = options[best][0]
        else:
            answer["score"] = sum(i * p for i, p in enumerate(probabilities))
            answer["legend"] = dict(options)
        return answer

    def _response(self, body: dict[str, Any]) -> dict[str, Any]:
        try:
            answers = {n: self._answer(body["state"], q) for n, q in body["questions"].items()}
        except ValueError as exc:
            raise DecisionRejected(str(exc)) from exc
        return {
            "model": "fake",
            "answers": answers,
            "usage": {"input_tokens": 10 * len(answers), "output_tokens": 0},
            "latency_ms": 5.0,
        }

    async def decide(self, body: dict[str, Any], debug: bool = True) -> dict[str, Any]:
        self.calls.append("decide")
        return self._response(body)

    async def batch(self, requests: list[dict[str, Any]], debug: bool = True) -> dict[str, Any]:
        self.calls.append("batch")
        results = []
        for r in requests:
            try:
                results.append(self._response(r))
            except DecisionRejected as exc:
                results.append({"error": str(exc)})
        return {
            "model": "fake",
            "results": results,
            "usage": {"input_tokens": 1, "output_tokens": 0},
            "decisions": sum(len(r["questions"]) for r in requests),
            "latency_ms": 7.0,
        }

    async def tournament(self, body: dict[str, Any]) -> dict[str, Any]:
        """不分组：把全部候选当成一题打分，只模拟返回格式。"""
        self.calls.append("tournament")
        criteria = body["question"]["criteria"]
        content = text(body["state"])
        probabilities = softmax([3.0 if (k in content or v in content) else 0.0 for k, v in criteria.items()])
        best = max(range(len(criteria)), key=probabilities.__getitem__)
        return {
            "model": "fake",
            "answer": {
                "type": "choice",
                "probabilities": dict(zip(criteria, probabilities, strict=True)),
                "confidence": hmm_confidence(probabilities),
                "choice": list(criteria)[best],
            },
            "candidates": len(criteria),
            "group_size": body["group_size"],
            "keep": body["keep"],
            "rounds": [],
            "usage": {"input_tokens": 10, "output_tokens": 0},
            "decisions": 1,
            "latency_ms": 6.0,
        }

    async def compile(self, body: dict[str, Any]) -> dict[str, Any]:
        return {
            "prompt_version": "hmm-zh-v1",
            "questions": {n: {"prompt": "…", "input_tokens": 10, "options": []} for n in body["questions"]},
        }

    async def info(self) -> dict[str, Any]:
        return {
            "model": "fake",
            "checkpoint": {"step": 6000},
            "prompt_version": "hmm-zh-v1",
            "stats": {"avg_forward_batch": 1.0},
        }

    async def training(self) -> dict[str, Any]:
        return {"available": False}

    async def health(self, ttl: float = 5.0) -> dict[str, Any] | None:
        return {"status": "ok", "step": 6000, "rtt_ms": 1.0}

    async def reload(self) -> dict[str, Any]:
        return {"reloaded": False}

    async def close(self) -> None:
        return None


class FakeLLM:
    model = "fake-llm"
    configured = False

    async def available(self) -> bool:
        return False

    async def close(self) -> None:
        return None


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def client():
    engine = get_sessionmaker().kw["bind"]
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    fake = FakeDecision()
    llm = FakeLLM()
    runner = EvalRunner(fake, llm, get_sessionmaker(), get_settings())  # type: ignore[arg-type]
    app.dependency_overrides[get_decision_client] = lambda: fake
    app.dependency_overrides[get_llm_service] = lambda: llm
    app.dependency_overrides[get_eval_runner] = lambda: runner
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        http.fake = fake  # type: ignore[attr-defined]
        http.runner = runner  # type: ignore[attr-defined]
        yield http
    app.dependency_overrides.clear()
