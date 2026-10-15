"""纯函数：题型展开、标准答案、指标、导入解析。"""

import math

import pytest

from app.services.analysis_service import segments_of, split_sentences
from app.services.decision_math import hmm_confidence, options_for, softmax, target_for, user_prompt
from app.services.metrics import fit_temperature, group_metrics, selective_curve, summarize_run
from app.services.suite_service import normalize, parse_upload


def test_options_follow_decision_schema_order():
    assert options_for({"type": "noul", "instructions": "x"}) == [("false", "否"), ("true", "是")]
    assert [k for k, _ in options_for({"type": "score", "instructions": "x", "criteria": ["低", "中", "高"]})] == [
        "0",
        "1",
        "2",
    ]
    choice = options_for({"type": "choice", "instructions": "x", "criteria": {"b": "乙", "a": "甲"}})
    assert [k for k, _ in choice] == ["b", "a"]


@pytest.mark.parametrize(
    "question",
    [
        {"type": "choice", "instructions": "x", "criteria": ["a", "b"]},
        {"type": "score", "instructions": "x", "criteria": {"a": 1}},
        {"type": "unknown", "instructions": "x"},
        {"type": "noul", "instructions": ""},
        {"type": "choice", "instructions": "x", "criteria": {"only": "一个"}},
    ],
)
def test_invalid_questions_are_rejected(question):
    with pytest.raises(ValueError):
        options_for(question)


def test_target_accepts_keys_booleans_and_distributions():
    assert target_for(True, ["false", "true"], "noul") == [0.0, 1.0]
    assert target_for("是", ["false", "true"], "noul") == [0.0, 1.0]
    assert target_for(2, ["0", "1", "2"], "score") == [0.0, 0.0, 1.0]
    assert target_for({"probabilities": {"a": 0.25, "b": 0.75}}, ["a", "b"], "choice") == [0.25, 0.75]
    with pytest.raises(ValueError):
        target_for("c", ["a", "b"], "choice")


def test_softmax_temperature_and_confidence():
    p = softmax([2.0, 0.0])
    assert math.isclose(sum(p), 1.0)
    assert softmax([2.0, 0.0], 10.0)[0] < p[0]  # 温度越高越平
    assert math.isclose(hmm_confidence([0.5, 0.5]), 0.0)
    assert math.isclose(hmm_confidence([1.0, 0.0, 0.0]), 1.0)


def test_user_prompt_matches_training_layout():
    prompt = user_prompt("上下文", "问题？", [("a", "甲"), ("b", "乙")])
    assert prompt.startswith("待判断的上下文：\n上下文\n\n问题：\n问题？\n\n候选项：\nA: a — 甲\nB: b — 乙")
    assert prompt.endswith("只返回候选项对应的字母。")


def _row(p_true: float, label: int, kind: str = "noul") -> dict:
    probabilities = [1 - p_true, p_true]
    target = [float(label == 0), float(label == 1)]
    winner = int(p_true >= 0.5)
    return {
        "target": target,
        "probabilities": probabilities,
        "hard": True,
        "kind": kind,
        "keys": ["false", "true"],
        "question": "q",
        "prediction": ["false", "true"][winner],
        "correct": winner == label,
        "p_max": max(probabilities),
        "logits": [0.0, math.log(p_true / (1 - p_true))],
        "tag": "t",
    }


def test_group_metrics_perfect_and_calibrated():
    rows = [_row(0.99, 1) for _ in range(20)] + [_row(0.01, 0) for _ in range(20)]
    m = group_metrics(rows)
    assert m["accuracy"] == 1.0
    assert m["ece"] < 0.02
    assert sum(b["n"] for b in m["reliability"]) == 40


def test_selective_curve_monotone_coverage():
    rows = [_row(0.95, 1), _row(0.6, 0), _row(0.9, 1), _row(0.55, 1)]
    curve = selective_curve(rows)
    coverages = [p["coverage"] for p in curve]
    assert coverages[0] == 1.0 and coverages == sorted(coverages, reverse=True)


def test_fit_temperature_detects_overconfidence():
    # 过度自信：概率 0.99，但只有 70% 正确 → 最优温度应明显大于 1
    rows = [_row(0.99, 1) for _ in range(70)] + [_row(0.99, 0) for _ in range(30)]
    fitted = fit_temperature(rows)
    assert fitted is not None and fitted["temperature"] > 1.5
    assert fitted["after"]["nll"] < fitted["before"]["nll"]


def test_summarize_run_has_budgets_and_kinds():
    rows = [_row(0.9, 1) for _ in range(8)] + [_row(0.7, 0) for _ in range(2)]
    report = summarize_run(rows)
    assert set(report["by_kind"]) == {"noul"}
    assert "0.95" in report["budgets"]
    assert report["histogram"]


def test_normalize_short_form_and_cj_format():
    short = normalize(
        {
            "state": "s",
            "type": "choice",
            "instructions": "x",
            "criteria": {"a": "甲", "b": "乙"},
            "answer": "b",
            "tag": "t1",
        }
    )
    assert short["questions"]["q"]["type"] == "choice" and short["gold"] == {"q": "b"} and short["meta"]["tag"] == "t1"
    cj = normalize(
        {
            "id": "x",
            "state": {"材料": "m"},
            "questions": {"q": {"type": "noul", "instructions": "x"}},
            "gold": {"q": {"type": "noul", "probabilities": {"false": 0.0, "true": 1.0}}},
            "_meta": {"source_family": "c3"},
        }
    )
    assert cj["meta"]["tag"] == "c3"
    with pytest.raises(ValueError):
        normalize({"state": "s", "type": "noul", "instructions": "x"})  # 没有标准答案


def test_parse_upload_jsonl_and_csv_report_errors():
    jsonl = (
        '{"state": "a", "type": "noul", "instructions": "x", "answer": true}\n'
        "not json\n"
        '{"state": "b", "type": "score", "instructions": "x", "criteria": ["低", "高"], "answer": 5}\n'
    ).encode()
    result = parse_upload("x.jsonl", jsonl, limit=100)
    assert len(result.cases) == 1 and result.skipped == 2 and len(result.errors) == 2
    csv_data = "state,type,instructions,criteria,answer,tag\n文本,choice,选哪个,a:甲|b:乙,a,标签\n".encode()
    result = parse_upload("x.csv", csv_data, limit=100)
    assert result.cases[0]["questions"]["q"]["criteria"] == {"a": "甲", "b": "乙"}


def test_segments_split_text_and_json():
    parts = split_sentences("第一句。第二句！第三句？")
    assert parts == ["第一句。", "第二句！", "第三句？"]
    labels, variants = segments_of({"标题": "t", "正文": "b"})
    assert len(labels) == 2 and variants[0] == {"正文": "b"}
