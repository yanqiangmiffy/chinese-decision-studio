"""压测：从平台后端向决策服务并发打请求，按固定节拍推送实时快照。

延迟是"平台后端 → 决策服务"的端到端时间（含网络往返），和用户真实调用的体验一致。
并发扫描模式依次跑多个并发档位，得到吞吐-延迟曲线，用来找服务的拐点。
"""

import asyncio
import math
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.services.decision_client import DecisionClient, DecisionRejected, DecisionUnavailable

TICK = 0.25  # 快照间隔（秒）

LONG_STATE = (
    "【会议纪要】2026 年第三季度产品复盘会。参会人：产品部、研发部、客服部、市场部。"
    + "一、整体情况：本季度新增付费用户 1.2 万，环比增长 18%，但续费率从 71% 下降到 64%。"
    + "客服工单量增长 35%，其中账单类问题占比最高，主要集中在发票开具延迟和自动续费扣款提醒不足。"
    + "二、问题分析：研发部认为发票系统在 8 月迁移后出现了队列积压，部分订单的发票生成延迟超过 72 小时；"
    + "客服部反馈大量用户在社交媒体上投诉“被偷偷扣费”，舆情风险正在上升；市场部指出竞品近期推出了免费试用。"
    + "三、决议：1. 研发部两周内修复发票队列，并补发所有延迟发票；2. 客服部对受影响用户主动致歉并提供补偿券；"
    + "3. 产品部在续费前 7 天增加站内信和短信提醒；4. 市场部评估是否跟进免费试用策略，下次会议汇报。"
) * 3

PRESETS: dict[str, dict[str, Any]] = {
    "short": {
        "label": "短文本 · 1 问",
        "body": {
            "state": "这家店的外卖送得很快，味道也不错，就是包装有点漏汤。",
            "questions": {
                "sentiment": {
                    "type": "score",
                    "instructions": "评论的整体情感倾向？",
                    "criteria": ["负面", "中性", "正面"],
                }
            },
        },
    },
    "ticket": {
        "label": "工单 · 3 问",
        "body": {
            "state": "客户留言：付款后一直没有收到发票，我已经催了三次，今天必须拿到。",
            "questions": {
                "urgent": {"type": "noul", "instructions": "客户是否表达了紧迫性？"},
                "department": {
                    "type": "choice",
                    "instructions": "应该由哪个部门处理？",
                    "criteria": {
                        "billing": "支付、发票及退款",
                        "technical": "故障和系统问题",
                        "sales": "购买咨询与升级",
                    },
                },
                "frustration": {
                    "type": "score",
                    "instructions": "客户有多不满？",
                    "criteria": ["平静", "不满", "非常愤怒"],
                },
            },
        },
    },
    "long": {
        "label": "长文本（约 1,000 token）· 2 问",
        "body": {
            "state": LONG_STATE,
            "questions": {
                "risk": {"type": "noul", "instructions": "纪要中是否提到了舆情风险？"},
                "owner": {
                    "type": "choice",
                    "instructions": "修复发票队列由哪个部门负责？",
                    "criteria": {"product": "产品部", "rd": "研发部", "support": "客服部", "marketing": "市场部"},
                },
            },
        },
    },
    "fanout": {
        "label": "多问题扇出 · 8 问",
        "body": {
            "state": "用户：我昨天买的耳机今天就降价了 100 块，你们能不能退差价？不退的话我就直接退货，再也不买了。",
            "questions": {
                "refund": {"type": "noul", "instructions": "用户是否在要求退款或退差价？"},
                "churn": {"type": "noul", "instructions": "用户是否表达了流失（不再购买）的倾向？"},
                "threat": {"type": "noul", "instructions": "用户是否以退货作为要挟？"},
                "abuse": {"type": "noul", "instructions": "用户是否使用了辱骂性语言？"},
                "topic": {
                    "type": "choice",
                    "instructions": "问题类型？",
                    "criteria": {
                        "price": "价格与优惠",
                        "quality": "质量问题",
                        "logistics": "物流配送",
                        "account": "账户与登录",
                    },
                },
                "anger": {
                    "type": "score",
                    "instructions": "情绪激烈程度？",
                    "criteria": ["平静", "有些不满", "强烈不满"],
                },
                "priority": {"type": "score", "instructions": "处理优先级？", "criteria": ["低", "中", "高"]},
                "vip": {"type": "noul", "instructions": "用户是否提到自己是会员或老客户？"},
            },
        },
    },
}


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def histogram(values: list[float]) -> list[dict[str, float]]:
    """对数分箱的延迟直方图（10ms – 10s）。"""
    if not values:
        return []
    edges = [10 * (10 ** (i / 8)) for i in range(0, 25)]  # 10ms → 10s，每十倍 8 档
    counts = [0] * (len(edges) - 1)
    for v in values:
        index = 0 if v < edges[0] else min(len(counts) - 1, int(8 * math.log10(v / 10)))
        counts[index] += 1
    return [{"lo": edges[i], "hi": edges[i + 1], "n": c} for i, c in enumerate(counts)]


async def run_level(
    client: DecisionClient,
    body: dict[str, Any],
    concurrency: int,
    total: int,
    level_index: int,
    on_tick,
) -> dict[str, Any]:
    latencies: list[float] = []
    window: list[tuple[float, float]] = []  # (完成时刻, 延迟)
    errors = 0
    error_samples: list[str] = []
    issued = 0
    started = time.perf_counter()
    decisions_per_request = len(body["questions"])

    async def worker() -> None:
        nonlocal issued, errors
        while issued < total:
            issued += 1
            t0 = time.perf_counter()
            try:
                await client.decide(body, debug=False)
                elapsed = 1000 * (time.perf_counter() - t0)
                latencies.append(elapsed)
                window.append((time.perf_counter(), elapsed))
            except (DecisionUnavailable, DecisionRejected, httpx.HTTPError) as exc:
                errors += 1
                if len(error_samples) < 3:
                    error_samples.append(str(exc)[:160])

    def snapshot(final: bool = False) -> dict[str, Any]:
        now = time.perf_counter()
        elapsed = now - started
        recent = [lat for t, lat in window if now - t <= 1.0]
        done = len(latencies)
        return {
            "level": level_index,
            "concurrency": concurrency,
            "elapsed_s": elapsed,
            "done": done,
            "errors": errors,
            "total": total,
            "rps": done / elapsed if elapsed > 0 else 0.0,
            "rps_window": len(recent) / min(1.0, elapsed) if elapsed > 0 else 0.0,
            "decisions_per_s": done * decisions_per_request / elapsed if elapsed > 0 else 0.0,
            "p50": percentile(latencies, 0.5),
            "p95": percentile(latencies, 0.95),
            "p99": percentile(latencies, 0.99),
            "window_p50": percentile(recent, 0.5),
            "mean": sum(latencies) / done if done else None,
            "max": max(latencies) if latencies else None,
            "final": final,
            **({"histogram": histogram(latencies), "error_samples": error_samples} if final else {}),
        }

    workers = [asyncio.create_task(worker()) for _ in range(min(concurrency, total))]
    try:
        while not all(w.done() for w in workers):
            await asyncio.wait(workers, timeout=TICK)
            await on_tick(snapshot())
    finally:
        for w in workers:
            w.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
    return snapshot(final=True)


async def run_bench(client: DecisionClient, config: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    """事件：start → tick × N → level（每个并发档位结束）→ summary。"""
    body = config["body"]
    levels = config["levels"]
    total = config["total"]
    queue: asyncio.Queue = asyncio.Queue()

    async def on_tick(snap: dict[str, Any]) -> None:
        await queue.put({"type": "tick", **snap})

    yield {"type": "start", "levels": levels, "total": total, "questions": len(body["questions"])}
    results = []
    for index, concurrency in enumerate(levels):
        task = asyncio.create_task(run_level(client, body, concurrency, total, index, on_tick))
        try:
            while not task.done() or not queue.empty():
                try:
                    yield await asyncio.wait_for(queue.get(), timeout=TICK)
                except TimeoutError:
                    continue
            result = task.result()
        finally:
            if not task.done():
                task.cancel()
        results.append(result)
        yield {"type": "level", **result}
    try:
        info = await client.info()
        engine = {k: info["stats"].get(k) for k in ("avg_forward_batch", "forward_p50_ms", "compile_p50_ms")}
    except (DecisionUnavailable, DecisionRejected, KeyError):
        engine = {}
    best = max(results, key=lambda r: r["decisions_per_s"]) if results else None
    yield {"type": "summary", "levels": results, "best": best, "engine": engine}
