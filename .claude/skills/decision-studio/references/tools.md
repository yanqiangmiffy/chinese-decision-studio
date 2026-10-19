# MCP 工具参考

所有工具返回 JSON；MCP 客户端里通常在 `result.content[0].text`。参数不合法、服务不可达时返回 `is_error=True`，消息就是原因。工具名和参数以服务端 `tools/list` 为准。

## 状态与模型

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| `studio_health` | 平台、数据库、决策服务、对照大模型状态 | 无 |
| `get_overview` | 近 14 天调用量、延迟、评测集/运行数量、最近评测、最佳压测 | 无 |
| `get_model_info` | 检查点 step、prompt 版本、推理统计 | `include_training=true` |

## 决策

### `decide`

```json
{
  "state": "客户留言：付款后一直没有收到发票，我已经催了三次。",
  "questions": {
    "dept": {
      "type": "choice",
      "instructions": "应该由哪个部门处理？",
      "criteria": {"billing": "支付与发票", "technical": "故障和系统问题", "sales": "购买咨询"}
    },
    "urgent": {
      "type": "noul",
      "instructions": "客户是否表达了紧迫性？",
      "criteria": {"false": "否", "true": "是"}
    }
  },
  "compare_llm": false,
  "log": true,
  "title": "发票工单",
  "source": "mcp"
}
```

返回 `response.answers`，每个问题包含：

- `type`、`probabilities`（候选键 → 概率）、`logits`、`confidence`、`input_tokens`；
- `choice`（choice 的胜出键）、`noul`（true 的概率）、`score`（期望等级）、`legend`；
- 顶层还有 `response.usage`、`response.latency_ms`、`log_id`、`llm`（对照结果或 `null`）。

一次最多 64 个问题；每个问题 2–26 个候选。`log=true` 会写历史，便于之后标注成评测用例；探索性调用建议 `log=false`。

### `decide_batch`

```json
{
  "requests": [
    {"state": "评论 1", "questions": {"sentiment": {"type": "score", "instructions": "情感？", "criteria": ["负面", "中性", "正面"]}}},
    {"state": "评论 2", "questions": {"sentiment": {"type": "score", "instructions": "情感？", "criteria": ["负面", "中性", "正面"]}}}
  ]
}
```

返回 `results` 列表，顺序与请求一致；单项出错时该项是 `{"error": "..."}`，不影响其他项。最多 512 项，不写历史。

### `decide_tournament`

候选超过 26 个时用。参数：`state`、`question`（choice）、`group_size`（3–26，默认 16）、`keep`（默认 2）、`seed`。返回最终 `answer`、`candidates`、`rounds`。普通 choice 不要用。

### `compile_prompt`

只编译提示词，不调用模型。用来检查 `state`、问题、候选项最终怎么拼成训练格式。

### `explain_decision`

逐段删除上下文，观察目标候选概率下降多少：

```json
{
  "state": "第一句。第二句。第三句。",
  "question": {"type": "noul", "instructions": "这段话是否在投诉？"},
  "target": "true"
}
```

返回 `base`、`base_value`、`segments`（每段的 `text`、`delta`、`value`、`winner`、`flipped`）、`latency_ms`。`delta > 0` 表示删掉这段后目标概率下降，即这段支撑当前判断。调用量约为片段数 + 1，长文本会慢。

### `test_robustness`

```json
{
  "state": "付款后没收到发票。",
  "question": {"type": "choice", "instructions": "哪个部门？", "criteria": {"billing": "账单", "tech": "技术"}},
  "tests": ["order", "naming", "distractor", "injection", "paraphrase"],
  "paraphrases": ["这句话应该转给谁？"],
  "auto_paraphrase": true
}
```

返回：

- `base`：基准答案；
- `tests`：每项测试的 `variants`、`consistency`、`max_delta`、`score`、`verdict`；order 还带 `position_mass` / `position_winner_rate`，injection 带 `mean_lift` / `hijacked`；
- `skipped`：不适用的测试及原因；
- `summary`：综合稳健分（0–100）和分项分数。

`order` / `naming` 只适用于 choice；`paraphrase` 没有手写问法且未配置大模型时会跳过。高分不代表准确，只代表对扰动不敏感。

## 评测集

| 工具 | 说明 |
| --- | --- |
| `list_suites` | 返回 `{suites: [...]}`：评测集、用例数、题型分布、最近一次完成评测的 ACC/ECE |
| `get_suite` | 查看单个评测集；`include_cases=true` 时分页返回用例 |
| `create_suite` | 新建空评测集，返回 `id` |
| `add_suite_cases` | 追加用例（最多 200 条，全部先校验再写入） |
| `import_suite` | 从 JSONL / JSON / CSV 文本导入；`suite_id` 为空时新建 |

用例格式：

```json
{
  "state": "付款后没收到发票",
  "questions": {"dept": {"type": "choice", "instructions": "哪个部门？", "criteria": {"billing": "账单", "tech": "技术"}}},
  "gold": {"dept": "billing"},
  "meta": {"tag": "账单"}
}
```

`gold` 支持键名、`true`/`false`、score 下标（0 开始）或 `{"probabilities": {...}}`。`add_suite_cases` 的 `cases` 是列表；`import_suite` 的 `content` 是文件文本。

## 评测运行

```text
start_evaluation(suite_id, temperature=1.0, compare_llm=false, limit=null)
  -> {id, status: "queued", ...}

get_evaluation(run_id)            # 轮询到 status 为 completed/failed/cancelled
get_evaluation(run_id, include_results=true, result_filter="wrong")
cancel_evaluation(run_id)
list_evaluations(suite_id=...)
```

`get_evaluation` 的 `metrics` 包含 `overall`（ACC/ECE/NLL/Brier）、`kinds`、`tags`、`reliability`、`histogram`、`selective`、`temperature`、`confusion`、`llm`、`throughput`。逐题结果可用 `result_filter=wrong|correct|uncertain|errors|disagree` 过滤。

评测是后台任务：启动后立刻返回，不要阻塞等待；用 `get_evaluation` 轮询。`compare_llm=true` 需要配置 `LLM_BASE_URL`，且只对前 `LLM_EVAL_LIMIT` 条做对照，会明显变慢。

## 历史记录

| 工具 | 说明 |
| --- | --- |
| `list_recent_decisions` | 按关键词 `q`、来源 `source` 分页浏览 |
| `get_decision` | 查看一条完整记录（state/questions/answers/labels/note） |
| `label_decision` | 标注正确答案和备注 |
| `add_decision_to_suite` | 把已标注记录转成评测用例 |

典型流程：`decide(log=true)` → `list_recent_decisions` → `get_decision` → `label_decision` → `add_decision_to_suite`。

## 压测

```text
run_benchmark(preset="short", concurrency=4, total=50, sweep=null)
```

预设：`short`（1 问）、`ticket`（3 问）、`long`（约 1,000 token，2 问）、`fanout`（多问）。也可以传 `body={state, questions}` 自定义。

返回各并发档位的 `levels`、`summary`（含 `best`、`engine`）和 `saved`（压测记录 id）。**会占用共享推理资源**：默认只跑 50 个请求；只有明确需要评估吞吐或找拐点时再调用，不要无节制加大 `concurrency` / `total` / `sweep`。

## 常见错误

| 现象 | 处理 |
| --- | --- |
| `决策服务暂时不可用` | `studio_health` 确认 `decision.online`；不要重试轰炸 |
| `问题 X：...` / `422` | 检查题型、instructions、criteria 数量（2–26） |
| `评测集不存在` / `运行不存在` | 先用 `list_suites` / `list_evaluations` 拿 id |
| `MCP 需要 Authorization` | 客户端加 `Authorization: Bearer <token>` |
| `421 Misdirected Request` | 服务端 `MCP_ALLOWED_HOSTS` 没包含当前 Host |
| `403 Invalid Origin` | 浏览器客户端需要把 Origin 加进 `MCP_ALLOWED_ORIGINS` |
