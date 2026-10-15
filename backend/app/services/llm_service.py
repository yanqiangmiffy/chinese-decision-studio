"""对照大模型：用同样的题面问一个生成式大模型（OpenAI 兼容接口），读它在候选字母上的概率。

- 题面和决策模型完全一样（decision_math.user_prompt），只生成 1 个 token；
- vLLM 等支持 logprobs 的服务：取第一个 token 的 top_logprobs，在候选字母上重新归一化，
  这样大模型也有一个概率分布，可以和决策模型比较准确率和校准；
- 不支持 logprobs 的服务：退化为解析输出的字母，概率记为 one-hot。
没配置或不可达时 available() 为 False，所有对比功能在界面上自动隐藏。
"""

import math
import time
from typing import Any

import httpx
from loguru import logger

from app.config import Settings
from app.services.decision_math import LETTERS, options_for, user_prompt
from app.utils.http import EndpointProbe


class LLMService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.model = settings.LLM_MODEL
        self.probe = EndpointProbe(settings.LLM_BASE_URL, settings.LLM_API_KEY, "对照大模型")
        self._client = httpx.AsyncClient(
            base_url=settings.LLM_BASE_URL.rstrip("/") or "http://invalid",
            timeout=httpx.Timeout(settings.LLM_TIMEOUT, connect=5.0),
            headers={"Authorization": f"Bearer {settings.LLM_API_KEY}"},
        )

    @property
    def configured(self) -> bool:
        return self.probe.configured

    async def available(self) -> bool:
        return await self.probe.ok()

    async def close(self) -> None:
        await self._client.aclose()

    async def chat(self, prompt: str, max_tokens: int = 400, temperature: float = 0.7) -> str:
        """普通的单轮生成，只用于辅助功能（如生成同义改写）。"""
        body = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
            **self.settings.LLM_EXTRA_BODY,
        }
        try:
            resp = await self._client.post("/chat/completions", json=body)
            resp.raise_for_status()
        except httpx.HTTPError:
            self.probe.mark_down()
            raise
        return resp.json()["choices"][0]["message"].get("content") or ""

    async def decide(self, state: Any, question: dict[str, Any]) -> dict[str, Any]:
        """返回 {model, prediction, probabilities(按候选顺序), latency_ms, method, raw}；失败时抛异常。"""
        options = options_for(question)
        keys = [k for k, _ in options]
        letters = LETTERS[: len(options)]
        body = {
            "model": self.model,
            "messages": [{"role": "user", "content": user_prompt(state, question["instructions"], options)}],
            "max_tokens": 1,
            "temperature": 0,
            "logprobs": True,
            "top_logprobs": 20,
            **self.settings.LLM_EXTRA_BODY,
        }
        started = time.perf_counter()
        try:
            resp = await self._client.post("/chat/completions", json=body)
            resp.raise_for_status()
        except httpx.HTTPError:
            self.probe.mark_down()
            raise
        latency = 1000 * (time.perf_counter() - started)
        choice = resp.json()["choices"][0]
        raw = (choice.get("message") or {}).get("content") or ""
        mass = [0.0] * len(options)
        content = ((choice.get("logprobs") or {}).get("content")) or []
        if content:
            for item in content[0].get("top_logprobs") or []:
                token = (item.get("token") or "").strip().upper()
                if len(token) == 1 and token in letters:
                    mass[letters.index(token)] += math.exp(item["logprob"])
        if sum(mass) > 0:
            floor = min(m for m in mass if m > 0) * 1e-3
            mass = [m if m > 0 else floor for m in mass]
            total = sum(mass)
            probabilities, method = [m / total for m in mass], "logprobs"
        else:
            letter = raw.strip()[:1].upper()
            if letter not in letters:
                logger.info("对照大模型的输出不是候选字母：{!r}", raw[:50])
                probabilities = [1 / len(options)] * len(options)
            else:
                probabilities = [float(letter == x) for x in letters]
            method = "text"
        winner = max(range(len(probabilities)), key=probabilities.__getitem__)
        return {
            "model": self.model,
            "prediction": keys[winner],
            "probabilities": probabilities,
            "latency_ms": latency,
            "method": method,
            "raw": raw[:20],
            "usage": resp.json().get("usage") or {},
        }
