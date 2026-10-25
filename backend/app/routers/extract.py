"""抽取接口：透传给统一模型服务（chinese-decision 的 scripts/serve_unified.py）。

抽取的请求和响应都和决策不同（输入是文本 + 类型表，输出是带位置的实体），不写历史记录，也不进评测集。
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.deps import get_extraction_client
from app.schemas.api import ExtractRequest, UnifiedDecideRequest
from app.services.decision_math import options_for
from app.services.extraction_client import ExtractionClient

router = APIRouter(prefix="/api", tags=["extract"])


def _require(client: ExtractionClient) -> None:
    if not client.configured:
        raise HTTPException(503, "没有配置抽取服务：请部署统一模型服务并设置 EXTRACTION_BASE_URL")


@router.post("/extract")
async def extract(req: ExtractRequest, client: ExtractionClient = Depends(get_extraction_client)) -> dict[str, Any]:
    """在文本里找出给定类型的实体：每个类型是“名称 + 说明”，说明越接近训练时的写法越稳（见文档页）。"""
    _require(client)
    return await client.extract(req.model_dump())


@router.post("/extract/decide")
async def extract_decide(
    req: UnifiedDecideRequest, client: ExtractionClient = Depends(get_extraction_client)
) -> dict[str, Any]:
    """用同一个统一模型回答决策问题：串联场景里“先判断、再抽取”的第一步，格式和 /api/decide 的 answers 相同。"""
    _require(client)
    for name, question in req.questions.items():
        try:
            options_for(question)
        except ValueError as exc:
            raise HTTPException(422, f"问题 {name}：{exc}") from exc
    return await client.ask(req.model_dump())
