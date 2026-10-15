"""评测集导入：把 JSONL / JSON / CSV 解析成统一的用例格式，并逐条校验。

统一格式（与 CJ-Bench 一致）：
  {"id": "...", "state": ..., "questions": {name: question}, "gold": {name: answer}, "meta": {"tag": "..."}}

也接受单问题的简写（一行一个问题）：
  {"state": ..., "type": "choice", "instructions": "...", "criteria": {...}, "answer": "billing", "tag": "..."}

CSV 列：state, type, instructions, criteria, answer, tag（可选 id）。criteria 可以写 JSON，也可以写
  choice：billing:支付与发票|technical:故障        score：平静|不满|非常愤怒        noul：留空
"""

import csv
import io
import json
from typing import Any

from app.services.decision_math import options_for, target_for

MAX_ERRORS = 20


class ImportResult:
    def __init__(self) -> None:
        self.cases: list[dict[str, Any]] = []
        self.errors: list[str] = []
        self.skipped = 0

    def fail(self, where: str, message: str) -> None:
        self.skipped += 1
        if len(self.errors) < MAX_ERRORS:
            self.errors.append(f"{where}：{message}")


def _criteria_from_text(kind: str, raw: str) -> Any:
    raw = (raw or "").strip()
    if not raw:
        return None
    if raw[0] in "[{":
        return json.loads(raw)
    parts = [p.strip() for p in raw.split("|") if p.strip()]
    if kind == "score":
        return parts
    if kind == "choice":
        out = {}
        for p in parts:
            key, _, desc = p.partition(":") if ":" in p else p.partition("：")
            out[key.strip()] = (desc or key).strip()
        return out
    return None


def normalize(record: dict[str, Any]) -> dict[str, Any]:
    """把一条记录转换成统一格式并校验；不合法时抛 ValueError。"""
    if not isinstance(record, dict):
        raise ValueError("每条用例必须是 JSON 对象")
    if record.get("state") in (None, ""):
        raise ValueError("缺少 state")
    meta = dict(record.get("meta") or record.get("_meta") or {})
    if record.get("tag"):
        meta["tag"] = str(record["tag"])
    if not meta.get("tag"):
        # CJ-Bench：用 来源/领域 作为标签，方便按来源看指标
        meta["tag"] = str(meta.get("source_family") or meta.get("source") or meta.get("pool_id") or "")[:64]
    if "questions" in record:
        questions, gold = record["questions"], record.get("gold") or {}
        if not isinstance(questions, dict) or not questions:
            raise ValueError("questions 必须是非空对象")
    else:
        kind = record.get("type")
        criteria = record.get("criteria")
        if isinstance(criteria, str):
            criteria = _criteria_from_text(kind, criteria)
        question = {"type": kind, "instructions": record.get("instructions")}
        if criteria is not None:
            question["criteria"] = criteria
        questions = {"q": question}
        gold = {"q": record.get("answer", record.get("gold"))}
    for name, question in questions.items():
        options = options_for(question)
        if name not in gold or gold[name] is None:
            raise ValueError(f"问题 {name} 没有标准答案")
        target_for(gold[name], [k for k, _ in options], question["type"])
    return {
        "external_id": str(record.get("id") or "")[:128],
        "state": record["state"],
        "questions": questions,
        "gold": {k: gold[k] for k in questions},
        "meta": {k: v for k, v in meta.items() if k in ("tag", "source", "source_family", "domain", "note", "pool_id")},
    }


def parse_upload(filename: str, data: bytes, limit: int) -> ImportResult:
    result = ImportResult()
    content = data.decode("utf-8-sig", errors="replace")
    name = filename.lower()
    records: list[tuple[str, Any]] = []
    if name.endswith(".csv"):
        reader = csv.DictReader(io.StringIO(content))
        for i, row in enumerate(reader, start=2):
            record: dict[str, Any] = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            state = record.get("state", "")
            if state[:1] in "[{":
                try:
                    record["state"] = json.loads(state)
                except ValueError:
                    pass
            records.append((f"第 {i} 行", record))
    elif name.endswith(".json"):
        try:
            loaded = json.loads(content)
        except ValueError as exc:
            result.fail("文件", f"不是合法的 JSON：{exc}")
            return result
        items = loaded if isinstance(loaded, list) else loaded.get("cases", []) if isinstance(loaded, dict) else []
        records = [(f"第 {i} 条", r) for i, r in enumerate(items, start=1)]
    else:
        for i, line in enumerate(content.splitlines(), start=1):
            if not line.strip():
                continue
            try:
                records.append((f"第 {i} 行", json.loads(line)))
            except ValueError as exc:
                result.fail(f"第 {i} 行", f"不是合法的 JSON：{exc}")
    for where, record in records:
        if len(result.cases) >= limit:
            result.fail(where, f"超过单次导入上限 {limit} 条，后续内容被忽略")
            break
        try:
            result.cases.append(normalize(record))
        except (ValueError, TypeError, KeyError) as exc:
            result.fail(where, str(exc))
    return result
