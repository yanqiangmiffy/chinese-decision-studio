import { ArrowRightCircle, Flag, Inbox, Layers, Play, Send, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Badge, Button, Card, Spinner } from "../../components/ui";
import { useApp } from "../../hooks/useApp";
import type { Answer, DecisionResponse, Question } from "../../types";
import { Avatar, LatChip, MiniProb, summarize } from "./shared";

const QUESTIONS: Record<string, Question> = {
  category: {
    type: "choice",
    instructions: "这个工单属于哪一类？",
    criteria: {
      bug: "软件缺陷或故障",
      billing: "账单、扣费与退款",
      feature: "功能建议或需求",
      account: "账号与登录",
      other: "其他咨询",
    },
  },
  severity: { type: "score", instructions: "如果是故障，严重程度如何？", criteria: ["轻微：不影响使用", "一般：部分功能受影响", "严重：核心功能不可用或数据丢失"] },
  repro: { type: "noul", instructions: "用户是否给出了可以复现问题的步骤或条件？" },
  refund: { type: "noul", instructions: "用户是否在要求退款？" },
  frustration: { type: "score", instructions: "用户的情绪有多激烈？", criteria: ["平静", "有些不满", "非常愤怒"] },
  churn: { type: "noul", instructions: "用户是否表达了要离开、不再使用的意图？" },
};

const LABELS: Record<string, string> = {
  category: "类别",
  severity: "严重程度",
  repro: "可复现",
  refund: "要求退款",
  frustration: "情绪",
  churn: "流失风险",
};

const TICKETS = [
  { from: "陈雨", channel: "App 内反馈", text: "升级到 5.2 之后，只要在订单页点“导出 Excel”就闪退，试了三次都一样，iPhone 14，iOS 18。我们财务月底要用，麻烦尽快。" },
  { from: "刘洋", channel: "邮件", text: "你们自动续费连个提醒都没有就扣了我 699，我根本不想续，马上给我退回来，不然我就去投诉！" },
  { from: "赵敏", channel: "在线客服", text: "建议在报表里增加按周汇总的视图，现在只能按天或按月看，不太方便。" },
  { from: "王磊", channel: "电话转写", text: "我换了手机号之后就登不上去了，验证码一直发到旧号码上，旧号码已经注销了。" },
  { from: "孙婷", channel: "App 内反馈", text: "数据同步偶尔会慢一点，不过刷新一下就好了，不太影响使用。" },
  { from: "周杰", channel: "邮件", text: "用了你们三年了，这次改版之后整个团队都在骂，核心的审批流全挂了，客户的单子全卡住。再这样我们下个月就换别家了。" },
  { from: "吴芳", channel: "在线客服", text: "请问你们的企业版支持私有化部署吗？大概什么价位？" },
  { from: "郑浩", channel: "App 内反馈", text: "上周买了年度会员，但是发现功能跟我需要的不一样，能退一部分钱吗？" },
];

type Queue = "工程紧急通道" | "缺陷待办池" | "账务 · 退款优先" | "账务" | "产品需求池" | "账号安全组" | "人工客服" | "人工复核";
const QUEUE_COLORS: Record<Queue, string> = {
  工程紧急通道: "#fb7185",
  缺陷待办池: "#f59e0b",
  "账务 · 退款优先": "#a78bfa",
  账务: "#818cf8",
  产品需求池: "#22d3ee",
  账号安全组: "#34d399",
  人工客服: "#94a3b8",
  人工复核: "#fbbf24",
};

interface Routed {
  queue: Queue;
  lines: number[];
  flags: string[];
}

/** 路由策略：写在代码里，每一行都能被高亮出来。 */
function route(a: Record<string, Answer>): Routed {
  const cat = a.category;
  const choice = cat.choice ?? "";
  const severity = a.severity.score ?? 0;
  const repro = a.repro.noul ?? 0;
  const refund = a.refund.noul ?? 0;
  const lines: number[] = [0];
  let queue: Queue;
  if (cat.confidence < 0.5) {
    lines.push(1, 2);
    queue = "人工复核";
  } else {
    lines.push(3);
    if (choice === "bug") {
      lines.push(4);
      if (severity > 1.2 && repro > 0.6) {
        lines.push(5, 6);
        queue = "工程紧急通道";
      } else {
        lines.push(7, 8);
        queue = "缺陷待办池";
      }
    } else if (choice === "billing") {
      lines.push(9);
      if (refund > 0.6) {
        lines.push(10);
        queue = "账务 · 退款优先";
      } else {
        lines.push(11);
        queue = "账务";
      }
    } else if (choice === "feature") {
      lines.push(12);
      queue = "产品需求池";
    } else if (choice === "account") {
      lines.push(13);
      queue = "账号安全组";
    } else {
      lines.push(14);
      queue = "人工客服";
    }
  }
  const flags: string[] = [];
  lines.push(15);
  if ((a.frustration.score ?? 0) > 1.2 || (a.churn.noul ?? 0) > 0.6) {
    lines.push(16);
    flags.push("优先响应");
  }
  return { queue, lines, flags };
}

const POLICY: { code: string; indent: number }[] = [
  { code: "def route(ticket):", indent: 0 },
  { code: "if category.confidence < 0.5:", indent: 1 },
  { code: 'return "人工复核"  # 连类别都没把握，不自动分派', indent: 2 },
  { code: "match category.choice:", indent: 1 },
  { code: 'case "bug":', indent: 2 },
  { code: "if severity.score > 1.2 and repro.noul > 0.6:", indent: 3 },
  { code: 'return "工程紧急通道"', indent: 4 },
  { code: "else:", indent: 3 },
  { code: 'return "缺陷待办池"', indent: 4 },
  { code: 'case "billing":', indent: 2 },
  { code: 'if refund.noul > 0.6: return "账务 · 退款优先"', indent: 3 },
  { code: 'return "账务"', indent: 3 },
  { code: 'case "feature": return "产品需求池"', indent: 2 },
  { code: 'case "account": return "账号安全组"', indent: 2 },
  { code: 'case _: return "人工客服"', indent: 2 },
  { code: "# 情绪和流失风险与类别无关，任何工单都看", indent: 1 },
  { code: 'if frustration.score > 1.2 or churn.noul > 0.6: flag("优先响应")', indent: 1 },
];

function highlight(code: string) {
  const parts = code.split(/(".*?"|#.*$|\b(?:def|if|else|return|match|case|and|or|flag)\b|\b\d+(?:\.\d+)?\b)/g);
  return parts.map((p, i) =>
    p.startsWith("#") ? (
      <span key={i} className="cm">
        {p}
      </span>
    ) : p.startsWith('"') ? (
      <span key={i} className="val">
        {p}
      </span>
    ) : /^(def|if|else|return|match|case|and|or|flag)$/.test(p) ? (
      <span key={i} className="kw">
        {p}
      </span>
    ) : /^\d/.test(p) ? (
      <span key={i} className="val">
        {p}
      </span>
    ) : (
      p
    ),
  );
}

export default function TicketTriage() {
  const { toast } = useApp();
  const [selected, setSelected] = useState(0);
  const [custom, setCustom] = useState("");
  const [results, setResults] = useState<Record<number, DecisionResponse>>({});
  const [loading, setLoading] = useState<number | "all" | null>(null);
  const [batchMs, setBatchMs] = useState<number | null>(null);
  const tickets = useMemo(() => (custom ? [...TICKETS, { from: "我", channel: "自定义", text: custom }] : TICKETS), [custom]);

  const runOne = async (i: number) => {
    setSelected(i);
    setLoading(i);
    try {
      const r = await api.decide({ state: tickets[i].text, questions: QUESTIONS, source: "scenario:triage", title: `工单 · ${tickets[i].from}` });
      setResults((x) => ({ ...x, [i]: r.response }));
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setLoading(null);
    }
  };

  const runAll = async () => {
    setLoading("all");
    try {
      const r = await api.batch(tickets.map((t) => ({ state: t.text, questions: QUESTIONS })));
      const next: Record<number, DecisionResponse> = {};
      r.results.forEach((res, i) => {
        if ("answers" in res) next[i] = res;
      });
      setResults(next);
      setBatchMs(r.latency_ms);
      toast(`${tickets.length} 个工单 × 6 个问题 = ${r.decisions} 次决策，用时 ${Math.round(r.latency_ms)} ms`, "ok");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setLoading(null);
    }
  };

  useEffect(() => {
    if (!results[0]) runOne(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = results[selected];
  const routed = current ? route(current.answers) : null;
  const allRouted = Object.entries(results).map(([i, r]) => ({ i: Number(i), ...route(r.answers) }));
  const queues = Array.from(new Set(allRouted.map((r) => r.queue)));

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="tri">
        <Card
          title="收件箱"
          icon={<Inbox />}
          sub={`${tickets.length} 个待分派工单`}
          actions={
            <Button size="sm" variant="primary" icon={<Layers />} loading={loading === "all"} onClick={runAll}>
              批量分诊
            </Button>
          }
        >
          <div className="inbox">
            {tickets.map((t, i) => {
              const r = results[i] ? route(results[i].answers) : null;
              return (
                <button key={i} className={`inbox-item ${selected === i ? "on" : ""}`} onClick={() => (results[i] ? setSelected(i) : runOne(i))}>
                  <Avatar name={t.from} i={i} />
                  <div className="grow">
                    <div className="inbox-meta">
                      <b style={{ color: "var(--text)" }}>{t.from}</b>
                      <span>· {t.channel}</span>
                      <span className="grow" />
                      {loading === i && <Spinner />}
                    </div>
                    <div className="inbox-text">{t.text}</div>
                    {r && (
                      <div className="row" style={{ gap: 4, marginTop: 6 }}>
                        <span className="queue-tag" style={{ color: QUEUE_COLORS[r.queue], background: `${QUEUE_COLORS[r.queue]}1f` }}>
                          {r.queue}
                        </span>
                        {r.flags.map((f) => (
                          <span key={f} className="queue-tag" style={{ color: "var(--bad)", background: "rgba(251,113,133,.12)" }}>
                            <Flag size={10} />
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="divider" />
          <div className="col" style={{ gap: 8 }}>
            <textarea className="textarea" rows={3} placeholder="写一条你自己的工单试试…" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <Button size="sm" icon={<Send />} disabled={!custom.trim()} onClick={() => runOne(TICKETS.length)}>
              分诊这条
            </Button>
          </div>
        </Card>

        <Card
          title="一次请求 · 六个问题"
          icon={<Workflow />}
          sub="推测式扇出：不管是不是故障，都顺手把严重程度问了——用不上就忽略，用得上就省一次往返"
          actions={current && <LatChip value={current.latency_ms} />}
        >
          <div className="faint small" style={{ marginBottom: 14, lineHeight: 1.7 }}>
            “{tickets[selected]?.text}”
          </div>
          {!current ? (
            <div className="row" style={{ justifyContent: "center", padding: 40 }}>
              {loading !== null ? <Spinner /> : <Button icon={<Play />} onClick={() => runOne(selected)}>分诊</Button>}
            </div>
          ) : (
            <>
              <div className="fanout-core">
                <span className="mono">POST /v1/systemone</span>
                <Badge kind="brand">{Object.keys(QUESTIONS).length} 个问题并行</Badge>
                <span>输入 {current.usage.input_tokens} tokens · 输出 0</span>
              </div>
              <div className="fanout stagger">
                {Object.entries(QUESTIONS).map(([name, q]) => {
                  const a = current.answers[name];
                  const s = summarize(a, q);
                  const cat = current.answers.category.choice;
                  const relevant = name === "severity" || name === "repro" ? cat === "bug" : name === "refund" ? cat === "billing" : true;
                  return (
                    <div key={name} className="tile" style={{ opacity: relevant ? 1 : 0.45 }} title={relevant ? undefined : "这个问题和当前类别无关，代码会直接忽略它"}>
                      <div className="tile-name" title={`${name}：${q.instructions}`}>
                        <span className="ellipsis">{LABELS[name]}</span>
                        {!relevant && <span className="faint">忽略</span>}
                      </div>
                      <div className="tile-val">{s.text}</div>
                      <MiniProb label={a.type === "score" ? "期望等级" : a.type === "noul" ? "P(是)" : "概率"} p={s.p} />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>

        <Card title="路由策略" icon={<ArrowRightCircle />} sub="规则在代码里，模型只负责判断">
          <div className="policy">
            {POLICY.map((l, i) => (
              <div key={i} className={`policy-line ${routed?.lines.includes(i) ? "hit" : ""}`}>
                <span className="ln">{i + 1}</span>
                <span>
                  {"  ".repeat(l.indent)}
                  {highlight(l.code)}
                </span>
              </div>
            ))}
          </div>
          {routed && (
            <div className="route-result" key={`${selected}-${routed.queue}`} style={{ marginTop: 14 }}>
              <ArrowRightCircle />
              <div className="grow">
                <div className="faint tiny">分派到</div>
                <b style={{ color: QUEUE_COLORS[routed.queue] }}>{routed.queue}</b>
              </div>
              {routed.flags.map((f) => (
                <Badge key={f} kind="bad" icon={<Flag />}>
                  {f}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      {allRouted.length > 1 && (
        <Card title="分派看板" icon={<Layers />} sub={batchMs ? `批量接口一次提交 ${tickets.length} 个工单，${Math.round(batchMs)} ms 完成全部分派` : "已分诊的工单"}>
          <div className="kanban">
            {queues.map((q) => (
              <div key={q} className="kanban-col">
                <h4>
                  <span style={{ color: QUEUE_COLORS[q] }}>{q}</span>
                  <span className="faint num">{allRouted.filter((r) => r.queue === q).length}</span>
                </h4>
                {allRouted
                  .filter((r) => r.queue === q)
                  .map((r, j) => (
                    <div key={r.i} className="kanban-card" style={{ animationDelay: `${j * 60}ms` }} onClick={() => setSelected(r.i)}>
                      <div className="row between">
                        <b style={{ color: "var(--text)" }}>{tickets[r.i].from}</b>
                        {r.flags.length > 0 && <Flag size={12} color="var(--bad)" />}
                      </div>
                      <div className="ellipsis">{tickets[r.i].text}</div>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
