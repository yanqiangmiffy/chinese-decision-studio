"""MCP 接口：工具注册、决策、评测集 → 评测运行、鲁棒性与压测。"""

import asyncio
import json

import httpx
import pytest
from mcp import Client
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.mcp_server import MCPAuthMiddleware, mcp

pytestmark = pytest.mark.anyio

TICKET = {
    "state": "客户留言：付款后一直没有收到发票，我已经催了三次。",
    "questions": {
        "dept": {
            "type": "choice",
            "instructions": "应该由哪个部门处理？",
            "criteria": {"billing": "支付与发票", "technical": "故障和系统问题", "sales": "购买咨询"},
        },
        "urgent": {"type": "noul", "instructions": "客户是否表达了紧迫性？"},
    },
}


def payload(result) -> dict:
    assert not result.is_error, result.content
    return json.loads(result.content[0].text)


async def test_mcp_auth_middleware():
    async def ok(_):
        return JSONResponse({"ok": True})

    app = Starlette(routes=[Route("/", ok)])
    wrapped = MCPAuthMiddleware(app, "secret")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=wrapped), base_url="http://test") as client:
        assert (await client.get("/")).status_code == 401
        assert (await client.get("/", headers={"Authorization": "Bearer secret"})).status_code == 200


async def test_mcp_lists_tools_and_decides(client):
    async with Client(mcp) as session:
        names = {t.name for t in (await session.list_tools()).tools}
        assert {"decide", "decide_batch", "list_suites", "start_evaluation", "run_benchmark"} <= names

        suites = await session.call_tool("list_suites", {})
        assert len(suites.content) == 1
        assert payload(suites)["suites"] == []

        data = payload(await session.call_tool("decide", {**TICKET, "title": "MCP 冒烟"}))
        assert data["response"]["answers"]["dept"]["choice"] == "billing"
        assert data["log_id"]

        history = payload(await session.call_tool("list_recent_decisions", {"source": "mcp"}))
        assert history["total"] == 1


async def test_mcp_suite_and_evaluation_flow(client):
    async with Client(mcp) as session:
        suite = payload(await session.call_tool("create_suite", {"name": "MCP 评测集"}))
        suite_id = suite["id"]

        added = payload(
            await session.call_tool(
                "add_suite_cases",
                {
                    "suite_id": suite_id,
                    "cases": [
                        {
                            "state": "付款后没收到发票，请尽快处理。",
                            "questions": {
                                "dept": {
                                    "type": "choice",
                                    "instructions": "应该由哪个部门处理？",
                                    "criteria": {"billing": "支付与发票", "technical": "技术"},
                                }
                            },
                            "gold": {"dept": "billing"},
                        },
                        {
                            "state": "客户说系统打不开了。",
                            "questions": {"urgent": {"type": "noul", "instructions": "客户是否表达了紧迫性？"}},
                            "gold": {"urgent": False},
                        },
                    ],
                },
            )
        )
        assert added["added"] == 2

        detail = payload(await session.call_tool("get_suite", {"suite_id": suite_id}))
        assert detail["case_count"] == 2
        assert detail["cases"]["total"] == 2

        run = payload(await session.call_tool("start_evaluation", {"suite_id": suite_id, "limit": 2}))
        report = {}
        for _ in range(100):
            report = payload(await session.call_tool("get_evaluation", {"run_id": run["id"]}))
            if report["status"] in {"completed", "failed", "cancelled"}:
                break
            await asyncio.sleep(0.05)
        assert report["status"] == "completed"
        assert report["metrics"]["overall"]["accuracy"] is not None

        detail = payload(await session.call_tool("get_evaluation", {"run_id": run["id"], "include_results": True}))
        assert detail["results"]["total"] == 2

        runs = payload(await session.call_tool("list_evaluations", {"suite_id": suite_id}))
        assert runs["runs"][0]["id"] == run["id"]


async def test_mcp_robustness_and_benchmark(client):
    async with Client(mcp) as session:
        robust = payload(
            await session.call_tool(
                "test_robustness",
                {
                    "state": "付款后没收到发票，请尽快处理。",
                    "question": {
                        "type": "choice",
                        "instructions": "应该由哪个部门处理？",
                        "criteria": {"billing": "支付与发票", "technical": "技术", "sales": "销售"},
                    },
                    "tests": ["order"],
                },
            )
        )
        assert robust["summary"]["tests"]["order"] is not None

        bench = payload(await session.call_tool("run_benchmark", {"preset": "short", "concurrency": 2, "total": 4}))
        assert bench["summary"]["best"]["done"] == 4
