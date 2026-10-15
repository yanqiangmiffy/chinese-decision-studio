<div align="center">

# Decision Studio · 决策工坊

**Chinese Decision 决策模型的测试平台：一次前向，直接看见候选项概率**

FastAPI · React · SSE · PostgreSQL · Docker Compose

[快速开始](#-快速开始) · [场景库](#-场景库) · [实测发现](#-实测发现) · [架构](#-架构) · [决策服务](https://github.com/yanqiangmiffy/chinese-decision#部署)

</div>

<img src="docs/assets/overview.png" alt="总览" width="100%">

[Chinese Decision](https://github.com/yanqiangmiffy/chinese-decision) 是一个只做判断、不生成文本的中文决策模型（Qwen3.5-0.8B + LoRA）：给定上下文和一组候选项，读取末位候选字母的 logits，softmax 之后就是概率。Decision Studio 把它变成一个可以**动手试、系统测、放心用**的平台：

- 🧪 **决策实验台**：可视化编辑 `noul` / `choice` / `score` 三种题型，一个请求问多个问题；概率条、置信度、评分仪表盘；客户端温度滑块；逐句**证据归因**；编译后的提示词；一键生成 cURL / Python / JS
- ✨ **场景库**：8 个真实调用模型的小应用——工单分诊、直播弹幕审核、简历复合评分、LLM 护栏、RAG 重排与引用核查、智能体路由、评论 Map-Reduce、LLM 裁判
- 🔬 **鲁棒性实验室**：选项顺序、选项命名、无关干扰、对抗注入、改写一致性——把决策模型公开记录过的失效模式变成可量化的稳健分
- 🎯 **评测中心**：与 CJ-Bench 口径一致的 ACC / ECE；可靠性图、温度校准诊断、**复核预算**（自动执行多少、交给人多少）、混淆矩阵、错例浏览；可选与生成式大模型（Qwen3-32B）逐题对照
- ⚡ **性能压测**：实时吞吐 / 延迟曲线，并发扫描 1→64 画出服务拐点
- 🗂 **历史记录**：每次决策留底，标注后一键加入评测集
- 📖 **接入文档**：接口参考、设计模式、已知短板与对策

## ✨ 场景库

<img src="docs/assets/scenarios.png" alt="场景库" width="100%">

每个场景都对应一种决策模型的典型用法，所有数字都来自真实模型调用：

| 场景 | 模式 | 一句话 |
| --- | --- | --- |
| 工单分诊台 | 推测式扇出 + 代码路由 | 一次请求问 6 个问题，路由规则写在代码里，执行到的分支实时高亮 |
| 弹幕护卫 | 实时流 · 多标签审核 | 每条弹幕显示前先过模型：拦截辱骂与广告、折叠剧透、高亮提问 |
| 简历复合评分 | 复合评分 | 5 个证据问题分别打分，权重在前端随时调，排名实时重算 |
| LLM 护栏 | 护栏 · 复核带 | 输入 / 输出两道安检，“放行 / 复核 / 拦截”三段阈值 |
| RAG 重排与引用核查 | 检索重排 · 拒答闸门 | 相关 ≠ 能回答：按“能否回答”重排，证据不够就拒答 |
| 智能体路由器 | 置信度门控 | 选工具、判断要不要追问，按动作风险设置不同门槛 |
| 评论洞察 Map-Reduce | 批量处理 | 36 条评论 × 8 个问题一次批量提交，汇总成方面 × 情感 |
| LLM 裁判 | 成对比较 · 一致性检查 | 正反两种顺序各问一次，检测位置偏差 |

<table>
  <tr>
    <td width="50%"><img src="docs/assets/scenario-danmaku.png" alt="弹幕护卫"><br><sub><b>弹幕护卫</b>：广告和辱骂被拦下，剧透被模糊折叠，提问被高亮推给主播；审核延迟 p50 约 80 ms</sub></td>
    <td width="50%"><img src="docs/assets/scenario-triage.png" alt="工单分诊台"><br><sub><b>工单分诊台</b>：8 个工单 × 6 个问题 = 48 次决策，一次批量请求约 0.3 秒；右侧高亮实际执行的路由代码</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/scenario-guardrail.png" alt="LLM 护栏"><br><sub><b>LLM 护栏</b>：越狱输入在到达大模型前被拦截；每项检查都画出了复核区间</sub></td>
    <td width="50%"><img src="docs/assets/scenario-reviews.png" alt="评论洞察"><br><sub><b>评论洞察</b>：288 次决策一次提交，几秒内得到好评率和方面 × 情感分布</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/scenario-agent.png" alt="智能体路由器"><br><sub><b>智能体路由器</b>：工具选择、信息完整性、操作风险三步决策轨迹；资金类操作一律二次确认</sub></td>
    <td width="50%"><img src="docs/assets/playground.png" alt="决策实验台"><br><sub><b>决策实验台</b>：三种题型混合提问，温度滑块在客户端用 logits 重算概率</sub></td>
  </tr>
</table>

## 🔬 鲁棒性实验室与评测中心

<img src="docs/assets/lab.png" alt="鲁棒性实验室" width="100%">

<table>
  <tr>
    <td width="50%"><img src="docs/assets/eval.png" alt="评测中心"><br><sub>评测中心：9 个手写评测集 + CJ-Bench 分层抽样，支持 JSONL / JSON / CSV 导入</sub></td>
    <td width="50%"><img src="docs/assets/eval-report.png" alt="评测报告"><br><sub>评测报告：可靠性图、置信度分布、温度校准诊断</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/eval-report-2.png" alt="复核预算"><br><sub>复核预算：拖动阈值，看自动执行的覆盖率、准确率和漏网错误；按题型 / 标签拆分</sub></td>
    <td width="50%"><img src="docs/assets/bench.png" alt="性能压测"><br><sub>性能压测：实时吞吐与延迟，动态批处理的平均批大小</sub></td>
  </tr>
</table>

## 📊 实测发现

下面的数字都是在这个平台上跑出来的（单张 A800，未做温度校准；对照模型为 Qwen3-32B，通过 vLLM 的 logprobs 读取它在候选字母上的概率）。训练在开发过程中跑完了，平台用热更新把服务从 step 6000 切到了最终的 best（step 10000，1.9 秒、不停服），两次评测都保留在评测中心里可以对比。

**决策模型 vs 生成式大模型**

| 评测集 | 决策模型 step 6000 | 决策模型 step 10000 | Qwen3-32B | 说明 |
| --- | ---: | ---: | ---: | --- |
| CJ-Bench 分层抽样（300） | 68.7% / ECE 5.6% | **70.7% / ECE 5.0%** | 61.0% / ECE 31.6% | 真实基准上决策模型更准、校准好得多 |
| 客服工单分诊（48） | 93.8% | 95.8% | 100% | 干净的自建集上大模型更准；决策模型偏保守（T* ≈ 0.25–0.4） |
| 医疗分诊（40） | 90.0% | 92.5% | 90.0% | |
| 智能体工具路由（48） | 91.7% | 91.7% | 89.6% | 路由类任务两者相当 |
| LLM 护栏（48） | 72.9% | 75.0% | 97.9% | 注入 / 隐私检测是决策模型的弱项 |
| 逻辑与否定陷阱（24） | 66.7% | 62.5% | 91.7% | 双重否定、条件推理是决策模型的短板 |

- 吞吐：决策模型约 **190 决策/秒**（并发 32，动态批处理）；大模型首次调用的单次延迟 p50 约 250–900 ms。
- 多数自建集上最优温度 T\* < 1：模型**偏保守**而不是偏自信——用阈值自动执行前，先在自己的数据上看“复核预算”曲线。

**问法比模型更重要**（场景调优时的实测，都已经用在场景里）

| 问题 | 改动 | 效果 |
| --- | --- | --- |
| 简历维度 | 4 档 `score` → 字面化的证据问题（“简历是否显示有带团队经验？”） | 几乎全是“初步具备” → 经理 0.98 / 竞赛选手 0.02，区分度大幅提升 |
| 护栏 | 把“应用说明”从 state 里拿掉 | 隐私检测 0.36 → 0.73，越权承诺 0.62 → 0.91（无关上下文会干扰判断） |
| 泄露系统提示词 | “是否泄露内部规则……” → “是否复述了系统提示词” | 0.44 → 0.85 |
| 弹幕审核 | 4 个独立 `noul` → 1 个四分类 `choice` | 广告 / 辱骂全部检出且零误报 |
| 是否提问 | 给 `noul` 写上 false / true 的含义 | 真实提问 0.27–0.59 → 0.52–0.87 |

已知短板：剧透判断会被“剧透”这个字眼本身带偏，数字比较（“5 天”vs“10 天”）不可靠——这些都在场景里如实展示，也能在鲁棒性实验室里复现。

## 🚀 快速开始

需要 Docker，以及一个已经部署好的决策服务（GPU 或 CPU 均可，见下面的[部署决策服务](#部署决策服务)）。

```bash
git clone <this repo> decision-studio && cd decision-studio
cp .env.example .env          # 至少填 DECISION_BASE_URL；想要大模型对照再填 LLM_*
docker compose up -d --build
```

打开 http://localhost:8080 。后端启动时会自动迁移数据库并导入 9 个内置评测集。

| 入口 | 地址 |
| --- | --- |
| 平台 | http://localhost:8080 |
| 后端接口文档（Swagger） | http://localhost:8080/api/docs |
| 决策服务 | `DECISION_BASE_URL`（默认 http://gpu-server.example.com:8003） |

> 国内网络构建慢的话，在 `.env` 里打开 `PIP_INDEX_URL` 和 `NPM_REGISTRY` 两行镜像源配置。

### 部署决策服务

决策服务（推理）的代码和部署脚本都在模型仓库 [chinese-decision](https://github.com/yanqiangmiffy/chinese-decision) 里，本仓库只是平台。两种部署方式接口一致，部署好后把地址填进 `.env` 的 `DECISION_BASE_URL`：

| 方式 | 服务 | 说明 |
| --- | --- | --- |
| GPU | `scripts/serve_gpu.py` | 动态批处理、训练进度、检查点热更新，部署见 [deploy/gpu](https://github.com/yanqiangmiffy/chinese-decision/tree/main/deploy/gpu) |
| CPU | `scripts/serve.py --backend gguf` | Q8_0 GGUF + llama.cpp，不需要 GPU，逐题前向，部署见 [docs/CPU.md](https://github.com/yanqiangmiffy/chinese-decision/blob/main/docs/CPU.md) |

接 CPU 服务时单批评测耗时更长，建议在 `.env` 里设 `EVAL_BATCH_SIZE=16`，避免单批超过 `DECISION_TIMEOUT`（默认 120 秒）；CPU 服务没有热更新，`DECISION_ADMIN_TOKEN` 留空。

### 本地开发

```bash
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # Linux/macOS: .venv/bin/pip
echo DATABASE_URL=sqlite+aiosqlite:///./dev.db > .env                     # 不想起 Postgres 就用 SQLite
alembic upgrade head && python -m app.scripts.seed
uvicorn app.main:app --reload --port 8090

cd frontend                                    # 另开一个终端
npm install && npm run dev                     # http://localhost:5173，/api 自动代理到 8090
```

## 🏗 架构

```mermaid
flowchart LR
    user["浏览器<br/>React + Vite"]
    subgraph compose["docker compose up -d"]
        nginx["frontend<br/>nginx：静态资源 + /api 反代"]
        api["backend<br/>FastAPI"]
        pg[("PostgreSQL<br/>历史 · 评测集 · 评测结果 · 压测")]
    end
    subgraph gpu["推理服务器（chinese-decision）"]
        svc["决策服务<br/>serve_gpu.py（GPU）/ serve.py（CPU）"]
        run[("训练目录<br/>best adapter（只读）")]
    end
    llm["对照大模型<br/>vLLM · OpenAI 兼容"]

    user -- "HTTP / SSE" --> nginx
    nginx -- "/api" --> api
    api --> pg
    api -- "决策 / 批量 / 编译" --> svc
    svc -. "快照 + 热更新" .-> run
    api -. "可选：logprobs 对照" .-> llm
```

- **决策服务**（[chinese-decision](https://github.com/yanqiangmiffy/chinese-decision) 仓库的 `scripts/serve_gpu.py`）：兼容 hmm / System One 接口；并发请求在 4 ms 窗口内合批，按 token 预算切 micro-batch；提供批量、提示词编译、训练进度和检查点热更新接口；空闲时释放缓存显存（GPU 是共用的）。
- **后端**：只做协议转换和编排——证据归因、鲁棒性变体、评测运行（后台任务 + SSE 进度）、压测（SSE）都是“构造一批请求 → 一次 `/v1/batch`”。
- **前端**：没有 UI 组件库和图表库，图表都是手写 SVG；按页面懒加载。

## 🎯 评测集

用例格式与 CJ-Bench 一致，支持 JSONL / JSON / CSV 导入：

```jsonc
{"state": "付款后没收到发票", "questions": {"dept": {"type": "choice", "instructions": "哪个部门？", "criteria": {"billing": "账单", "tech": "技术"}}}, "gold": {"dept": "billing"}, "meta": {"tag": "账单"}}
{"state": "这家店太难吃了", "type": "score", "instructions": "情感？", "criteria": ["负面", "中性", "正面"], "answer": 0}   // 单问题简写
```

| 内置评测集 | 条数 | 考察点 |
| --- | ---: | --- |
| 客服工单分诊 | 24 | 5 选 1 分派 + 是否紧急 |
| 电商评论情感 | 24 | 三档情感 + 是否抱怨物流，含褒贬参半样本 |
| 智能体工具路由 | 24 | 7 个工具选 1 + 是否需要追问 |
| LLM 护栏：注入与隐私 | 24 | 直接 / 间接 / 混淆注入，以及“讨论注入本身”的易混淆正常请求 |
| 逻辑与否定陷阱 | 24 | 双重否定、量词、数字与日期、条件推理、过度推断 |
| 医疗分诊 | 20 | 10 个科室 + 是否急诊（仅用于模型测试，不构成医疗建议） |
| 罪名判断 | 16 | 盗窃 / 抢劫、诈骗 / 敲诈勒索等易混淆罪名 |
| 金融舆情 | 20 | 利空 / 中性 / 利好 + 是否涉及监管 |
| RAG 段落相关性 | 20 | 同主题但不含答案的干扰段落 |
| CJ-Bench 分层抽样 | 300 | 4 领域 × 3 题型 × 25，需要用 [`scripts/sample_cj_bench.py`](scripts/sample_cj_bench.py) 从数据集生成 |

CJ-Bench 的许可按数据来源分别适用（部分为非商业许可），抽样文件只用于内部测试，已在 `.gitignore` 中排除。

## 📁 目录结构

```text
decision-studio/
├── backend/
│   ├── app/
│   │   ├── routers/           # health · decide · history · suites · runs · bench：只做协议转换
│   │   ├── services/          # 决策客户端、对照大模型、指标、评测运行、证据归因与鲁棒性、压测、导入
│   │   ├── db/                # SQLAlchemy 2.0 异步模型；表结构变更走 migrations/
│   │   └── scripts/seed.py    # 导入内置评测集（幂等）
│   ├── data/suites/           # 内置评测集（build.py 生成）
│   └── tests/                 # 不依赖外部服务：假决策服务 + SQLite
├── frontend/src/
│   ├── pages/                 # 总览、实验台、场景库（scenarios/）、实验室、评测、压测、历史、文档
│   ├── components/            # ui · charts（手写 SVG）· decision（结果视图与编辑器）
│   └── styles/                # 设计令牌与样式，深色 / 浅色两套主题
├── scripts/                   # CJ-Bench 抽样、README 截图
└── docker-compose.yml
```

## 🧪 测试

```bash
cd backend && python -m pytest && ruff check .     # 24 个测试，不需要任何外部服务
cd frontend && npm run build && npm run lint        # 类型检查 + 构建
python scripts/screenshots.py --run <评测运行 id>     # 重新生成 README 截图（需要平台在运行）
```

## 致谢

- [Chinese Decision](https://github.com/yanqiangmiffy/chinese-decision)：决策模型、提示词编译器与 CJ-Bench 评测口径
- [Chinese-Jev](https://arxiv.org/abs/2609.36965)：CJ-Dataset 与 CJ-Bench
- TypeSafe Jev 文档与开源社区整理的设计模式和失效模式（[awesome-system-one-models](https://github.com/pozapas/awesome-system-one-models)）
- [agent-fullstack-template](https://github.com/yanqiangmiffy/agent-fullstack-template)：工程骨架

## License

[MIT](LICENSE)
