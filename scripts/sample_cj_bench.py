"""从 CJ-Bench 测试集按 领域 × 题型 分层抽样，生成平台的内置评测集 cj-bench-sample.jsonl。

只依赖标准库，直接在放数据集的机器上运行：

  python3 sample_cj_bench.py --bench /data/.../datasets/CJ-Bench --per-stratum 25 --out cj-bench-sample.jsonl

再把输出文件放到 backend/data/suites/ 下，执行 python -m app.scripts.seed。
CJ-Bench 的许可按数据来源分别适用（部分来源为非商业许可），抽样文件只用于内部测试，不要随仓库公开发布。
"""

import argparse
import gzip
import json
import random
from pathlib import Path

DOMAINS = ("general", "medical", "legal", "finance")
KINDS = ("noul", "choice", "score")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bench", required=True)
    parser.add_argument("--per-stratum", type=int, default=25)
    parser.add_argument("--max-chars", type=int, default=3000, help="跳过上下文过长的样本，保证评测速度")
    parser.add_argument("--seed", type=int, default=20261014)
    parser.add_argument("--out", default="cj-bench-sample.jsonl")
    args = parser.parse_args()
    rng = random.Random(args.seed)
    out = []
    for domain in DOMAINS:
        path = Path(args.bench) / domain / "test.cases.jsonl.gz"
        reservoirs = {k: [] for k in KINDS}
        seen = {k: 0 for k in KINDS}
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            for line in stream:
                case = json.loads(line)
                if len(case["questions"]) != 1:
                    continue
                kind = next(iter(case["questions"].values()))["type"]
                state = case["state"] if isinstance(case["state"], str) else json.dumps(case["state"], ensure_ascii=False)
                if kind not in reservoirs or len(state) > args.max_chars:
                    continue
                gold = next(iter(case["gold"].values()))
                if max(gold["probabilities"].values()) < 1 - 1e-6:
                    continue  # 只取硬标签，报告里的 ACC / ECE 才和官方口径一致
                seen[kind] += 1
                bucket = reservoirs[kind]
                if len(bucket) < args.per_stratum:
                    bucket.append(case)
                else:
                    j = rng.randrange(seen[kind])
                    if j < args.per_stratum:
                        bucket[j] = case
        for kind in KINDS:
            for case in reservoirs[kind]:
                meta = case.get("_meta") or {}
                out.append({"id": case["id"][:120], "state": case["state"], "questions": case["questions"],
                            "gold": case["gold"],
                            "meta": {"tag": domain, "domain": domain,
                                     "source": meta.get("source_family") or meta.get("source_id") or meta.get("source")}})
        print(domain, {k: len(v) for k, v in reservoirs.items()})
    rng.shuffle(out)
    Path(args.out).write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in out) + "\n", encoding="utf-8")
    print(f"wrote {len(out)} cases to {args.out}")


if __name__ == "__main__":
    main()
