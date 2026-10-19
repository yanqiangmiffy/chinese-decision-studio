"""决策服务客户端：平台里所有对 chinese-decision 推理服务的调用都经过这里。

服务不可达时抛 DecisionUnavailable，路由层统一转成 503 + 通用文案；具体异常只写日志。
"""

import asyncio
import math
import random
import time
from typing import Any

import httpx
from loguru import logger

from app.config import Settings
from app.services.decision_math import LETTERS, hmm_confidence, options_for, text, user_prompt


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


class StartLuxDecisionClient:
    """Bamboo Relay / StartLux Decision API 适配器。

    远端只提供 /v1/decisions（兼容 /v1/systemone）：
    - decide：单次调用，并把响应补成平台统一的 System One 格式；
    - batch：远端没有 /v1/batch，按 DECISION_CONCURRENCY 并发逐条调用；
    - compile：用本地 decision_math.user_prompt 近似展示（远端不暴露 prompt）；
    - tournament：客户端分组淘汰后决赛；
    - health：GET /v1/models 检查模型是否存在。
    """

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = settings.DECISION_BASE_URL.rstrip("/")
        self.api_key = settings.DECISION_API_KEY
        self.model = settings.DECISION_MODEL or "startlux-decision-27b-autothink"
        self.think_mode = settings.DECISION_THINK_MODE
        self.concurrency = max(1, settings.DECISION_CONCURRENCY)
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=httpx.Timeout(settings.DECISION_TIMEOUT, connect=5.0),
            limits=httpx.Limits(max_connections=512, max_keepalive_connections=256),
            transport=transport,
        )
        self._health: tuple[float, dict[str, Any] | None] = (0.0, None)
        self._semaphore = asyncio.Semaphore(self.concurrency)

    @property
    def can_reload(self) -> bool:
        return False

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            resp = await self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            logger.warning("StartLux 请求失败 {} {}：{!r}", method, path, exc)
            raise DecisionUnavailable(str(exc)) from exc
        if resp.status_code == 422:
            raise DecisionRejected(self._error_message(resp, "请求不合法"))
        if resp.status_code >= 400:
            logger.warning("StartLux 返回 {} {} {}：{}", resp.status_code, method, path, resp.text[:300])
            if resp.status_code in (400, 401, 403):
                raise DecisionRejected(self._error_message(resp, "请求被拒绝"))
            raise DecisionUnavailable(f"HTTP {resp.status_code}")
        try:
            return resp.json()
        except ValueError as exc:
            raise DecisionUnavailable("StartLux 返回了非 JSON 内容") from exc

    @staticmethod
    def _error_message(resp: httpx.Response, fallback: str) -> str:
        try:
            data = resp.json()
        except ValueError:
            return resp.text[:300] or fallback
        error = data.get("error") if isinstance(data, dict) else None
        if isinstance(error, dict):
            return str(error.get("message") or error.get("detail") or fallback)
        if isinstance(error, str):
            return error
        if isinstance(data, dict) and data.get("detail"):
            return str(data["detail"])
        return fallback

    @staticmethod
    def _validate(questions: dict[str, Any]) -> None:
        for name, question in questions.items():
            options = options_for(question)
            if question.get("type") == "score" and len(options) > 10:
                raise DecisionRejected(f"问题 {name}：StartLux score 最多 10 个等级")

    @staticmethod
    def _options_for(question: dict[str, Any], enforce_limit: bool = True) -> list[tuple[str, str]]:
        if enforce_limit:
            return options_for(question)
        if question.get("type") != "choice":
            raise DecisionRejected("只有 choice 题支持超过 26 个候选")
        criteria = question.get("criteria")
        if not isinstance(criteria, dict) or len(criteria) < 2:
            raise DecisionRejected("choice 的 criteria 必须是至少 2 个候选的对象")
        return [(str(k), text(v)) for k, v in criteria.items()]

    @staticmethod
    def _clamp(value: Any) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0.0
        return min(1.0, max(0.0, number))

    @classmethod
    def _probabilities(cls, raw: Any, keys: list[str]) -> dict[str, float]:
        source = raw if isinstance(raw, dict) else {}
        values = []
        for key in keys:
            try:
                value = float(source.get(key, 0.0))
            except (TypeError, ValueError):
                value = 0.0
            values.append(max(0.0, value))
        total = sum(values)
        if total <= 0:
            values = [1.0 / len(keys)] * len(keys)
        else:
            values = [value / total for value in values]
        return dict(zip(keys, values, strict=True))

    @classmethod
    def _answer(cls, kind: str, probabilities: dict[str, float], **extra: Any) -> dict[str, Any]:
        return {
            "type": kind,
            "probabilities": probabilities,
            "logits": {key: math.log(max(value, 1e-12)) for key, value in probabilities.items()},
            "confidence": hmm_confidence(list(probabilities.values())),
            **extra,
        }

    @classmethod
    def _normalize_answer(
        cls, question: dict[str, Any], raw: dict[str, Any], enforce_limit: bool = True
    ) -> dict[str, Any]:
        kind = question["type"]
        options = cls._options_for(question, enforce_limit)
        keys = [key for key, _ in options]
        if kind == "noul":
            positive = cls._clamp(raw.get("noul"))
            return cls._answer("noul", {"false": 1.0 - positive, "true": positive}, noul=positive)
        if kind == "choice":
            probabilities = cls._probabilities(raw.get("probabilities"), keys)
            choice = str(raw.get("choice") or max(probabilities, key=probabilities.__getitem__))
            if choice not in probabilities:
                choice = max(probabilities, key=probabilities.__getitem__)
            answer = cls._answer("choice", probabilities, choice=choice)
            if "none_probability" in raw:
                answer["none_probability"] = cls._clamp(raw.get("none_probability"))
            return answer
        probabilities = cls._probabilities(raw.get("probabilities"), keys)
        score = raw.get("score")
        if score is None:
            score = sum(index * probabilities[key] for index, key in enumerate(keys))
        return cls._answer("score", probabilities, score=float(score), legend=dict(options))

    @classmethod
    def _normalize_response(
        cls, questions: dict[str, Any], data: dict[str, Any], enforce_limit: bool = True
    ) -> dict[str, Any]:
        raw_answers = data.get("answers") or {}
        answers = {}
        for name, question in questions.items():
            raw = raw_answers.get(name)
            if not isinstance(raw, dict):
                raise DecisionUnavailable(f"StartLux 响应缺少问题 {name} 的答案")
            answers[name] = cls._normalize_answer(question, raw, enforce_limit)
        usage = data.get("usage") or {}
        return {
            "model": data.get("model") or "startlux",
            "answers": answers,
            "usage": {
                "input_tokens": int(usage.get("input_tokens") or 0),
                "output_tokens": int(usage.get("output_tokens") or 0),
            },
        }

    async def _decide_raw(self, body: dict[str, Any], *, enforce_limit: bool = True) -> dict[str, Any]:
        questions = body.get("questions") or {}
        if not isinstance(questions, dict) or not questions:
            raise DecisionRejected("questions 必须是非空对象")
        if enforce_limit:
            self._validate(questions)
        payload = {
            "model": self.model,
            "state": body.get("state"),
            "questions": questions,
            "think_mode": self.think_mode,
            "allow_none": False,
        }
        started = time.perf_counter()
        data = await self._request("POST", "/v1/systemone", json=payload)
        result = self._normalize_response(questions, data, enforce_limit)
        result["latency_ms"] = round(1000 * (time.perf_counter() - started), 1)
        return result

    async def decide(self, body: dict[str, Any], debug: bool = True) -> dict[str, Any]:
        return await self._decide_raw(body)

    async def batch(self, requests: list[dict[str, Any]], debug: bool = True) -> dict[str, Any]:
        started = time.perf_counter()

        async def one(request: dict[str, Any]) -> dict[str, Any]:
            async with self._semaphore:
                return await self.decide(request, debug=debug)

        raw = await asyncio.gather(*(one(request) for request in requests), return_exceptions=True)
        results: list[dict[str, Any]] = []
        input_tokens = output_tokens = 0
        for item in raw:
            if isinstance(item, DecisionUnavailable):
                raise item
            if isinstance(item, DecisionRejected):
                results.append({"error": str(item)})
                continue
            if isinstance(item, Exception):
                logger.opt(exception=item).error("StartLux 批量调用失败")
                results.append({"error": "决策服务返回异常"})
                continue
            results.append(item)
            input_tokens += item["usage"]["input_tokens"]
            output_tokens += item["usage"]["output_tokens"]
        return {
            "model": self.model,
            "results": results,
            "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
            "decisions": sum(len(request.get("questions") or {}) for request in requests),
            "latency_ms": round(1000 * (time.perf_counter() - started), 1),
        }

    async def compile(self, body: dict[str, Any]) -> dict[str, Any]:
        questions = body.get("questions") or {}
        state = body.get("state")
        compiled = {}
        for name, question in questions.items():
            options = options_for(question)
            prompt = user_prompt(state, question.get("instructions", ""), options)
            compiled[name] = {
                "prompt": prompt,
                "input_tokens": max(1, len(prompt) // 2),
                "options": [
                    {"letter": LETTERS[index], "key": key, "description": description}
                    for index, (key, description) in enumerate(options)
                ],
            }
        return {"prompt_version": "startlux-remote (estimated)", "questions": compiled}

    async def tournament(self, body: dict[str, Any]) -> dict[str, Any]:
        state = body.get("state")
        question = body.get("question") or {}
        if question.get("type") != "choice":
            raise DecisionRejected("tournament 只支持 choice 题")
        criteria = question.get("criteria")
        if not isinstance(criteria, dict) or len(criteria) < 2:
            raise DecisionRejected("choice 的 criteria 必须是至少 2 个候选的对象")
        keys = [str(key) for key in criteria]
        descriptions = {str(key): text(value) for key, value in criteria.items()}
        group_size = max(3, min(26, int(body.get("group_size") or 16)))
        keep = max(1, min(group_size // 2, int(body.get("keep") or 2)))
        seed = int(body.get("seed") or 0)
        started = time.perf_counter()

        if len(keys) <= group_size:
            response = await self.decide({"state": state, "questions": {"q": question}})
            return {
                "model": response["model"],
                "answer": response["answers"]["q"],
                "candidates": len(keys),
                "group_size": group_size,
                "keep": keep,
                "rounds": [],
                "usage": response["usage"],
                "decisions": 1,
                "latency_ms": response["latency_ms"],
            }

        shuffled = keys[:]
        random.Random(seed).shuffle(shuffled)
        groups = [shuffled[index : index + group_size] for index in range(0, len(shuffled), group_size)]
        if len(groups) > 1 and len(groups[-1]) < 2:
            groups[-1].insert(0, groups[-2].pop())
        batch = await self.batch(
            [
                {
                    "state": state,
                    "questions": {"q": {**question, "criteria": {key: descriptions[key] for key in group}}},
                }
                for group in groups
            ]
        )
        group_results = []
        advanced: list[str] = []
        for result in batch["results"]:
            if "error" in result:
                raise DecisionRejected(str(result["error"]))
            answer = result["answers"]["q"]
            winners = sorted(answer["probabilities"], key=answer["probabilities"].__getitem__, reverse=True)[:keep]
            advanced.extend(winners)
            group_results.append({"probabilities": answer["probabilities"], "advanced": winners})

        final_question = {**question, "criteria": {key: descriptions[key] for key in advanced}}
        final = await self._decide_raw({"state": state, "questions": {"q": final_question}}, enforce_limit=False)
        return {
            "model": final["model"],
            "answer": final["answers"]["q"],
            "candidates": len(keys),
            "group_size": group_size,
            "keep": keep,
            "rounds": [{"groups": group_results}],
            "usage": {
                "input_tokens": batch["usage"]["input_tokens"] + final["usage"]["input_tokens"],
                "output_tokens": batch["usage"]["output_tokens"] + final["usage"]["output_tokens"],
            },
            "decisions": len(groups) + 1,
            "latency_ms": round(1000 * (time.perf_counter() - started), 1),
        }

    async def info(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "version": "startlux-remote",
            "prompt_version": "startlux-remote",
            "limits": {"max_length": 262144, "max_questions": 64, "max_candidates": 26, "max_batch_requests": 512},
            "checkpoint": {
                "base": self.model,
                "adapter": None,
                "step": None,
                "selection_metric": None,
                "selection_value": None,
                "temperature": 1.0,
                "calibrated": False,
                "max_length": 262144,
                "loaded_at": "",
                "load_seconds": 0.0,
            },
            "validation": {},
            "engine": {"token_budget": 0, "max_batch": 1, "max_wait_ms": 0},
            "stats": {
                "requests": 0,
                "decisions": 0,
                "input_tokens": 0,
                "batches": 0,
                "forward_passes": 0,
                "errors": 0,
                "uptime_s": 0,
                "queue_depth": 0,
                "latency_p50_ms": None,
                "latency_p95_ms": None,
                "latency_p99_ms": None,
                "avg_forward_batch": None,
                "forward_p50_ms": None,
                "compile_p50_ms": None,
                "recent_forwards": [],
            },
            "gpu": None,
            "latest_best_step": None,
            "provider": "bamboo",
        }

    async def training(self) -> dict[str, Any]:
        return {"available": False}

    async def health(self, ttl: float = 5.0) -> dict[str, Any] | None:
        checked_at, cached = self._health
        if time.monotonic() - checked_at < ttl:
            return cached
        started = time.perf_counter()
        try:
            data = await self._request("GET", "/v1/models")
            models = data.get("data") if isinstance(data, dict) else None
            ids = [item.get("id") for item in models or [] if isinstance(item, dict)]
            if self.model not in ids:
                logger.warning("StartLux 模型列表中没有 {}：{}", self.model, ids[:20])
                result = None
            else:
                result = {
                    "status": "ok",
                    "model": self.model,
                    "rtt_ms": round(1000 * (time.perf_counter() - started), 1),
                }
        except (DecisionUnavailable, DecisionRejected, ValueError, KeyError):
            result = None
        self._health = (time.monotonic(), result)
        return result

    async def reload(self) -> dict[str, Any]:
        return {"reloaded": False}


def create_decision_client(settings: Settings) -> DecisionClient | StartLuxDecisionClient:
    if settings.DECISION_API_STYLE == "startlux":
        return StartLuxDecisionClient(settings)
    return DecisionClient(settings)
