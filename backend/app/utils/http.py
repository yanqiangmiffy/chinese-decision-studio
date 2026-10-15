"""OpenAI 兼容端点探活：挂了自动降级，恢复后自动启用，不用重启服务。"""

import time

import httpx
from loguru import logger


class EndpointProbe:
    """GET {base_url}/models，结果缓存 ttl 秒。401 / 404 也算"网络是通的"，只排除连不上和 5xx。"""

    def __init__(self, base_url: str, api_key: str, name: str, ttl: float = 60.0, timeout: float = 3.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.name = name
        self.ttl = ttl
        self.timeout = timeout
        self._ok: bool | None = None
        self._checked_at = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.base_url)

    async def ok(self) -> bool:
        if not self.configured:
            return False
        now = time.monotonic()
        if self._ok is None or now - self._checked_at > self.ttl:
            was_ok = self._ok
            self._ok = await self._probe()
            self._checked_at = now
            if not self._ok and was_ok is not False:
                logger.warning("{} 端点不可达：{}，相关能力已降级", self.name, self.base_url)
            elif self._ok and was_ok is False:
                logger.info("{} 端点已恢复：{}", self.name, self.base_url)
        return self._ok

    def mark_down(self) -> None:
        """调用失败时主动标记为不可用，ttl 之后再重新探测。"""
        self._ok = False
        self._checked_at = time.monotonic()

    async def _probe(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(f"{self.base_url}/models", headers={"Authorization": f"Bearer {self.api_key}"})
            return resp.status_code < 500
        except httpx.HTTPError:
            return False
