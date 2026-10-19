"""StartLux / Bamboo Relay 适配器：响应归一化、批量扇出、编译、分组淘汰、健康检查。"""

import json
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.services.decision_client import DecisionRejected, StartLuxDecisionClient

pytestmark = pytest.mark.anyio

MODEL = "startlux-decision-27b-autothink"


def settings(**overrides: Any) -> Settings:
    values = {
        "DECISION_BASE_URL": "https://startlux.test",
        "DECISION_API_STYLE": "startlux",
        "DECISION_API_KEY": "test-key",
        "DECISION_MODEL": MODEL,
        "DECISION_TIMEOUT": 30,
        "DECISION_CONCURRENCY": 2,
    }
    values.update(overrides)
    return Settings(**values)


class MockStartLux:
    def __init__(self, models: list[str] | None = None):
        self.models = models or [MODEL]
        self.requests: list[httpx.Request] = []

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.method == "GET" and request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": model} for model in self.models]})
        if request.method != "POST" or request.url.path != "/v1/systemone":
            return httpx.Response(404, json={"error": {"message": "not found"}})
        body = json.loads(request.content)
        answers = {}
        for name, question in body["questions"].items():
            if question["type"] == "noul":
                answers[name] = {"type": "noul", "noul": 0.75}
            elif question["type"] == "choice":
                keys = list(question["criteria"])
                rest = 0.2 / max(1, len(keys) - 1)
                answers[name] = {
                    "type": "choice",
                    "choice": keys[0],
                    "confidence": 0.9,
                    "none_probability": 0.01,
                    "probabilities": {key: (0.8 if index == 0 else rest) for index, key in enumerate(keys)},
                }
            else:
                keys = [str(index) for index in range(len(question["criteria"]))]
                rest = 0.75 / max(1, len(keys) - 1)
                answers[name] = {
                    "type": "score",
                    "score": 0.75,
                    "probabilities": {key: (0.25 if index == 0 else rest) for index, key in enumerate(keys)},
                }
        return httpx.Response(
            200,
            json={"model": MODEL, "answers": answers, "usage": {"input_tokens": 10, "output_tokens": 2}},
        )


async def test_startlux_decide_normalizes_answers():
    mock = MockStartLux()
    client = StartLuxDecisionClient(settings(), transport=httpx.MockTransport(mock))
    try:
        result = await client.decide(
            {
                "state": "客户要求退款",
                "questions": {
                    "team": {
                        "type": "choice",
                        "instructions": "哪个团队？",
                        "criteria": {"billing": "支付", "tech": "技术"},
                    },
                    "urgent": {"type": "noul", "instructions": "是否紧急？"},
                    "severity": {"type": "score", "instructions": "影响程度？", "criteria": ["低", "高"]},
                },
            }
        )
    finally:
        await client.close()

    assert result["model"] == MODEL
    assert result["latency_ms"] >= 0
    assert result["usage"] == {"input_tokens": 10, "output_tokens": 2}
    team = result["answers"]["team"]
    assert team["choice"] == "billing"
    assert set(team["probabilities"]) == {"billing", "tech"}
    assert set(team["logits"]) == {"billing", "tech"}
    assert 0 <= team["confidence"] <= 1
    urgent = result["answers"]["urgent"]
    assert urgent["noul"] == 0.75
    assert urgent["probabilities"] == {"false": pytest.approx(0.25), "true": pytest.approx(0.75)}
    assert urgent["logits"]["true"] < 0
    severity = result["answers"]["severity"]
    assert severity["score"] == 0.75
    assert severity["legend"] == {"0": "低", "1": "高"}


async def test_startlux_batch_fans_out_and_keeps_order():
    mock = MockStartLux()
    client = StartLuxDecisionClient(settings(), transport=httpx.MockTransport(mock))
    requests = [
        {"state": f"文本 {index}", "questions": {"q": {"type": "noul", "instructions": "是否？"}}} for index in range(3)
    ]
    try:
        result = await client.batch(requests)
    finally:
        await client.close()

    assert len(mock.requests) == 3
    assert len(result["results"]) == 3
    assert all("answers" in item for item in result["results"])
    assert result["usage"] == {"input_tokens": 30, "output_tokens": 6}
    assert result["decisions"] == 3
    assert result["model"] == MODEL


async def test_startlux_health_requires_model():
    mock = MockStartLux()
    client = StartLuxDecisionClient(settings(), transport=httpx.MockTransport(mock))
    try:
        health = await client.health(ttl=0)
    finally:
        await client.close()
    assert health is not None and health["status"] == "ok" and health["model"] == MODEL

    missing = MockStartLux(models=["some-other-model"])
    client = StartLuxDecisionClient(settings(), transport=httpx.MockTransport(missing))
    try:
        assert await client.health(ttl=0) is None
    finally:
        await client.close()


async def test_startlux_compile_is_local():
    mock = MockStartLux()
    client = StartLuxDecisionClient(settings(), transport=httpx.MockTransport(mock))
    try:
        result = await client.compile(
            {
                "state": "客户要求退款",
                "questions": {
                    "team": {
                        "type": "choice",
                        "instructions": "哪个团队？",
                        "criteria": {"billing": "支付", "tech": "技术"},
                    }
                },
            }
        )
    finally:
        await client.close()

    assert mock.requests == []
    assert result["prompt_version"].startswith("startlux-remote")
    question = result["questions"]["team"]
    assert question["prompt"].startswith("待判断的上下文")
    assert [item["letter"] for item in question["options"]] == ["A", "B"]
    assert question["options"][0]["key"] == "billing"


async def test_startlux_tournament_groups_then_final():
    mock = MockStartLux()
    client = StartLuxDecisionClient(settings(), transport=httpx.MockTransport(mock))
    question = {
        "type": "choice",
        "instructions": "哪个意图？",
        "criteria": {f"intent_{index}": f"意图 {index}" for index in range(5)},
    }
    try:
        result = await client.tournament({"state": "客户留言", "question": question, "group_size": 3, "keep": 1})
    finally:
        await client.close()

    assert result["candidates"] == 5
    assert result["group_size"] == 3
    assert result["keep"] == 1
    assert len(result["rounds"]) == 1
    assert len(result["rounds"][0]["groups"]) == 2
    assert all(len(group["advanced"]) == 1 for group in result["rounds"][0]["groups"])
    assert len(result["answer"]["probabilities"]) == 2
    assert result["decisions"] == 3
    assert len(mock.requests) == 3


async def test_startlux_rejects_score_over_ten_levels():
    mock = MockStartLux()
    client = StartLuxDecisionClient(settings(), transport=httpx.MockTransport(mock))
    question = {
        "type": "score",
        "instructions": "打分？",
        "criteria": [f"等级 {index}" for index in range(11)],
    }
    try:
        with pytest.raises(DecisionRejected, match="最多 10"):
            await client.decide({"state": "文本", "questions": {"q": question}})
    finally:
        await client.close()
    assert mock.requests == []


async def test_startlux_maps_gateway_error_message():
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"error": {"message": "bad question shape"}})

    client = StartLuxDecisionClient(settings(), transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(DecisionRejected, match="bad question shape"):
            await client.decide({"state": "文本", "questions": {"q": {"type": "noul", "instructions": "是否？"}}})
    finally:
        await client.close()
