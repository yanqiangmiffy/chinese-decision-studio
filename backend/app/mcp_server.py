"""MCP 服务：把平台现有 /api 能力包装成 MCP 工具。

传输用 Streamable HTTP，挂在 FastAPI 的 /api/mcp/ 下；工具内部通过 ASGITransport 调平台自己的
HTTP 接口，不复制业务逻辑，测试里的 dependency_overrides 也照常生效。

设计约束：
- 工具只做协议转换：参数校验、错误文案、SSE 收集都在这里，真正的逻辑仍由 routers/services 负责；
- 平台不可达 / 请求不合法时抛 ToolError，让模型看到可读的原因；
- 长任务（鲁棒性、压测）把 SSE 收完再返回，避免 MCP 客户端处理流式响应；
- 评测运行是后台任务，MCP 只负责 start / poll / cancel。
"""

import hmac
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

import httpx
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import Field
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import Settings
from app.schemas.api import TestName
from app.services.suite_service import normalize

State = Annotated[
    Any,
    Field(description="待判断的上下文：字符串、JSON 对象或列表。只放与判断有关的信息，无关材料会干扰概率。"),
]
Questions = Annotated[
    dict[str, Any],
    Field(
        description=(
            "问题名 → 题型对象。题型：noul {type,instructions,criteria?}；"
            "choice {type,instructions,criteria:{键:描述}}；"
            "score {type,instructions,criteria:[从低到高]}。每题 2–26 个候选。"
        )
    ),
]
Question = Annotated[
    dict[str, Any],
    Field(description="单个题型对象，格式同 questions 里的值；题型为 noul / choice / score。"),
]

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)

mcp = MCPServer(
    name="decision-studio",
    title="Decision Studio",
    description="Chinese Decision 决策模型的测试平台：一次前向读取候选项概率，支持实验、证据归因、鲁棒性、评测与压测。",
    instructions=(
        "先用 studio_health 确认平台和决策服务状态。判断单个问题用 decide；"
        "多个 state 用 decide_batch；候选超过 26 个用 decide_tournament。"
        "概率不是事实：高风险场景先用 list_suites / start_evaluation 在自己的数据上验证，"
        "再根据复核预算设置阈值。run_benchmark 会占用共享推理资源，只在明确需要时调用。"
    ),
)


# ---------------------------------------------------------------------- HTTP / SSE 适配
@asynccontextmanager
async def _client() -> AsyncIterator[httpx.AsyncClient]:
    """进程内调用平台自己的 /api，不经过网络。"""
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    timeout = httpx.Timeout(600.0, connect=10.0)
    async with httpx.AsyncClient(transport=transport, base_url="http://studio", timeout=timeout) as client:
        yield client


def _detail(resp: httpx.Response) -> str:
    try:
        data = resp.json()
    except ValueError:
        return resp.text[:500]
    if isinstance(data, dict) and "detail" in data:
        data = data["detail"]
    return data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)[:500]


async def _api(method: str, path: str, **kwargs: Any) -> Any:
    async with _client() as client:
        resp = await client.request(method, path, **kwargs)
    if resp.status_code >= 400:
        raise ToolError(f"平台接口 {method} {path} 返回 {resp.status_code}：{_detail(resp)}")
    try:
        return resp.json()
    except ValueError as exc:
        raise ToolError(f"平台接口 {method} {path} 返回了非 JSON 内容") from exc


async def _sse(path: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    """把 SSE 事件收完再返回；事件里的 error 转成 ToolError。"""
    events: list[dict[str, Any]] = []
    async with _client() as client:
        async with client.stream("POST", path, json=payload) as resp:
            if resp.status_code >= 400:
                body = (await resp.aread()).decode("utf-8", "replace")
                raise ToolError(f"平台接口 {path} 返回 {resp.status_code}：{body[:500]}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if raw == "[DONE]":
                    break
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "error":
                    raise ToolError(str(event.get("message") or "流式接口返回错误"))
                events.append(event)
    return events


# ---------------------------------------------------------------------- 状态
@mcp.tool(annotations=READ_ONLY)
async def studio_health() -> dict[str, Any]:
    """检查平台、数据库、决策服务和对照大模型是否在线。返回各依赖的状态、模型 step 和配置信息。"""
    return await _api("GET", "/api/health")


@mcp.tool(annotations=READ_ONLY)
async def get_overview() -> dict[str, Any]:
    """平台总览：决策服务信息、近 14 天调用量、延迟、评测集/用例/运行数量、最近评测和最佳压测。"""
    return await _api("GET", "/api/overview")


@mcp.tool(annotations=READ_ONLY)
async def get_model_info(include_training: bool = True) -> dict[str, Any]:
    """决策服务的模型信息（检查点 step、prompt 版本、推理统计）；include_training 时附带训练进度。"""
    info = await _api("GET", "/api/model/info")
    if not include_training:
        return info
    try:
        training = await _api("GET", "/api/model/training")
    except ToolError as exc:
        training = {"error": str(exc)}
    return {**info, "training": training}


# ---------------------------------------------------------------------- 决策
@mcp.tool(annotations=WRITE)
async def decide(
    state: State,
    questions: Questions,
    compare_llm: bool = False,
    log: bool = True,
    title: str = "",
    source: str = "mcp",
) -> dict[str, Any]:
    """对一组问题做一次决策，返回每个问题的概率分布、胜出候选、logits 和编译后的提示词。

    这是平台最核心的调用：一次请求可以问多个问题（最多 64 个），决策服务一次前向返回所有答案。
    log=True 会写入历史记录（可用 list_recent_decisions 查看、标注后转成评测用例）；
    compare_llm=True 时同时让配置的生成式大模型回答（逐题调用，慢很多，未配置时自动跳过）。
    """
    return await _api(
        "POST",
        "/api/decide",
        json={
            "state": state,
            "questions": questions,
            "source": source,
            "title": title,
            "log": log,
            "compare_llm": compare_llm,
        },
    )


@mcp.tool(annotations=WRITE)
async def decide_batch(
    requests: Annotated[
        list[dict[str, Any]],
        Field(
            max_length=512,
            description="请求列表，每项 {state, questions}；一次最多 512 项，适合评论 map-reduce、RAG 重排等批量场景。",
        ),
    ],
    source: str = "mcp",
) -> dict[str, Any]:
    """批量决策：一次提交多个 {state, questions}，返回 results 列表；不写历史记录。"""
    return await _api("POST", "/api/decide/batch", json={"requests": requests, "source": source})


@mcp.tool(annotations=WRITE)
async def decide_tournament(
    state: State,
    question: Question,
    group_size: int = 16,
    keep: int = 2,
    seed: int = 0,
) -> dict[str, Any]:
    """候选超过 26 个的单选：服务端分组淘汰后决赛，返回最终概率和每轮结果。

    group_size 是每组最多候选数（3–26，默认 16）；keep 是每组晋级数（默认 2）。
    普通 choice 题请直接用 decide，不要为了少量候选调用本工具。
    """
    return await _api(
        "POST",
        "/api/decide/tournament",
        json={"state": state, "question": question, "group_size": group_size, "keep": keep, "seed": seed},
    )


@mcp.tool(annotations=READ_ONLY)
async def compile_prompt(state: State, questions: Questions) -> dict[str, Any]:
    """只编译提示词，不调用模型。用于检查 state、问题、候选项最终如何拼成训练格式。"""
    return await _api("POST", "/api/decide/compile", json={"state": state, "questions": questions})


@mcp.tool(annotations=READ_ONLY)
async def explain_decision(
    state: State,
    question: Question,
    target: str | None = None,
) -> dict[str, Any]:
    """证据归因：逐段删除上下文，观察目标候选概率下降多少，找出支撑当前判断的句子/字段。

    target 默认解释当前胜出的候选（noul 解释 true）；返回每个片段的 delta、value、winner 和是否翻转。
    调用量约为片段数 + 1 次决策，长文本会慢一些。
    """
    return await _api(
        "POST",
        "/api/decide/explain",
        json={"state": state, "question": question, "target": target},
    )


@mcp.tool(annotations=READ_ONLY)
async def test_robustness(
    state: State,
    question: Question,
    tests: Annotated[
        list[TestName] | None,
        Field(description="要跑的测试：order / naming / distractor / injection / paraphrase；默认全部。"),
    ] = None,
    paraphrases: Annotated[list[str] | None, Field(max_length=8, description="手写的同义问法。")] = None,
    auto_paraphrase: bool = True,
) -> dict[str, Any]:
    """鲁棒性实验室：选项顺序、选项命名、无关干扰、对抗注入、改写一致性。

    返回 base（基准答案）、tests（每项测试的 variants/consistency/max_delta/score/verdict）、
    skipped（不适用的测试及原因）和 summary（综合稳健分）。高风险上线前建议至少跑一次。
    """
    events = await _sse(
        "/api/lab/robustness",
        {
            "state": state,
            "question": question,
            "tests": tests or ["order", "naming", "distractor", "injection", "paraphrase"],
            "paraphrases": paraphrases or [],
            "auto_paraphrase": auto_paraphrase,
        },
    )
    return {
        "base": next((e for e in events if e.get("type") == "base"), None),
        "tests": [e for e in events if e.get("type") == "test"],
        "skipped": [e for e in events if e.get("type") == "skip"],
        "summary": next((e for e in events if e.get("type") == "summary"), None),
    }


# ---------------------------------------------------------------------- 评测集
@mcp.tool(annotations=READ_ONLY)
async def list_suites() -> dict[str, Any]:
    """列出所有评测集：id、名称、分类、标签、用例数、题型分布和最近一次完成的评测指标。"""
    return {"suites": await _api("GET", "/api/suites")}


@mcp.tool(annotations=READ_ONLY)
async def get_suite(suite_id: int, include_cases: bool = True, page: int = 1, size: int = 20) -> dict[str, Any]:
    """查看一个评测集；include_cases=True 时附带分页用例（size 最大 200）。"""
    suite = await _api("GET", f"/api/suites/{suite_id}")
    if not include_cases:
        return suite
    cases = await _api("GET", f"/api/suites/{suite_id}/cases", params={"page": page, "size": size})
    return {**suite, "cases": cases}


@mcp.tool(annotations=WRITE)
async def create_suite(
    name: str,
    description: str = "",
    category: str = "custom",
    tags: Annotated[list[str] | None, Field(description="可选标签。")] = None,
) -> dict[str, Any]:
    """新建一个空评测集，返回 suite_id；随后用 add_suite_cases 或 import_suite 加用例。"""
    return await _api(
        "POST",
        "/api/suites",
        json={"name": name, "description": description, "category": category, "tags": tags or []},
    )


@mcp.tool(annotations=WRITE)
async def add_suite_cases(
    suite_id: int,
    cases: Annotated[
        list[dict[str, Any]],
        Field(
            max_length=200,
            description=(
                "用例列表，每项 {state, questions, gold, meta?}。gold 支持键名、true/false、score 下标，"
                '或 {"probabilities": {...}}。最多 200 条，全部先本地校验再写入。'
            ),
        ),
    ],
) -> dict[str, Any]:
    """向评测集追加用例。返回新增数量和新用例 id；任一条不合法时不会写入任何用例。"""
    if not cases:
        raise ToolError("cases 不能为空")
    normalized = []
    for index, case in enumerate(cases):
        try:
            item = normalize(case)
        except (AttributeError, TypeError, ValueError) as exc:
            raise ToolError(f"第 {index + 1} 条用例不合法：{exc}") from exc
        if len(item["questions"]) > 64:
            raise ToolError(f"第 {index + 1} 条用例最多 64 个问题")
        normalized.append(item)
    added = [await _api("POST", f"/api/suites/{suite_id}/cases", json=case) for case in normalized]
    return {"suite_id": suite_id, "added": len(added), "case_ids": [c["id"] for c in added]}


@mcp.tool(annotations=WRITE)
async def import_suite(
    content: Annotated[str, Field(description="JSONL / JSON / CSV 文件内容。")],
    filename: str = "import.jsonl",
    name: str = "",
    description: str = "",
    suite_id: int | None = None,
) -> dict[str, Any]:
    """从 JSONL / JSON / CSV 文本导入用例。suite_id 为空时新建评测集，否则追加到已有评测集。

    返回 {suite_id, imported, skipped, errors}。CJ-Bench 格式与单问题简写都支持。
    """
    data: dict[str, Any] = {"name": name, "description": description}
    if suite_id is not None:
        data["suite_id"] = str(suite_id)
    return await _api(
        "POST",
        "/api/suites/import",
        files={"file": (filename, content.encode("utf-8"), "application/octet-stream")},
        data=data,
    )


# ---------------------------------------------------------------------- 评测运行
@mcp.tool(annotations=READ_ONLY)
async def list_evaluations(suite_id: int | None = None, limit: int = 50) -> dict[str, Any]:
    """列出最近的评测运行（id、状态、准确率、ECE、进度）；可按 suite_id 过滤。"""
    params: dict[str, Any] = {"limit": limit}
    if suite_id is not None:
        params["suite_id"] = suite_id
    return {"runs": await _api("GET", "/api/runs", params=params)}


@mcp.tool(annotations=WRITE)
async def start_evaluation(
    suite_id: int,
    name: str = "",
    temperature: float = 1.0,
    compare_llm: bool = False,
    limit: int | None = None,
) -> dict[str, Any]:
    """启动一次后台评测，立即返回 run_id；用 get_evaluation 轮询状态和报告。

    temperature 只影响客户端重算概率和指标，不改模型；limit 可只跑前 N 条用例做冒烟。
    compare_llm=True 需要配置 LLM_BASE_URL，且只对前 LLM_EVAL_LIMIT 条做对照。
    """
    return await _api(
        "POST",
        "/api/runs",
        json={
            "suite_id": suite_id,
            "name": name,
            "temperature": temperature,
            "compare_llm": compare_llm,
            "limit": limit,
        },
    )


@mcp.tool(annotations=READ_ONLY)
async def get_evaluation(
    run_id: int,
    include_results: bool = False,
    result_filter: Literal["all", "wrong", "correct", "uncertain", "errors", "disagree"] = "all",
    kind: Literal["", "noul", "choice", "score"] = "",
    tag: str = "",
    page: int = 1,
    size: int = 20,
) -> dict[str, Any]:
    """查看评测运行。完整报告在 metrics（ACC/ECE/NLL/Brier、可靠性图、复核预算、温度拟合、混淆矩阵）。

    include_results=True 时附带逐题结果；result_filter 可选 wrong/correct/uncertain/errors/disagree。
    """
    run = await _api("GET", f"/api/runs/{run_id}")
    if not include_results:
        return run
    results = await _api(
        "GET",
        f"/api/runs/{run_id}/results",
        params={"filter": result_filter, "kind": kind, "tag": tag, "page": page, "size": size},
    )
    return {**run, "results": results}


@mcp.tool(annotations=WRITE)
async def cancel_evaluation(run_id: int) -> dict[str, Any]:
    """取消一个还在运行的后台评测。"""
    return await _api("POST", f"/api/runs/{run_id}/cancel")


# ---------------------------------------------------------------------- 历史记录
@mcp.tool(annotations=READ_ONLY)
async def list_recent_decisions(
    q: str = "",
    source: str = "",
    page: int = 1,
    size: int = 20,
) -> dict[str, Any]:
    """浏览决策历史（默认最近 20 条）：可按上下文/标题关键词 q 和来源 source 过滤。

    返回 items、total、sources；state 较长时会被截断，看完整内容用 get_decision。
    """
    return await _api("GET", "/api/history", params={"q": q, "source": source, "page": page, "size": size})


@mcp.tool(annotations=READ_ONLY)
async def get_decision(log_id: int) -> dict[str, Any]:
    """查看一条决策历史的完整内容：state、questions、answers、已标注答案和备注。"""
    return await _api("GET", f"/api/history/{log_id}")


@mcp.tool(annotations=WRITE)
async def label_decision(
    log_id: int,
    labels: Annotated[
        dict[str, Any] | None,
        Field(description="问题名 → 正确答案；支持键名、true/false、score 下标或概率分布。"),
    ] = None,
    note: str = "",
) -> dict[str, Any]:
    """给一条决策历史标注正确答案和备注；labels 与 note 至少提供一个。标注后可转成评测用例。"""
    body: dict[str, Any] = {}
    if labels is not None:
        body["labels"] = labels
    if note:
        body["note"] = note
    if not body:
        raise ToolError("labels 和 note 至少提供一个")
    return await _api("PATCH", f"/api/history/{log_id}", json=body)


@mcp.tool(annotations=WRITE)
async def add_decision_to_suite(log_id: int, suite_id: int) -> dict[str, Any]:
    """把一条已标注的历史记录转成评测用例，只带上标注过的问题。"""
    return await _api("POST", f"/api/history/{log_id}/to-suite", json={"suite_id": suite_id})


# ---------------------------------------------------------------------- 压测
@mcp.tool(annotations=WRITE)
async def run_benchmark(
    preset: str = "short",
    body: Annotated[
        dict[str, Any] | None, Field(description="自定义请求体 {state, questions}；给了就忽略 preset。")
    ] = None,
    concurrency: int = 4,
    total: int = 50,
    sweep: Annotated[list[int] | None, Field(max_length=12, description="并发扫描档位，例如 [1,4,16]。")] = None,
    name: str = "",
) -> dict[str, Any]:
    """对决策服务做一次压测，返回各并发档位的吞吐/延迟和 summary。

    会占用共享推理资源：默认只跑 short 预设、并发 4、50 个请求。只有明确需要评估吞吐或找拐点时才调用，
    不要无节制加大 concurrency/total；平台侧还有 BENCH_MAX_CONCURRENCY 和 BENCH_MAX_REQUESTS 限制。
    """
    events = await _sse(
        "/api/bench",
        {
            "preset": preset if body is None else None,
            "body": body,
            "concurrency": concurrency,
            "total": total,
            "sweep": sweep,
            "name": name,
        },
    )
    return {
        "levels": [e for e in events if e.get("type") == "level"],
        "summary": next((e for e in events if e.get("type") == "summary"), None),
        "saved": next((e for e in events if e.get("type") == "saved"), None),
    }


# ---------------------------------------------------------------------- 部署
def build_http_app(settings: Settings):
    """构造 Streamable HTTP ASGI app；挂载后必须在宿主 lifespan 里跑 session_manager。"""
    hosts = settings.mcp_allowed_hosts
    if "*" in hosts:
        security = TransportSecuritySettings(enable_dns_rebinding_protection=False)
    else:
        security = TransportSecuritySettings(
            allowed_hosts=hosts,
            allowed_origins=settings.mcp_allowed_origins,
        )
    return mcp.streamable_http_app(
        streamable_http_path="/",
        json_response=True,
        stateless_http=True,
        transport_security=security,
        max_request_body_size=max(1, settings.MCP_MAX_REQUEST_MB) * 1024 * 1024,
    )


class MCPAuthMiddleware:
    """可选的 Bearer token 鉴权；只包住 MCP 挂载点，不影响平台其他 /api 接口。"""

    def __init__(self, app: ASGIApp, token: str):
        self.app = app
        self.token = token
        self.expected = f"Bearer {token}".encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.token and scope["type"] == "http" and scope.get("method") != "OPTIONS":
            provided = Headers(scope=scope).get("authorization", "").encode()
            if not hmac.compare_digest(provided, self.expected):
                response = JSONResponse(
                    {"detail": "MCP 需要 Authorization: Bearer <token>"},
                    status_code=401,
                    headers={"WWW-Authenticate": "Bearer"},
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
