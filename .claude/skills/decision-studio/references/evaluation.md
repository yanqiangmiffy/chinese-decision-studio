# 评测与校准

评测的目的不是“跑一个分数”，而是回答三个问题：**准不准、校准好不好、自动执行多少才安全**。

## 1. 建评测集

用例格式与 CJ-Bench 一致：

```json
{
  "state": "付款后没收到发票",
  "questions": {
    "dept": {"type": "choice", "instructions": "哪个部门？", "criteria": {"billing": "账单", "tech": "技术"}}
  },
  "gold": {"dept": "billing"},
  "meta": {"tag": "账单"}
}
```

- `gold` 支持键名、`true`/`false`、score 下标（0 开始）或 `{"probabilities": {...}}`。
- 单问题简写也支持：`{"state": ..., "type": "choice", "instructions": ..., "criteria": ..., "answer": ...}`。
- CSV 列：`state, type, instructions, criteria, answer, tag`；`criteria` 可写 JSON，也可写 `billing:支付与发票|technical:故障`。
- 一个用例可以包含多个问题；评测会按问题展开成多条结果。

### 从历史记录建集

```text
decide(log=true) -> log_id
list_recent_decisions(source="mcp")
get_decision(log_id)
label_decision(log_id, labels={"dept": "billing"})
add_decision_to_suite(log_id, suite_id)
```

只把标注过的问题转成用例；没有标注的记录不会进入评测集。真实调用 + 人工标注通常比凭空造题更有价值。

### 直接建集

```text
create_suite(name="客服意图", description="...")
add_suite_cases(suite_id, cases=[...])
```

或：

```text
import_suite(content="<jsonl 文本>", filename="cases.jsonl", name="客服意图")
```

`add_suite_cases` 最多 200 条，会先本地校验；`import_suite` 会返回 `imported / skipped / errors`，部分非法行会被跳过。

## 2. 跑评测

```text
start_evaluation(suite_id, temperature=1.0, compare_llm=false, limit=null)
  -> run_id

get_evaluation(run_id)   # 轮询到 status=completed/failed/cancelled
```

- 评测是后台任务，启动后立即返回；不要在一次工具调用里阻塞等待。
- `limit` 可以只跑前 N 条做冒烟。
- `temperature` 只影响客户端重算概率和指标，不改模型；默认 1.0。
- 每批结果立即落库，服务重启会把未完成的运行标成失败。

## 3. 读报告

`get_evaluation(run_id)` 的 `metrics`：

| 字段 | 含义 |
| --- | --- |
| `overall` | 全部结果的 ACC / ECE / NLL / Brier；`hard_n` 是硬标签样本数 |
| `by_kind` | 按 noul / choice / score 拆分 |
| `by_tag` | 按用例 `meta.tag` 拆分（最多 30 个） |
| `selective` | 覆盖率-准确率曲线：阈值 0→1，`coverage`、`accuracy`、`kept`、`errors_kept` |
| `budgets` | 自动执行准确率 ≥90% / 95% / 99% 时能达到的最大覆盖率 |
| `histogram` | 置信度分布（正确/错误） |
| `calibration` | 温度拟合：`temperature`、`before`、`after`、`reliability_after` |
| `confusion` | 同一问题且候选项相同的硬标签样本的混淆矩阵（最多 6 个） |
| `llm` | 与对照大模型的比较（未配置或未开启时为 null） |
| `throughput` | 决策数 / 决策耗时 |

### ACC 和 ECE 怎么读

- **ACC** 只看硬标签：目标分布里有一个候选概率为 1。软标签不计入 ACC。
- **ECE** 是 15 个等宽分箱的校准误差，置信度取 `p_max`。ECE 5% 左右算不错；30% 以上说明概率不能直接当置信度用。
- **NLL / Brier** 覆盖全部样本（含软标签），越低越好。
- 小评测集（几十条）的 ACC 波动很大；不要用 20 条样本的 95% 宣称“准确率 95%”。

### 复核预算怎么用

1. 看 `selective`：横轴阈值、纵轴覆盖率和准确率。
2. 看 `budgets["0.95"]`：要求自动执行部分准确率 ≥95% 时，最高覆盖率是多少。
3. 业务能接受多少人工复核量，就选对应的阈值；低于阈值的样本交给人。
4. 按 `by_kind` / `by_tag` 分别看：不同题型、不同标签的最优阈值可能不同。
5. 阈值不是一劳永逸：数据分布变化后要重跑。

### 温度校准

`calibration.temperature` 是在本次运行 logits 上使 NLL 最小的温度，只用于诊断。`after` 是重算后的指标。可用样本少于 10 条时 `calibration` 为 `null`。多数自建集上 T* < 1，说明模型偏保守；但不要直接把 T* 写死到生产，先在独立数据上验证。

## 4. 对照生成式大模型

`start_evaluation(..., compare_llm=true)` 需要配置 `LLM_BASE_URL`。平台用同样的题面问大模型，读候选字母上的 logprobs；不支持 logprobs 的服务会退化成解析字母、one-hot 概率。

报告里的 `metrics.llm`：

- `agreement`：两边预测一致率；
- `decision` / `llm`：各自的 ACC / ECE / NLL / Brier / 可靠性；
- `llm_latency_p50_ms` / `p95_ms`。

注意：只对前 `LLM_EVAL_LIMIT` 条做对照；大模型慢，评测会明显变长。对照结果只用于选型，不要让大模型结果参与决策模型的阈值拟合。

## 5. 常见误区

- **只看 ACC，不看 ECE**：高准确率但过度自信的模型不适合自动执行。
- **在训练/调参用过的样本上评测**：会高估。留出独立测试集。
- **用单次概率代替评测**：单次 0.99 不代表这一类问题的准确率。
- **混用不同题型的阈值**：noul、choice、score 的 `p_max` 分布不同，分开看。
- **忽略错误样本**：用 `get_evaluation(include_results=true, result_filter="wrong")` 看错例，按 tag 找系统性偏差。
- **忽略软标签**：`gold` 是概率分布时，ACC 不统计它；用 NLL/Brier 看这部分。

## 6. 报告模板

```markdown
## 评测结论

- 评测集：<名称>（<用例数> 条 / <问题数> 个）
- 模型：step <step>，prompt <version>
- 总体：ACC <x>% · ECE <y>% · NLL <z>
- 分题型：noul <...> · choice <...> · score <...>
- 校准：T* = <...>；校准后 ECE <...>
- 复核预算：自动执行准确率 ≥95% 时覆盖 <...>%，错误漏出 <...> 条
- 错例：<按 tag 归纳 2–3 类系统性问题>
- 建议：<阈值 / 是否上线 / 需要补的数据>
```

把结论和依据放在一起；不要只给一个分数。
