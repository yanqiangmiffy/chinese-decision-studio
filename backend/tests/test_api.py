"""接口：决策 → 历史 → 标注 → 评测集 → 评测运行，以及解释、鲁棒性、压测的事件流。"""

import asyncio
import json

import pytest

pytestmark = pytest.mark.anyio

TICKET = {
    "state": "付款后一直没有收到发票 billing",
    "questions": {
        "dept": {"type": "choice", "instructions": "哪个部门？", "criteria": {"billing": "账单", "technical": "技术"}},
        "urgent": {"type": "noul", "instructions": "是否紧急？"},
    },
}


def sse_events(text: str) -> list[dict]:
    out = []
    for frame in text.split("\n\n"):
        frame = frame.strip()
        if frame.startswith("data: ") and frame != "data: [DONE]":
            out.append(json.loads(frame[6:]))
    return out


async def test_health_reports_dependencies(client):
    resp = await client.get("/api/health")
    data = resp.json()
    assert resp.status_code == 200
    assert data["database"] is True and data["decision"]["online"] is True and data["llm"]["configured"] is False


async def test_decide_logs_history_and_labels_flow_into_suite(client):
    resp = await client.post("/api/decide", json={**TICKET, "title": "发票"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["response"]["answers"]["dept"]["choice"] == "billing"
    log_id = body["log_id"]
    assert log_id

    listing = (await client.get("/api/history", params={"q": "发票"})).json()
    assert listing["total"] == 1 and listing["items"][0]["id"] == log_id

    bad = await client.patch(f"/api/history/{log_id}", json={"labels": {"dept": "sales"}})
    assert bad.status_code == 422
    ok = await client.patch(f"/api/history/{log_id}", json={"labels": {"dept": "billing"}, "note": "确认"})
    assert ok.json()["labels"] == {"dept": "billing"}

    suite = (await client.post("/api/suites", json={"name": "我的评测集"})).json()
    moved = await client.post(f"/api/history/{log_id}/to-suite", json={"suite_id": suite["id"]})
    assert moved.status_code == 200
    cases = (await client.get(f"/api/suites/{suite['id']}/cases")).json()
    assert cases["total"] == 1 and list(cases["items"][0]["questions"]) == ["dept"]


async def test_invalid_question_is_422_with_readable_message(client):
    resp = await client.post(
        "/api/decide", json={"state": "x", "questions": {"q": {"type": "choice", "instructions": "x"}}}
    )
    assert resp.status_code == 422
    assert "criteria" in resp.json()["detail"]


async def test_tournament_passes_large_choice_questions_through(client):
    criteria = {f"intent_{i}": f"意图{i}" for i in range(41)}
    resp = await client.post(
        "/api/decide/tournament",
        json={
            "state": "用户提到 intent_7",
            "question": {"type": "choice", "instructions": "哪个意图？", "criteria": criteria},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"]["choice"] == "intent_7" and body["candidates"] == 41
    assert (body["group_size"], body["keep"]) == (16, 2)
    assert client.fake.calls == ["tournament"]
    bad = await client.post("/api/decide/tournament", json={"state": "x", "question": {}, "group_size": 27})
    assert bad.status_code == 422


async def test_import_and_run_evaluation_end_to_end(client):
    lines = [
        {
            "state": "billing 问题",
            "type": "choice",
            "instructions": "选",
            "criteria": {"billing": "账单", "tech": "技术"},
            "answer": "billing",
            "tag": "账单",
        },
        {
            "state": "tech 问题",
            "type": "choice",
            "instructions": "选",
            "criteria": {"billing": "账单", "tech": "技术"},
            "answer": "tech",
            "tag": "技术",
        },
        {
            "state": "tech 标注有误",
            "type": "choice",
            "instructions": "选",
            "criteria": {"billing": "账单", "tech": "技术"},
            "answer": "billing",
            "tag": "账单",
        },
        {"state": "是", "type": "noul", "instructions": "是否？", "answer": True, "tag": "noul"},
    ]
    payload = "\n".join(json.dumps(x, ensure_ascii=False) for x in lines).encode()
    resp = await client.post("/api/suites/import", files={"file": ("t.jsonl", payload)}, data={"name": "导入"})
    assert resp.status_code == 200, resp.text
    suite_id = resp.json()["suite_id"]
    assert resp.json()["imported"] == 4

    run = (await client.post("/api/runs", json={"suite_id": suite_id, "temperature": 1.0})).json()
    for _ in range(100):
        await asyncio.sleep(0.02)
        detail = (await client.get(f"/api/runs/{run['id']}")).json()
        if detail["status"] in ("completed", "failed"):
            break
    assert detail["status"] == "completed", detail
    overall = detail["metrics"]["overall"]
    assert overall["n"] == 4 and overall["accuracy"] == 0.75
    assert detail["metrics"]["by_tag"]["账单"]["n"] == 2

    wrong = (await client.get(f"/api/runs/{run['id']}/results", params={"filter": "wrong"})).json()
    assert wrong["total"] == 1 and wrong["items"][0]["state"] == "tech 标注有误"

    events = sse_events((await client.get(f"/api/runs/{run['id']}/events")).text)
    assert events[-1]["type"] == "done"

    suites = (await client.get("/api/suites")).json()
    mine = next(s for s in suites if s["id"] == suite_id)
    assert mine["case_count"] == 4 and mine["last_run"]["accuracy"] == 0.75


async def test_explain_returns_segment_attributions(client):
    resp = await client.post(
        "/api/decide/explain",
        json={
            "state": "第一句无关。这里提到 billing。最后一句。",
            "question": TICKET["questions"]["dept"],
        },
    )
    data = resp.json()
    assert resp.status_code == 200
    assert data["target"] == "billing" and len(data["segments"]) == 3
    key = max(data["segments"], key=lambda s: s["delta"])
    assert "billing" in key["text"]


async def test_robustness_streams_each_test(client):
    resp = await client.post(
        "/api/lab/robustness",
        json={
            "state": "billing 发票问题",
            "question": {
                "type": "choice",
                "instructions": "哪个部门？",
                "criteria": {"billing": "账单", "technical": "技术", "sales": "销售"},
            },
            "tests": ["order", "naming", "distractor", "injection", "paraphrase"],
            "paraphrases": ["应该交给哪个团队？"],
        },
    )
    events = sse_events(resp.text)
    kinds = [e["type"] for e in events]
    assert kinds[0] == "base" and kinds[-1] == "summary"
    tests = {e["test"]: e for e in events if e["type"] == "test"}
    assert set(tests) == {"order", "naming", "distractor", "injection", "paraphrase"}
    assert len(tests["order"]["variants"]) == 5  # 3! - 1
    assert len(tests["order"]["position_mass"]) == 3


async def test_bench_streams_and_saves(client):
    resp = await client.post("/api/bench", json={"preset": "short", "concurrency": 4, "total": 12})
    events = sse_events(resp.text)
    types = [e["type"] for e in events]
    assert "level" in types and "summary" in types and types[-1] == "saved"
    summary = next(e for e in events if e["type"] == "summary")
    assert summary["levels"][0]["done"] == 12
    history = (await client.get("/api/bench/history")).json()
    assert len(history) == 1


async def test_overview_aggregates(client):
    await client.post("/api/decide", json=TICKET)
    data = (await client.get("/api/overview")).json()
    assert data["platform"]["decisions_total"] == 1
    assert len(data["platform"]["decisions_14d"]) == 14
