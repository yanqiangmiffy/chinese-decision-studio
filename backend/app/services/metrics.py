"""评测指标：口径与 CJ-Bench 一致。

- ACC 与 ECE 只统计硬标签（目标分布里有一个候选的概率为 1）；NLL 与 Brier 覆盖全部样本。
- ECE 用 15 个等宽分箱，置信度取 p_max（与 chinese-decision/decision/metrics.py 的 Accumulator 相同）。
- 选择性预测：按 p_max 从高到低排序，"只对置信度 ≥ t 的样本自动执行"时的覆盖率和准确率。
- 温度校准：在本次运行的 logits 上用黄金分割搜索 T，使 NLL 最小（只用于诊断，不改模型）。
"""

import math
from collections import Counter, defaultdict
from typing import Any

from app.services.decision_math import softmax

BINS = 15


def _safe_log(p: float) -> float:
    return math.log(max(p, 1e-12))


def group_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """rows: [{target, probabilities, hard, kind}]"""
    n = len(rows)
    if not n:
        return {"n": 0, "hard_n": 0, "accuracy": None, "ece": None, "nll": None, "brier": None}
    nll = brier = 0.0
    hard_n = hits = 0
    bins_n, bins_hits, bins_conf = [0] * BINS, [0] * BINS, [0.0] * BINS
    score_n, score_mae = 0, 0.0
    for row in rows:
        target, probabilities = row["target"], row["probabilities"]
        nll += -sum(t * _safe_log(p) for t, p in zip(target, probabilities, strict=True))
        brier += sum((p - t) ** 2 for p, t in zip(probabilities, target, strict=True))
        if row["hard"]:
            winner = max(range(len(probabilities)), key=probabilities.__getitem__)
            label = max(range(len(target)), key=target.__getitem__)
            hit = int(winner == label)
            confidence = min(1.0, probabilities[winner])
            index = min(BINS - 1, int(confidence * BINS))
            hard_n += 1
            hits += hit
            bins_n[index] += 1
            bins_hits[index] += hit
            bins_conf[index] += confidence
        if row["kind"] == "score":
            score_n += 1
            expected = sum(i * p for i, p in enumerate(probabilities))
            target_expected = sum(i * t for i, t in enumerate(target))
            score_mae += abs(expected - target_expected)
    ece = sum(abs(h - c) for h, c in zip(bins_hits, bins_conf, strict=True)) / hard_n if hard_n else None
    reliability = [
        {
            "lo": b / BINS,
            "hi": (b + 1) / BINS,
            "n": bins_n[b],
            "accuracy": bins_hits[b] / bins_n[b] if bins_n[b] else None,
            "confidence": bins_conf[b] / bins_n[b] if bins_n[b] else None,
        }
        for b in range(BINS)
    ]
    return {
        "n": n,
        "hard_n": hard_n,
        "accuracy": hits / hard_n if hard_n else None,
        "ece": ece,
        "nll": nll / n,
        "brier": brier / n,
        "score_n": score_n,
        "score_mae": score_mae / score_n if score_n else None,
        "reliability": reliability,
    }


def selective_curve(rows: list[dict[str, Any]], points: int = 41) -> list[dict[str, float]]:
    """覆盖率-准确率曲线：阈值 t 从 0 到 1，只自动执行 p_max ≥ t 的硬标签样本。"""
    hard = [(r["p_max"], 1 if r["correct"] else 0) for r in rows if r["hard"] and r["correct"] is not None]
    if not hard:
        return []
    total = len(hard)
    curve = []
    for i in range(points):
        t = i / (points - 1)
        kept = [c for p, c in hard if p >= t]
        curve.append(
            {
                "threshold": round(t, 4),
                "coverage": len(kept) / total,
                "accuracy": sum(kept) / len(kept) if kept else None,
                "kept": len(kept),
                "errors_kept": len(kept) - sum(kept),
            }
        )
    return curve


def confidence_histogram(rows: list[dict[str, Any]], bins: int = 20) -> list[dict[str, Any]]:
    out = [{"lo": b / bins, "hi": (b + 1) / bins, "correct": 0, "wrong": 0} for b in range(bins)]
    for r in rows:
        if not r["hard"] or r["correct"] is None:
            continue
        index = min(bins - 1, int(r["p_max"] * bins))
        out[index]["correct" if r["correct"] else "wrong"] += 1
    return out


def fit_temperature(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """在 logits 上搜索使 NLL 最小的温度 T（0.25–8，对数空间黄金分割）。"""
    usable = [r for r in rows if r.get("logits") and len(r["logits"]) == len(r["target"])]
    if len(usable) < 10:
        return None

    def nll_at(log_t: float) -> float:
        t = math.exp(log_t)
        return sum(
            -sum(tg * _safe_log(p) for tg, p in zip(r["target"], softmax(r["logits"], t), strict=True)) for r in usable
        ) / len(usable)

    lo, hi = math.log(0.25), math.log(8.0)
    ratio = (math.sqrt(5) - 1) / 2
    a, b = hi - ratio * (hi - lo), lo + ratio * (hi - lo)
    fa, fb = nll_at(a), nll_at(b)
    for _ in range(40):
        if fa < fb:
            hi, b, fb = b, a, fa
            a = hi - ratio * (hi - lo)
            fa = nll_at(a)
        else:
            lo, a, fa = a, b, fb
            b = lo + ratio * (hi - lo)
            fb = nll_at(b)
    best_t = math.exp((lo + hi) / 2)
    rescaled = [{**r, "probabilities": softmax(r["logits"], best_t)} for r in usable]
    before = group_metrics(usable)
    after = group_metrics(rescaled)
    return {
        "temperature": best_t,
        "n": len(usable),
        "before": {k: before[k] for k in ("accuracy", "ece", "nll", "brier")},
        "after": {k: after[k] for k in ("accuracy", "ece", "nll", "brier")},
        "reliability_after": after["reliability"],
    }


def confusion_matrices(rows: list[dict[str, Any]], limit: int = 6) -> list[dict[str, Any]]:
    """同一问题名且候选项完全相同的硬标签样本，各自出一个混淆矩阵（最多 limit 个，按样本数排序）。"""
    groups: dict[tuple[str, tuple[str, ...]], list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        if r["hard"] and len(r["keys"]) <= 12:
            groups[(r["question"], tuple(r["keys"]))].append(r)
    out = []
    for (question, keys), items in sorted(groups.items(), key=lambda kv: -len(kv[1]))[:limit]:
        if len(items) < 3:
            continue
        counts = Counter()
        for r in items:
            label = keys[max(range(len(keys)), key=r["target"].__getitem__)]
            counts[(label, r["prediction"])] += 1
        out.append(
            {
                "question": question,
                "kind": items[0]["kind"],
                "keys": list(keys),
                "n": len(items),
                "matrix": [[counts[(gold, pred)] for pred in keys] for gold in keys],
            }
        )
    return out


def summarize_run(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """一次评测运行的完整报告。rows 是 RunResult 的字典形式（不含出错的行）。"""
    overall = group_metrics(rows)
    by_kind = {k: group_metrics([r for r in rows if r["kind"] == k]) for k in ("noul", "choice", "score")}
    by_tag: dict[str, Any] = {}
    tags = Counter(r["tag"] for r in rows if r.get("tag"))
    for tag, _ in tags.most_common(30):
        m = group_metrics([r for r in rows if r.get("tag") == tag])
        by_tag[tag] = {k: m[k] for k in ("n", "hard_n", "accuracy", "ece", "nll", "brier")}
    curve = selective_curve(rows)
    # 常用的"复核预算"读数：要求自动执行部分的准确率 ≥ 95% / 99% 时，最高能覆盖多少
    budgets = {}
    for goal in (0.9, 0.95, 0.99):
        feasible = [p for p in curve if p["accuracy"] is not None and p["accuracy"] >= goal and p["kept"] > 0]
        best = max(feasible, key=lambda p: p["coverage"]) if feasible else None
        budgets[str(goal)] = best
    return {
        "overall": overall,
        "by_kind": {k: v for k, v in by_kind.items() if v["n"]},
        "by_tag": by_tag,
        "selective": curve,
        "budgets": budgets,
        "histogram": confidence_histogram(rows),
        "calibration": fit_temperature(rows),
        "confusion": confusion_matrices(rows),
    }


def compare_llm(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """对照大模型：只在两边都有结果的样本上比较（同一批题）。"""
    paired = [r for r in rows if r.get("llm") and r["llm"].get("probabilities")]
    if not paired:
        return None
    decision_rows = paired
    llm_rows = [{**r, "probabilities": r["llm"]["probabilities"]} for r in paired]
    for r in llm_rows:
        winner = max(range(len(r["probabilities"])), key=r["probabilities"].__getitem__)
        r["p_max"] = r["probabilities"][winner]
        r["correct"] = (winner == max(range(len(r["target"])), key=r["target"].__getitem__)) if r["hard"] else None
    d, m = group_metrics(decision_rows), group_metrics(llm_rows)
    latencies = sorted(r["llm"].get("latency_ms", 0.0) for r in paired)
    agree = sum(1 for r in paired if r["llm"].get("prediction") == r["prediction"])
    return {
        "model": paired[0]["llm"].get("model"),
        "n": len(paired),
        "agreement": agree / len(paired),
        "decision": {k: d[k] for k in ("accuracy", "ece", "nll", "brier", "reliability")},
        "llm": {k: m[k] for k in ("accuracy", "ece", "nll", "brier", "reliability")},
        "llm_latency_p50_ms": latencies[len(latencies) // 2],
        "llm_latency_p95_ms": latencies[min(len(latencies) - 1, int(0.95 * len(latencies)))],
    }
