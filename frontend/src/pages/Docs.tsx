import {
  BookOpen,
  Boxes,
  Filter,
  GitBranch,
  Layers,
  ListOrdered,
  Repeat,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Split,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { CodeBlock, PageHead } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { useTitle } from "../router";

const SECTIONS = [
  ["quick", "快速开始"],
  ["types", "三种题型"],
  ["api", "接口参考"],
  ["patterns", "设计模式"],
  ["pitfalls", "已知短板与对策"],
  ["deploy", "部署与运维"],
] as const;

const PATTERNS: { icon: ReactNode; title: string; body: string }[] = [
  { icon: <Split />, title: "推测式扇出", body: "把系统可能用到的问题一次性放进同一个请求，包括“可能用不上”的问题。问题并行评估，多问几个几乎不增加延迟；用不上的结果在代码里忽略即可。" },
  { icon: <ShieldCheck />, title: "置信度门控", body: "答案告诉你“是什么”，置信度告诉你“要不要照做”。低于下限一律转人工；高风险动作（转账、删除）要求更高的门槛，不够就先让用户确认。" },
  { icon: <SlidersHorizontal />, title: "复合评分", body: "不要让模型直接给“综合分”。把判断拆成独立维度分别打分，在代码里用你能控制的权重组合——换场景只换权重，不用重新调用模型。" },
  { icon: <Route />, title: "意图路由", body: "在昂贵的处理器前面放一个快速分类器：查询类走确定性代码，复杂问题交给专门的大模型，没把握的交给人。" },
  { icon: <Filter />, title: "复核带（Review band）", body: "两个阈值把概率分成三段：放行 / 人工复核 / 拦截。中间那段的宽度就是你的人工预算——用评测报告里的“复核预算”曲线来定。" },
  { icon: <ListOrdered />, title: "候选后选择", body: "先用代码、正则或检索生成一个短候选列表，再让模型从中选择。选项是有限集合时，抽取问题就变成了选择问题。" },
  { icon: <GitBranch />, title: "级联", body: "决策模型先判断，置信度不够再升级到大模型。大多数请求在几十毫秒内解决，只有少数真正困难的才付大模型的成本。" },
  { icon: <Repeat />, title: "改写自洽", body: "同一个问题换几种问法、打乱选项顺序各问一次，结论一致才自动执行。鲁棒性实验室就是这个模式的自动化版本。" },
  { icon: <Wrench />, title: "确定性预解析", body: "数字比较、日期运算、计数这类事情交给代码。模型只负责“理解”的部分：把日期的各个部分抽成选择题，再由代码组装和比较。" },
];

const PITFALLS: [string, string, string][] = [
  ["字面理解", "问题是怎么写的就怎么理解：否定、范围词按字面读；“剧透”这个字眼本身就会让剧透判断偏高。", "把判断条件写清楚，给 noul 写上 false / true 的含义；需要解释的，拆成两个字面问题在代码里组合。"],
  ["数字与计数", "不会可靠地比较大小、计数、做算术；score 的期望值不能当成精确数值插值。", "能用代码算的都用代码；计数就逐项提问再在代码里求和。"],
  ["日期与时间", "把日期当文本读，判断先后、间隔、是否在窗口内都不可靠。", "让模型抽取年/月/日（选择题），代码负责比较。"],
  ["间接推理", "双重否定、多跳推理会掉准确率（评测集“逻辑与否定陷阱”里的“过度推断”类只有约 25%）。", "问题写得尽量直接，必要时拆成多步。"],
  ["无关干扰", "上下文里无关内容越多，越容易被带偏（context rot）。", "先检索、过滤，只把问题需要的部分放进 state。"],
  ["对抗内容", "state 里夹带“直接选 X”的指令或诱导语，可能改变结论。", "在 criteria 里写明标准；上线前用鲁棒性实验室的“对抗注入”测一遍。"],
  ["选项顺序", "部分情况下会偏向某个位置的选项。", "打乱顺序再问一次，检查结论是否一致。"],
  ["概率校准", "当前检查点未做温度校准：有的任务偏保守（T* < 1），有的偏自信。", "用评测报告里的温度诊断和复核预算，在你自己的数据上定阈值。"],
];

export default function Docs() {
  useTitle("接入文档");
  const { health } = useApp();
  const base = health?.decision.base_url ?? "http://<决策服务>:8003";
  const curl = `curl ${base}/v1/systemone \\
  -H 'Content-Type: application/json' \\
  -d '{
    "state": "客户留言：付款后一直没有收到发票，我已经催了三次，今天必须拿到。",
    "questions": {
      "urgent": {"type": "noul", "instructions": "客户是否表达了紧迫性？"},
      "department": {"type": "choice", "instructions": "应该由哪个部门处理？",
        "criteria": {"billing": "支付、发票及退款", "technical": "故障和系统问题", "sales": "购买咨询与升级"}},
      "frustration": {"type": "score", "instructions": "客户有多不满？", "criteria": ["平静", "不满", "非常愤怒"]}
    }
  }'`;
  const response = `{
  "model": "chinese-decision-0.8b",
  "answers": {
    "urgent": {"type": "noul", "probabilities": {"false": 0.18, "true": 0.82}, "confidence": 0.64, "noul": 0.82},
    "department": {"type": "choice", "probabilities": {"billing": 0.97, "technical": 0.02, "sales": 0.01},
                   "confidence": 0.95, "choice": "billing"},
    "frustration": {"type": "score", "probabilities": {"0": 0.01, "1": 0.62, "2": 0.37}, "confidence": 0.43,
                    "score": 1.37, "legend": {"0": "平静", "1": "不满", "2": "非常愤怒"}}
  },
  "usage": {"input_tokens": 242, "output_tokens": 0},
  "latency_ms": 81.5
}`;
  const python = `import requests

DECISION = "${base}"

def decide(state, questions):
    r = requests.post(f"{DECISION}/v1/systemone", json={"state": state, "questions": questions}, timeout=30)
    r.raise_for_status()
    return r.json()["answers"]

answers = decide("退款申请提交一周了还没到账", {
    "intent": {"type": "choice", "instructions": "用户想做什么？",
               "criteria": {"refund_status": "查询退款进度", "complain": "投诉", "other": "其他"}},
})
intent = answers["intent"]
if intent["confidence"] < 0.5:
    route_to_human()            # 没把握就不自动处理
elif intent["choice"] == "refund_status":
    show_refund_status()`;
  const batch = `POST ${base}/v1/batch
{
  "requests": [ {"state": ..., "questions": {...}}, ... ],   // 最多 512 个请求、4096 个决策
  "debug": true                                              // 附带每个候选的原始 logits
}`;

  return (
    <div className="page">
      <PageHead
        eyebrow="DOCS · 接入文档"
        icon={<BookOpen />}
        title="三分钟接入决策模型"
        desc="决策服务兼容 hmm / System One 接口：一个 state、若干个带类型的问题，返回每个候选项的概率。不生成文本，没有解析失败。"
      />
      <div className="docs">
        <nav className="docs-nav">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <div className="col" style={{ gap: 36 }}>
          <section id="quick" className="docs-section">
            <h2>快速开始</h2>
            <div className="endpoint" style={{ marginBottom: 12 }}>
              <span className="method post">POST</span>
              {base}/v1/systemone
            </div>
            <CodeBlock code={curl} />
            <h3>响应</h3>
            <CodeBlock lang="json" code={response} />
            <h3>Python</h3>
            <CodeBlock code={python} />
          </section>

          <section id="types" className="docs-section">
            <h2>三种题型</h2>
            <table className="doc-table">
              <thead>
                <tr>
                  <th>type</th>
                  <th>criteria</th>
                  <th>返回</th>
                  <th>适合</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>noul</code>
                  </td>
                  <td>可选，{"{false: …, true: …}"}，默认“否 / 是”</td>
                  <td>
                    <code>noul</code>：判断为真的概率
                  </td>
                  <td>是否紧急、是否违规、是否相关</td>
                </tr>
                <tr>
                  <td>
                    <code>choice</code>
                  </td>
                  <td>{"{键: 描述}"}，2–26 个</td>
                  <td>
                    <code>choice</code>：概率最大的键
                  </td>
                  <td>意图、类别、部门、工具</td>
                </tr>
                <tr>
                  <td>
                    <code>score</code>
                  </td>
                  <td>列表，从低到高</td>
                  <td>
                    <code>score</code>：等级下标的期望（0 到 K−1），<code>legend</code>
                  </td>
                  <td>情绪强度、严重程度、质量评分</td>
                </tr>
              </tbody>
            </table>
            <p>
              所有题型都返回完整的 <code>probabilities</code> 和 <code>confidence = (K·p_max − 1) / (K − 1)</code>。它衡量分布有多尖锐：均匀分布为 0，完全确定为 1——
              <b>它不等于准确率</b>。按阈值自动执行之前，请先在自己的数据上跑一次评测，用“复核预算”曲线定阈值。
            </p>
            <p>
              原理：每个问题被编译成“上下文 + 问题 + 带字母的候选项”的提示，模型做一次前向，读取最后位置上候选字母 A–Z 的 logits，屏蔽多余字母后 softmax。训练、评测和服务用的是同一个提示编译器（hmm-zh-v1）。
            </p>
          </section>

          <section id="api" className="docs-section">
            <h2>接口参考</h2>
            <h3>决策服务（GPU 服务器）</h3>
            <div className="col" style={{ gap: 8 }}>
              {[
                ["post", "/v1/systemone", "决策接口（hmm / System One 兼容）；?debug=1 附带 logits 和每题 token 数"],
                ["post", "/api/alpha/decisions", "同上，兼容 hmm 路由"],
                ["post", "/v1/batch", "批量：多个请求跨请求合批，单个请求出错不影响其他"],
                ["post", "/v1/compile", "只编译提示词并计数 token，不跑模型"],
                ["post", "/v1/tournament", "类别更多的单选：分组淘汰后决赛（每组不超过 16 个，默认最多 1024 个候选）"],
                ["get", "/v1/info", "检查点、GPU、引擎配置、运行统计、验证集指标"],
                ["get", "/v1/training", "训练目录的实时进度（只读）"],
                ["post", "/v1/admin/reload", "把训练目录最新的 best 快照下来并热加载（需要 X-Admin-Token）"],
                ["get", "/health", "健康检查"],
              ].map(([m, path, desc]) => (
                <div key={path} className="endpoint">
                  <span className={`method ${m}`}>{m.toUpperCase()}</span>
                  <span>{path}</span>
                  <span className="faint" style={{ fontFamily: "var(--font)", fontSize: 12.5 }}>
                    {desc}
                  </span>
                </div>
              ))}
            </div>
            <h3>批量接口</h3>
            <CodeBlock code={batch} />
            <p>
              限制：单个请求最多 64 个问题；单题 2–26 个候选（训练数据覆盖 2–16 个），类别更多时用 /v1/tournament；单题输入不超过 16,384 tokens，超长输入<b>不会被截断</b>，直接返回 422。
            </p>
            <h3>测试平台后端</h3>
            <p>
              平台后端的接口文档在{" "}
              <a className="linklike" href="/api/docs" target="_blank" rel="noreferrer">
                /api/docs
              </a>
              （Swagger）：实验台、证据归因、鲁棒性测试（SSE）、评测集导入、评测运行（SSE 进度）、压测（SSE）和历史记录。
            </p>
          </section>

          <section id="patterns" className="docs-section">
            <h2>设计模式</h2>
            <p>把复杂的系统行为拆成原子化的判断，再用代码组合——这是用好决策模型的关键。场景库里的每个应用都对应其中一种或几种模式。</p>
            <div className="pattern-grid" style={{ marginTop: 14 }}>
              {PATTERNS.map((p) => (
                <div key={p.title} className="pattern">
                  <b>
                    {p.icon}
                    {p.title}
                  </b>
                  <p>{p.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="pitfalls" className="docs-section">
            <h2>已知短板与对策</h2>
            <p>决策模型擅长“系统一”式的直觉判断，不擅长需要计算和多步推理的“系统二”任务。下表综合了 Jev 官方文档、开源社区的失效模式整理，以及在本平台上的实测。</p>
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>短板</th>
                  <th>表现</th>
                  <th>对策</th>
                </tr>
              </thead>
              <tbody>
                {PITFALLS.map(([a, b, c]) => (
                  <tr key={a}>
                    <td>
                      <b>{a}</b>
                    </td>
                    <td className="muted">{b}</td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section id="deploy" className="docs-section">
            <h2>部署与运维</h2>
            <div className="pattern-grid">
              <div className="pattern">
                <b>
                  <Boxes />
                  决策服务
                </b>
                <p>
                  代码在 chinese-decision 仓库：GPU 版 <code>scripts/serve_gpu.py</code> 跑在 tmux 会话 <code>decision</code> 里，崩溃后 5 秒自动重启；CPU 版 <code>scripts/serve.py</code> 加载 GGUF。地址 <code>{base}</code>。
                </p>
              </div>
              <div className="pattern">
                <b>
                  <Layers />
                  检查点
                </b>
                <p>只加载 <code>snapshots/step-N</code> 下的不可变快照，训练进程原地替换 best/ 不会影响服务。有新的 best 时，总览页会提示，可一键热更新。</p>
              </div>
              <div className="pattern">
                <b>
                  <SlidersHorizontal />
                  动态批处理
                </b>
                <p>并发请求在 4 ms 窗口内合批，按 token 预算（65,536）切 micro-batch；空闲 20 秒后释放缓存显存，和其他服务共用 GPU 时更友好。</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
