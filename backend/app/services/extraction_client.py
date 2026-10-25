"""统一模型服务客户端：抽取，以及与抽取串联的决策。

服务是 chinese-decision 仓库的 scripts/serve_unified.py：同一份权重既做分类也做跨度抽取。
`EXTRACTION_BASE_URL` 留空表示没有部署，平台里抽取相关的功能自动降级，不影响决策功能。
"""

from typing import Any

from app.config import Settings
from app.services.decision_client import DecisionClient, DecisionUnavailable


class ExtractionUnavailable(DecisionUnavailable):
    """统一模型服务连不上、超时或返回 5xx。"""


class ExtractionClient(DecisionClient):
    _unavailable = ExtractionUnavailable

    def __init__(self, settings: Settings):
        super().__init__(settings, base_url=settings.EXTRACTION_BASE_URL, timeout=settings.EXTRACTION_TIMEOUT)

    @property
    def configured(self) -> bool:
        return bool(self.base_url)

    async def extract(self, body: dict[str, Any]) -> dict[str, Any]:
        """{text, types: {名称: 说明}, threshold} → {entities: [{text, label, start, end, score}], latency_ms}。"""
        return await self._request("POST", "/v1/extract", json=body)

    async def ask(self, body: dict[str, Any]) -> dict[str, Any]:
        """{state, questions} → {answers, latency_ms}：回答格式与决策服务相同，用于“先判断、再抽取”的串联。"""
        return await self._request("POST", "/v1/decide", json=body)
