import {
  Bot,
  CalendarDays,
  CloudSun,
  CreditCard,
  Gauge,
  Lamp,
  Mail,
  MessageCircle,
  Search,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../api";
import { Badge, Button, Card, Slider } from "../../components/ui";
import { useApp } from "../../hooks/useApp";
import { ms, pct } from "../../lib/format";
import type { Answer, Question } from "../../types";

const TOOLS: Record<string, { label: string; icon: ReactNode; group: "read" | "write" | "money" }> = {
  weather: { label: "天气查询", icon: <CloudSun />, group: "read" },
  search: { label: "联网搜索", icon: <Search />, group: "read" },
  calendar: { label: "日程管理", icon: <CalendarDays />, group: "write" },
  message: { label: "发送消息", icon: <Mail />, group: "write" },
  smart_home: { label: "智能家居", icon: <Lamp />, group: "write" },
  payment: { label: "转账支付", icon: <CreditCard />, group: "money" },
  none: { label: "直接回答", icon: <MessageCircle />, group: "read" },
};

const QUESTIONS: Record<string, Question> = {
  tool: {
    type: "choice",
    instructions: "为完成用户的请求，智能体应该调用哪个工具？",
    criteria: {
      weather: "查询天气、气温、空气质量",
      search: "联网搜索新闻、事实或资料",
      calendar: "查询或创建日程、会议、提醒",
      message: "给他人发送邮件或消息",
      smart_home: "控制灯光、空调、门锁等家居设备",
      payment: "转账、付款、充值",
      none: "闲聊、给建议或直接回答，不需要工具",
    },
  },
  // 写清 false / true 的含义后明显更准；即便如此，“发给他”这类指代不明仍可能漏判，所以门槛只设 0.7
  clarify: {
    type: "noul",
    instructions: "用户的请求里是否缺少执行所需的关键信息？",
    criteria: { false: "信息完整，可以直接执行", true: "缺少对象、时间、金额、地点或收款人等关键信息" },
  },
  risk: { type: "score", instructions: "如果执行这个请求，操作的风险有多高？", criteria: ["只读、无风险", "可撤销的操作", "不可撤销或涉及资金"] },
};

const SAMPLES = [
  "明天上海会下雨吗？",
  "帮我约王总下周二下午聊一下预算",
  "给他发个消息说我晚点到",
  "转 2000 块给妈妈",
  "把客厅的空调调到 26 度",
  "最近有什么关于固态电池的新闻？",
  "我最近压力好大，睡不着",
  "帮我付一下",
];

interface Turn {
  user: string;
  answers?: Record<string, Answer>;
  latency?: number;
  action?: Action;
}
interface Action {
  kind: "execute" | "confirm" | "clarify" | "human";
  text: string;
  call?: string;
  steps: { title: string; body: string; tone: "ok" | "warn" | "bad" }[];
}

function decide(user: string, a: Record<string, Answer>, gates: Record<string, number>): Action {
  const tool = a.tool.choice ?? "none";
  const conf = a.tool.confidence;
  const clarify = a.clarify.noul ?? 0;
  const risk = a.risk.score ?? 0;
  const group = TOOLS[tool].group;
  const gate = gates[group];
  const steps: Action["steps"] = [
    { title: `意图识别 → ${TOOLS[tool].label}`, body: `置信度 ${pct(conf, 0)}（${tool}）`, tone: conf >= gate ? "ok" : conf >= 0.3 ? "warn" : "bad" },
    { title: "信息是否完整", body: `缺少关键信息的概率 ${pct(clarify, 0)} · 追问门槛 70%`, tone: clarify > 0.7 ? "warn" : clarify > 0.45 ? "warn" : "ok" },
    { title: "操作风险", body: `期望风险等级 ${risk.toFixed(2)} / 2 · 门槛 ${pct(gate, 0)}（${group === "read" ? "只读类" : group === "write" ? "写操作" : "资金类"}）`, tone: risk > 1.4 ? "bad" : risk > 0.7 ? "warn" : "ok" },
  ];
  if (conf < 0.3) return { kind: "human", text: "我不太确定你想做什么，已经帮你转给人工客服。", steps: [...steps, { title: "门控结果", body: "置信度过低 → 转人工", tone: "bad" }] };
  if (clarify > 0.7)
    return {
      kind: "clarify",
      text: tool === "message" ? "好的，要发给谁呢？" : tool === "payment" ? "请问要付给谁、金额是多少？" : tool === "calendar" ? "请问具体是哪天、几点、和谁？" : "能再具体说说吗？",
      steps: [...steps, { title: "门控结果", body: "缺少必要信息 → 先追问", tone: "warn" }],
    };
  if (conf < gate || risk > 1.4 || group === "money")
    return {
      kind: "confirm",
      text: `确认一下：你是要${TOOLS[tool].label === "转账支付" ? "转账" : TOOLS[tool].label}——“${user}”，对吗？`,
      call: `${tool}(…)  # 等待用户确认`,
      steps: [
        ...steps,
        {
          title: "门控结果",
          body: conf < gate ? `置信度低于 ${pct(gate, 0)} → 先确认` : group === "money" ? "资金类操作一律二次确认，不论置信度多高" : "高风险操作 → 二次确认",
          tone: "warn",
        },
      ],
    };
  const replies: Record<string, string> = {
    weather: "正在查询天气…",
    search: "正在搜索相关资料…",
    calendar: "好的，正在帮你安排日程…",
    message: "好的，消息已发送。",
    smart_home: "好的，已经调好了。",
    payment: "正在发起转账…",
    none: "我在呢。说说发生了什么？",
  };
  return { kind: "execute", text: replies[tool], call: tool === "none" ? undefined : `${tool}(${JSON.stringify(user)})`, steps: [...steps, { title: "门控结果", body: "置信度足够、风险可控 → 直接执行", tone: "ok" }] };
}

export default function AgentRouter() {
  const { toast } = useApp();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [gates, setGates] = useState({ read: 0.4, write: 0.65, money: 0.85 });
  const chatRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const send = async (text: string) => {
    if (!text.trim()) return;
    setInput("");
    const index = turns.length;
    setTurns((t) => [...t, { user: text }]);
    try {
      const r = await api.decide({ state: `用户：${text}`, questions: QUESTIONS, source: "scenario:agent", title: text });
      setTurns((t) => t.map((x, i) => (i === index ? { ...x, answers: r.response.answers, latency: r.response.latency_ms } : x)));
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  useEffect(() => {
    if (started.current) return; // 开发模式下 StrictMode 会执行两次
    started.current = true;
    send(SAMPLES[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const last = [...turns].reverse().find((t) => t.answers);
  const lastAction = last?.answers ? decide(last.user, last.answers, gates) : null;

  return (
    <div className="ag">
      <Card title="对话" icon={<Bot />} sub="每句话先过一次决策模型，再决定执行、确认、追问还是转人工">
        <div className="chat" ref={chatRef}>
          {turns.map((t, i) => {
            const action = t.answers ? decide(t.user, t.answers, gates) : null;
            return (
              <div key={i} className="col" style={{ gap: 8 }}>
                <div className="msg user">{t.user}</div>
                {action ? (
                  <div className="msg bot">
                    <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                      <Badge kind={action.kind === "execute" ? "ok" : action.kind === "human" ? "bad" : "warn"}>
                        {{ execute: "执行", confirm: "先确认", clarify: "追问", human: "转人工" }[action.kind]}
                      </Badge>
                      <span className="faint tiny mono">{ms(t.latency)}</span>
                    </div>
                    {action.text}
                    {action.call && (
                      <div>
                        <span className="action">→ {action.call}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="msg bot faint">思考中…</div>
                )}
              </div>
            );
          })}
        </div>
        <div className="row wrap" style={{ gap: 6, margin: "12px 0" }}>
          {SAMPLES.map((s) => (
            <button key={s} className="chip" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" placeholder="对智能体说点什么…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(input)} />
          <Button variant="primary" icon={<Send />} onClick={() => send(input)} disabled={!input.trim()}>
            发送
          </Button>
        </div>
      </Card>

      <div className="col" style={{ gap: 18 }}>
        <Card title="决策轨迹" icon={<Gauge />} sub={last ? `“${last.user}”` : "等待输入"}>
          {last?.answers && lastAction && (
            <>
              <div className="tool-grid" style={{ marginBottom: 16 }}>
                {Object.entries(TOOLS).map(([k, t]) => (
                  <div key={k} className={`tool ${last.answers!.tool.choice === k ? "win" : ""}`}>
                    {t.icon}
                    <span>{t.label}</span>
                    <span className="mono tiny faint">{pct(last.answers!.tool.probabilities[k], 1)}</span>
                  </div>
                ))}
              </div>
              <div className="trace">
                {lastAction.steps.map((s, i) => (
                  <div key={i} className="trace-step">
                    <span className={`trace-dot ${s.tone}`}>{i + 1}</span>
                    <div>
                      <div className="trace-title">{s.title}</div>
                      <div className="trace-body">{s.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
        <Card title="置信度门槛（按风险分级）" icon={<SlidersHorizontal />} sub="查天气猜错了无所谓，转账猜错了就是事故：阈值跟着后果走">
          {(
            [
              ["read", "只读类（天气 / 搜索 / 闲聊）"],
              ["write", "写操作（日程 / 消息 / 家居）"],
              ["money", "资金类（转账 / 支付）"],
            ] as const
          ).map(([k, label]) => (
            <div key={k} className="col" style={{ gap: 6, marginBottom: 12 }}>
              <div className="row between small">
                <span>{label}</span>
                <b className="mono">{pct(gates[k], 0)}</b>
              </div>
              <Slider value={gates[k]} min={0.1} max={0.95} step={0.05} onChange={(v) => setGates((g) => ({ ...g, [k]: v }))} />
            </div>
          ))}
          <div className="faint tiny">调整门槛后，左侧对话里每一轮的处理方式会立即重新计算。</div>
        </Card>
      </div>
    </div>
  );
}
