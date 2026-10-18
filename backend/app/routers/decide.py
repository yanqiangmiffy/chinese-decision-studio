"""决策相关接口：实验台、场景、证据归因、鲁棒性实验室。只做协议转换，逻辑在 services/。"""

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger

from app.db.models import DecisionLog
from app.db.session import get_sessionmaker
from app.deps import get_decision_client, get_llm_service
from app.schemas.api import (
    BatchRequest,
    CompileRequest,
    DecideRequest,
    ExplainRequest,
    RobustnessRequest,
    TournamentRequest,
)
from app.services import analysis_service
from app.services.decision_client import DecisionClient, DecisionRejected, DecisionUnavailable
from app.services.decision_math import options_for
from app.services.llm_service import LLMService
from app.utils.sse import SSE_DONE, SSE_HEADERS, sse

router = APIRouter(prefix="/api", tags=["decide"])


def _validate(questions: dict[str, dict[str, Any]]) -> None:
    for name, question in questions.items():
        try:
            options_for(question)
        except ValueError as exc:
            raise HTTPException(422, f"问题 {name}：{exc}") from exc


async def _save_log(record: dict[str, Any]) -> int | None:
    try:
        async with get_sessionmaker()() as session:
            log = DecisionLog(**record)
            session.add(log)
            await session.commit()
            return log.id
    except Exception:  # noqa: BLE001
        logger.exception("写决策历史失败")  # 历史记录写失败不影响返回结果
        return None


async def _llm_answers(llm: LLMService, state: Any, questions: dict[str, Any]) -> dict[str, Any]:
    async def one(question: dict[str, Any]) -> dict[str, Any]:
        try:
            return await llm.decide(state, question)
        except Exception as exc:  # noqa: BLE001
            logger.info("对照大模型调用失败：{!r}", exc)
            return {"error": "对照大模型调用失败"}

    names = list(questions)
    results = await asyncio.gather(*(one(questions[n]) for n in names))
    return dict(zip(names, results, strict=True))


@router.post("/decide")
async def decide(
    req: DecideRequest,
    client: DecisionClient = Depends(get_decision_client),
    llm: LLMService = Depends(get_llm_service),
) -> dict[str, Any]:
    _validate(req.questions)
    body = {"state": req.state, "questions": req.questions}
    use_llm = req.compare_llm and await llm.available()
    if use_llm:
        response, llm_result = await asyncio.gather(client.decide(body), _llm_answers(llm, req.state, req.questions))
    else:
        response, llm_result = await client.decide(body), None
    log_id = None
    if req.log:
        log_id = await _save_log(
            {
                "source": req.source,
                "title": req.title,
                "state": req.state,
                "questions": req.questions,
                "answers": response["answers"],
                "latency_ms": response["latency_ms"],
                "input_tokens": response["usage"]["input_tokens"],
                "model_step": (await client.health() or {}).get("step"),
            }
        )
    return {"response": response, "log_id": log_id, "llm": llm_result}


@router.post("/decide/batch")
async def decide_batch(req: BatchRequest, client: DecisionClient = Depends(get_decision_client)) -> dict[str, Any]:
    """场景里的批量调用（评论 map-reduce、RAG 重排等）：不写历史，直接透传。"""
    return await client.batch(req.requests, debug=True)


@router.post("/decide/tournament")
async def tournament(req: TournamentRequest, client: DecisionClient = Depends(get_decision_client)) -> dict[str, Any]:
    """类别超过 26 个的单选：直接透传给决策服务的 /v1/tournament，不写历史（返回格式和单题不同）。"""
    return await client.tournament(req.model_dump())


@router.post("/decide/compile")
async def compile_prompt(req: CompileRequest, client: DecisionClient = Depends(get_decision_client)) -> dict[str, Any]:
    _validate(req.questions)
    return await client.compile({"state": req.state, "questions": req.questions})


@router.post("/decide/explain")
async def explain(req: ExplainRequest, client: DecisionClient = Depends(get_decision_client)) -> dict[str, Any]:
    _validate({"q": req.question})
    try:
        return await analysis_service.explain(client, req.state, req.question, req.target)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/lab/robustness")
async def robustness(
    req: RobustnessRequest,
    client: DecisionClient = Depends(get_decision_client),
    llm: LLMService = Depends(get_llm_service),
) -> StreamingResponse:
    """SSE：base → test × N → summary，每项测试一完成就推给前端。错误也走事件，不走状态码。"""
    _validate({"q": req.question})

    async def events() -> AsyncIterator[str]:
        try:
            async for event in analysis_service.robustness(
                client, llm, req.state, req.question, list(req.tests), req.paraphrases, req.auto_paraphrase
            ):
                yield sse(event)
        except DecisionUnavailable:
            yield sse({"type": "error", "message": "决策服务暂时不可用，请稍后重试"})
        except (DecisionRejected, ValueError) as exc:
            yield sse({"type": "error", "message": str(exc)})
        except Exception:  # noqa: BLE001
            logger.exception("鲁棒性测试失败")
            yield sse({"type": "error", "message": "鲁棒性测试出错，详情见服务日志"})
        yield SSE_DONE

    return StreamingResponse(events(), media_type="text/event-stream", headers=SSE_HEADERS)
