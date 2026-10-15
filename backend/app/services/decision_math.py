"""决策题型的纯函数：候选项展开、标准答案转目标分布、温度缩放。

候选项顺序和 chinese-decision/decision/schema.py 的 options_for 保持一致：
choice 按 criteria 的键顺序，score 按等级下标 "0".."K-1"，noul 固定为 false / true。
"""

import json
import math
from typing import Any

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
KINDS = ("noul", "choice", "score")


def text(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def options_for(question: dict[str, Any]) -> list[tuple[str, str]]:
    """返回 [(key, 描述)]；不合法时抛 ValueError（文案可以直接给用户看）。"""
    if not isinstance(question, dict):
        raise ValueError("问题必须是对象")
    if not str(question.get("instructions") or "").strip():
        raise ValueError("问题缺少 instructions")
    kind, criteria = question.get("type"), question.get("criteria")
    if kind == "choice":
        if not isinstance(criteria, dict):
            raise ValueError("choice 的 criteria 必须是 {键: 描述} 对象")
        options = [(str(k), text(v)) for k, v in criteria.items()]
    elif kind == "score":
        if not isinstance(criteria, list):
            raise ValueError("score 的 criteria 必须是从低到高排列的列表")
        options = [(str(i), text(v)) for i, v in enumerate(criteria)]
    elif kind == "noul":
        if criteria is not None and not isinstance(criteria, dict):
            raise ValueError("noul 的 criteria 必须是 {false: ..., true: ...} 对象")
        criteria = criteria or {}
        options = [("false", text(criteria.get("false", "否"))), ("true", text(criteria.get("true", "是")))]
    else:
        raise ValueError(f"未知题型：{kind}（只支持 noul / choice / score）")
    if not 2 <= len(options) <= len(LETTERS):
        raise ValueError(f"候选项数量必须在 2–{len(LETTERS)} 之间，当前 {len(options)} 个")
    return options


def target_for(gold: Any, keys: list[str], kind: str) -> list[float]:
    """标准答案 → 候选项上的目标分布。支持直接写键（"billing" / true / 2）或 {"probabilities": {...}}。"""
    if isinstance(gold, dict) and "probabilities" in gold:
        probabilities = gold["probabilities"]
        if not isinstance(probabilities, dict) or set(map(str, probabilities)) != set(keys):
            raise ValueError("gold.probabilities 的键必须和候选项完全一致")
        target = [float(probabilities.get(k, probabilities.get(int(k) if k.isdigit() else k, 0.0))) for k in keys]
    else:
        if isinstance(gold, bool):
            answer = "true" if gold else "false"
        elif kind == "noul":
            answer = {"是": "true", "否": "false", "yes": "true", "no": "false"}.get(
                str(gold).lower(), str(gold).lower()
            )
        else:
            answer = str(gold)
        if answer not in keys:
            raise ValueError(f"标准答案 {gold!r} 不在候选项 {keys} 里")
        target = [float(k == answer) for k in keys]
    total = sum(target)
    if any(not math.isfinite(p) or p < 0 for p in target) or total <= 0:
        raise ValueError("标准答案不是合法的概率分布")
    return [p / total for p in target]


def softmax(logits: list[float], temperature: float = 1.0) -> list[float]:
    scaled = [x / temperature for x in logits]
    top = max(scaled)
    exps = [math.exp(x - top) for x in scaled]
    total = sum(exps)
    return [e / total for e in exps]


def hmm_confidence(probabilities: list[float]) -> float:
    """hmm / 决策服务返回的 confidence：(K·p_max − 1) / (K − 1)，衡量分布尖锐程度，不等于准确率。"""
    k = len(probabilities)
    return (k * max(probabilities) - 1) / (k - 1)


def prediction_of(kind: str, keys: list[str], probabilities: list[float]) -> str:
    return keys[max(range(len(probabilities)), key=probabilities.__getitem__)]


def user_prompt(state: Any, instructions: Any, options: list[tuple[str, str]]) -> str:
    """与 decision.schema.user_prompt 一致的用户提示词；只用于给对照大模型提问。"""
    return (
        "待判断的上下文：\n"
        + text(state)
        + "\n\n问题：\n"
        + text(instructions)
        + "\n\n候选项：\n"
        + "\n".join(f"{LETTERS[i]}: {k} — {v}" for i, (k, v) in enumerate(options))
        + "\n只返回候选项对应的字母。"
    )
