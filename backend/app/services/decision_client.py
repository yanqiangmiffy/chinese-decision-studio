"""决策服务客户端：平台里所有对 chinese-decision 推理服务的调用都经过这里。

服务不可达时抛 DecisionUnavailable，路由层统一转成 503 + 通用文案；具体异常只写日志。
"""

import time
from typing import Any

import httpx
from loguru import logger

from app.config import Settings


class DecisionUnavailable(RuntimeError):
    """决策服务连不上、超时或返回 5xx。"""


class DecisionRejected(ValueError):
    """决策服务认为请求不合法（422），message 是服务给出的原因，可以直接展示给用户。"""


class DecisionClient:
    def __init__(self, settings: Settings):
        self.base_url = settings.DECISION_BASE_URL.rstrip("/")
        self.admin_token = settings.DECISION_ADMIN_TOKEN
        # 压测时并发可能上百，连接池要放大；keepalive 复用连接，延迟里不含握手
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(settings.DECISION_TIMEOUT, connect=5.0),
            limits=httpx.Limits(max_connections=512, max_keepalive_connections=256),
        )
        self._health: tuple[float, dict[str, Any] | None] = (0.0, None)

    @property
    def can_reload(self) -> bool:
        return bool(self.admin_token)

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            resp = await self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            logger.warning("决策服务请求失败 {} {}：{!r}", method, path, exc)
            raise DecisionUnavailable(str(exc)) from exc
        if resp.status_code == 422:
            detail = (
                resp.json().get("detail", "请求不合法")
                if resp.headers.get("content-type", "").startswith("application/json")
                else "请求不合法"
            )
            raise DecisionRejected(detail if isinstance(detail, str) else str(detail))
        if resp.status_code >= 400:
            logger.warning("决策服务返回 {} {} {}：{}", resp.status_code, method, path, resp.text[:300])
            if resp.status_code in (403, 409):
                raise DecisionRejected(resp.json().get("detail", "操作被拒绝"))
            raise DecisionUnavailable(f"HTTP {resp.status_code}")
        return resp.json()

    # ------------------------------------------------------------------ 推理
    async def decide(self, body: dict[str, Any], debug: bool = True) -> dict[str, Any]:
        params = {"debug": "1"} if debug else None
        return await self._request("POST", "/v1/systemone", json=body, params=params)

    async def batch(self, requests: list[dict[str, Any]], debug: bool = True) -> dict[str, Any]:
        return await self._request("POST", "/v1/batch", json={"requests": requests, "debug": debug})

    async def compile(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/v1/compile", json=body)

    async def tournament(self, body: dict[str, Any]) -> dict[str, Any]:
        """候选超过一题能放下的 choice 问题：服务端分组淘汰后决赛（需要支持 /v1/tournament 的决策服务）。"""
        return await self._request("POST", "/v1/tournament", json=body)

    # ------------------------------------------------------------------ 状态
    async def info(self) -> dict[str, Any]:
        return await self._request("GET", "/v1/info")

    async def training(self) -> dict[str, Any]:
        return await self._request("GET", "/v1/training")

    async def health(self, ttl: float = 5.0) -> dict[str, Any] | None:
        """带短缓存的探活：None 表示不可达。前端每几秒轮询一次，不要每次都打到 GPU 服务器。"""
        checked_at, cached = self._health
        if time.monotonic() - checked_at < ttl:
            return cached
        started = time.perf_counter()
        try:
            data = await self._request("GET", "/health")
            data["rtt_ms"] = round(1000 * (time.perf_counter() - started), 1)
        except (DecisionUnavailable, DecisionRejected, ValueError):
            data = None
        self._health = (time.monotonic(), data)
        return data

    async def reload(self) -> dict[str, Any]:
        return await self._request(
            "POST", "/v1/admin/reload", headers={"X-Admin-Token": self.admin_token}, timeout=300.0
        )
