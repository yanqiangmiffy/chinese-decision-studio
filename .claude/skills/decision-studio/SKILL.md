---
name: decision-studio
description: Use when a task involves Chinese Decision / Decision Studio, the decision model, noul/choice/score questions, probability or confidence judgments, selective prediction thresholds, robustness checks, evaluation suites, ACC/ECE/calibration, review budgets, or the Decision Studio MCP tools. Trigger on phrases like "用决策模型判断", "做个选择题", "给这些评论分类", "评估这个分类器", "跑评测", "看校准", "复核预算", "compare with an LLM", even if the user does not name the platform.
---

# Decision Studio

Chinese Decision 是一个只做判断、不生成文本的中文决策模型（Qwen3.5-0.8B + LoRA）。给定上下文和一组候选项，它读取末位候选字母的 logits，softmax 之后就是概率。Decision Studio 是它的测试平台；本技能通过 MCP 工具把平台能力交给 agent。

## 什么时候用

适合：

- 把一段中文上下文归到 2–26 个类别之一；
- 判断一个是/否问题；
- 做有序评分（例如不满程度、优先级）；
- 需要看模型对判断的把握，设置“自动执行 / 人工复核”阈值；
- 需要做鲁棒性检查、评测、与生成式大模型对照。

不适合：开放式生成、摘要、多步推理、需要外部工具的任务。这些交给生成式大模型。

## 连接

项目根目录的 `.mcp.json` 已指向 `http://localhost:8080/api/mcp/`。本地直接跑后端时改成 `http://localhost:8090/api/mcp/`。如果服务端设置了 `MCP_AUTH_TOKEN`，客户端要带 `Authorization: Bearer <token>`。

先调用 `studio_health`：

- `decision.online=false`：决策服务不可达，不要继续调用 `decide`；
- `database=false`：评测集、历史、评测运行工具不可用；
- `llm.configured=false`：不能做“决策模型 vs 大模型”对照。

## 路由

| 你要做的事 | 读 |
| --- | --- |
| 调用工具、批量、锦标赛、证据归因、鲁棒性、评测运行、压测 | `references/tools.md` |
| 选题型、写问法、候选项命名、阈值、已知短板 | `references/question-design.md` |
| 建评测集、跑评测、读 ACC/ECE/复核预算、对照大模型 | `references/evaluation.md` |

## 标准流程

1. 明确判断对象和输出：二选一、多分类，还是有序评分。
2. 按 `question-design.md` 选题型、写问法、准备候选项。
3. 用 `decide` 跑 3–5 个有代表性的样本，检查概率和胜出项是否合理。
4. 如果要用在生产：建评测集（历史标注或导入）→ `start_evaluation` → 读报告 → 选阈值。
5. 高风险或数据分布会变化时，跑 `test_robustness`，并定期重跑评测。

## 护栏

- **概率不是事实。** 0.9 也可能错；先在自己的数据上看准确率和校准，再决定怎么用。
- **高风险场景不要只凭单次概率自动执行。** 医疗、法律、金融、招聘、内容处罚等场景用复核带：高置信自动、低置信交给人。
- **不要把无关材料塞进 `state`。** 实测无关上下文会显著改变概率（例如护栏场景去掉“应用说明”后，隐私检测从 0.36 升到 0.73）。
- **已知短板**：双重否定、数字/日期比较、需要外部知识的推理、剧透判断。遇到这些先做小样本验证，不要直接上线。
- **GPU 是共享的。** `decide_batch` 一次最多 512 项；`run_benchmark` 默认小规模，不要无节制加大并发和 total。
- **不要通过 MCP 发送密钥、身份证号等敏感信息。** 决策历史会落库。

## 输出建议

报告一次决策时，至少给出：胜出候选、概率、第二名及差距、置信度/阈值建议、是否建议人工复核。不要只写“模型认为是 X”。
