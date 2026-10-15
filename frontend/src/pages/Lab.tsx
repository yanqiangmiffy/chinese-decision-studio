import {
  Bot,
  Highlighter,
  Microscope,
  Play,
  Repeat,
  ShieldAlert,
  Shuffle,
  Tags,
  Waves,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, streamSSE } from "../api";
import { LineChart, Radar, Ring } from "../components/charts";
import { EvidenceText, QuestionEditor, StateEditor } from "../components/decision";
import { Badge, Button, Card, Empty, PageHead, Spinner, Tip, Toggle } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { LETTERS, optionsOf, validateQuestion } from "../lib/decision";
import { ms, pct } from "../lib/format";
import { takeHandoff } from "../lib/presets";
import { useTitle } from "../router";
import type { Answer, ExplainResult, Question, RobustTest, State } from "../types";

type TestName = RobustTest["test"];
const TESTS: { id: TestName; label: string; icon: ReactNode; desc: string }[] = [
  { id: "order", label: "选项顺序", icon: <Shuffle />, desc: "打乱 choice 选项的顺序，答案应该不变；同时统计模型是否偏好某个位置。" },
  { id: "naming", label: "选项命名", icon: <Tags />, desc: "把选项键换成“选项1/opt_a”这类中性编号，检查模型是不是被键名本身影响。" },
  { id: "distractor", label: "无关干扰", icon: <Waves />, desc: "在上下文前后插入 1–8 段无关材料，看概率漂移多少（context rot）。" },
  { id: "injection", label: "对抗注入", icon: <ShieldAlert />, desc: "在上下文里夹带“直接选 X”的指令或诱导语，检查能否被操纵。" },
  { id: "paraphrase", label: "改写一致性", icon: <Repeat />, desc: "同一个问题换几种问法，结论应该一致。可以自己写，也可以让对照大模型生成。" },
];

const LAB_PRESETS: { title: string; state: State; question: Question; paraphrases: string[] }[] = [
  {
    title: "工单分派",
    state: "客户留言：付款后一直没有收到发票，我已经催了三次，今天必须拿到。",
    question: { type: "choice", instructions: "应该由哪个部门处理？", criteria: { billing: "支付、发票及退款", technical: "故障和系统问题", sales: "购买咨询与升级" } },
    paraphrases: ["这个工单该交给哪个团队？", "哪个部门负责处理这位客户的问题？"],
  },
  {
    title: "弹幕剧透",
    state: "弹幕礼仪：请勿剧透，谢谢大家",
    question: { type: "noul", instructions: "这条弹幕是否剧透了后续剧情？" },
    paraphrases: ["这条弹幕有没有透露还没播出的情节？", "这条弹幕是否说出了后续剧集会发生什么？"],
  },
  {
    title: "评论情感",
    state: "降噪效果确实惊艳，地铁上基本听不到报站了；但是戴久了耳朵疼，而且价格偏贵。",
    question: { type: "score", instructions: "评论的整体情感倾向？", criteria: ["负面", "中性或褒贬参半", "正面"] },
    paraphrases: ["用户对这款耳机的整体评价如何？", "这条评论总体上是好评还是差评？"],
  },
  {
    title: "罪名辨析",
    state: "被告人在公交车上趁被害人不备，扯断其金项链后逃跑，被害人追赶时被告人回身将其推倒在地，致其轻微伤。",
    question: { type: "choice", instructions: "被告人的行为最符合哪个罪名？", criteria: { theft: "盗窃罪", snatch: "抢夺罪", robbery: "抢劫罪（含转化型抢劫）", injury: "故意伤害罪" } },
    paraphrases: ["根据案情，应以什么罪名定罪？"],
  },
];

const VERDICT: Record<string, { label: string; kind: string }> = {
  robust: { label: "稳健", kind: "ok" },
  drift: { label: "轻微漂移", kind: "warn" },
  sensitive: { label: "敏感", kind: "bad" },
};

function stateToText(state: State) {
  return typeof state === "string" ? { text: state, json: false } : { text: JSON.stringify(state, null, 2), json: true };
}

export default function Lab() {
  useTitle("鲁棒性实验室");
  const { health, toast } = useApp();
  const [stateText, setStateText] = useState(LAB_PRESETS[0].state as string);
  const [json, setJson] = useState(false);
  const [question, setQuestion] = useState<Question>(LAB_PRESETS[0].question);
  const [paraphrases, setParaphrases] = useState(LAB_PRESETS[0].paraphrases.join("\n"));
  const [autoPara, setAutoPara] = useState(true);
  const [tests, setTests] = useState<TestName[]>(TESTS.map((t) => t.id));
  const [running, setRunning] = useState(false);
  const [base, setBase] = useState<{ answer: Answer; target: string | null } | null>(null);
  const [results, setResults] = useState<Partial<Record<TestName, RobustTest>>>({});
  const [skips, setSkips] = useState<Partial<Record<TestName, string>>>({});
  const [summary, setSummary] = useState<{ score: number | null; verdict: string | null } | null>(null);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [runQuestion, setRunQuestion] = useState<Question | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const incoming = takeHandoff();
    if (incoming) {
      const [q] = Object.values(incoming.questions);
      const s = stateToText(incoming.state);
      setStateText(s.text);
      setJson(s.json);
      setQuestion(q);
      setParaphrases("");
    }
  }, []);

  const parsed = useMemo((): State | null => {
    if (!json) return stateText;
    try {
      return JSON.parse(stateText);
    } catch {
      return null;
    }
  }, [stateText, json]);
  const qError = validateQuestion(question);

  const run = async () => {
    if (parsed === null || qError) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    setResults({});
    setSkips({});
    setSummary(null);
    setBase(null);
    setExplain(null);
    setRunQuestion(question);
    const started = performance.now();
    api.explain(parsed, question).then(setExplain).catch(() => undefined);
    try {
      await streamSSE<Record<string, unknown>>(
        "/api/lab/robustness",
        { state: parsed, question, tests, paraphrases: paraphrases.split("\n").map((s) => s.trim()).filter(Boolean), auto_paraphrase: autoPara },
        (ev) => {
          if (ev.type === "base") setBase({ answer: ev.answer as Answer, target: ev.target as string | null });
          else if (ev.type === "test") setResults((r) => ({ ...r, [ev.test as TestName]: ev as unknown as RobustTest }));
          else if (ev.type === "skip") setSkips((s) => ({ ...s, [ev.test as TestName]: ev.reason as string }));
          else if (ev.type === "summary") setSummary({ score: ev.score as number | null, verdict: ev.verdict as string | null });
          else if (ev.type === "error") toast(ev.message as string, "bad");
        },
        ctrl.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message, "bad");
    } finally {
      setElapsed(performance.now() - started);
      setRunning(false);
    }
  };

  const options = runQuestion ? optionsOf(runQuestion) : [];
  const keyLabel = (k: string) => {
    const d = Object.fromEntries(options)[k];
    return runQuestion?.type === "score" ? d : runQuestion?.type === "noul" ? (k === "true" ? "是" : "否") : k;
  };
  const metricLabel = runQuestion?.type === "score" ? "归一化期望等级" : runQuestion?.type === "noul" ? "P(是)" : `P(${base?.target ?? "胜出项"})`;
  const done = Object.values(results).filter(Boolean) as RobustTest[];

  return (
    <div className="page">
      <PageHead
        eyebrow="ROBUSTNESS LAB · 鲁棒性实验室"
        icon={<Microscope />}
        title={
          <>
            把已知短板变成<span className="grad-text">可量化的测试</span>
          </>
        }
        desc="决策模型会被选项顺序、无关材料、诱导语和问法影响——这些都是公开记录过的失效模式。这里对同一个决策自动构造几十个变体，一次批量请求跑完，看结论有多稳。"
      />

      <div className="lab-grid">
        <Card title="被测决策" icon={<Highlighter />} sub="一个上下文 + 一个问题">
          <div className="col" style={{ gap: 14 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              {LAB_PRESETS.map((p) => (
                <button
                  key={p.title}
                  className="chip"
                  onClick={() => {
                    const s = stateToText(p.state);
                    setStateText(s.text);
                    setJson(s.json);
                    setQuestion(p.question);
                    setParaphrases(p.paraphrases.join("\n"));
                  }}
                >
                  {p.title}
                </button>
              ))}
            </div>
            <StateEditor value={stateText} json={json} onChange={setStateText} onToggleJson={setJson} rows={4} error={parsed === null ? "JSON 格式错误" : null} />
            <QuestionEditor index={0} name="q" question={question} error={qError} onRename={() => undefined} onChange={setQuestion} />
            <div className="field">
              <label className="label">
                改写 <span className="hint">每行一种问法，用于改写一致性测试</span>
              </label>
              <textarea className="textarea" rows={3} value={paraphrases} onChange={(e) => setParaphrases(e.target.value)} placeholder="换一种问法……" />
              <Toggle
                on={autoPara}
                onChange={setAutoPara}
                label={
                  <span className="row" style={{ gap: 6 }}>
                    <Bot size={14} /> 不足 4 条时让对照大模型补齐
                    {!health?.llm.configured && <span className="faint tiny">（未配置）</span>}
                  </span>
                }
              />
            </div>
            <div className="field">
              <label className="label">测试项</label>
              <div className="row wrap" style={{ gap: 6 }}>
                {TESTS.map((t) => (
                  <Tip key={t.id} text={t.desc}>
                    <button className={`chip ${tests.includes(t.id) ? "on" : ""}`} onClick={() => setTests((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))}>
                      {t.icon}
                      {t.label}
                    </button>
                  </Tip>
                ))}
              </div>
            </div>
            <Button variant="primary" size="lg" icon={<Play />} loading={running} disabled={!!qError || parsed === null || !tests.length} onClick={run}>
              开始测试
            </Button>
          </div>
        </Card>

        <div className="col" style={{ gap: 18, minWidth: 0 }}>
          {!base && !running && (
            <Card>
              <Empty icon={<Microscope />} title="选一个决策，开始体检">
                会依次运行：{TESTS.map((t) => t.label).join(" · ")}。每项测试都是一次批量请求，通常不到一秒。
              </Empty>
            </Card>
          )}
          {(base || running) && (
            <Card className="lab-summary" glow>
              <div className="lab-sum">
                <Ring value={(summary?.score ?? 0) / 100} size={140} stroke={12}>
                  <div>
                    <div className="train-pct num">{summary?.score ?? (running ? "…" : "—")}</div>
                    <div className="faint tiny">稳健分</div>
                  </div>
                </Ring>
                <div className="col" style={{ gap: 10 }}>
                  <div className="row" style={{ gap: 8 }}>
                    {summary?.verdict ? <Badge kind={VERDICT[summary.verdict].kind}>{VERDICT[summary.verdict].label}</Badge> : running && <Spinner />}
                    {elapsed && !running && <span className="faint tiny">全部测试用时 {ms(elapsed)}</span>}
                  </div>
                  {base && (
                    <div className="small">
                      基准判断：<b className="mono">{keyLabel(Object.entries(base.answer.probabilities).sort((a, b) => b[1] - a[1])[0][0])}</b>
                      <span className="faint">（{pct(Math.max(...Object.values(base.answer.probabilities)))}）</span>
                    </div>
                  )}
                  <div className="faint tiny" style={{ maxWidth: 380, lineHeight: 1.6 }}>
                    每项分数 = 50% × 结论一致率 + 50% × (1 − 最大概率漂移)。≥ 85 稳健，65–85 轻微漂移，&lt; 65 敏感。
                  </div>
                </div>
                {done.length >= 3 && (
                  <Radar
                    size={230}
                    axes={done.map((t) => TESTS.find((x) => x.id === t.test)!.label)}
                    series={[{ name: "稳健分", color: "#a78bfa", values: done.map((t) => t.score / 100) }]}
                  />
                )}
              </div>
            </Card>
          )}

          {explain && (
            <Card title="证据归因" icon={<Highlighter />} sub={`逐段遮挡，看${explain.metric === "expected_score" ? "期望等级" : `「${explain.target}」的概率`}变化 · ${explain.decisions} 次前向 · ${ms(explain.latency_ms)}`}>
              <EvidenceText segments={explain.segments} structured={explain.structured} />
            </Card>
          )}

          {TESTS.filter((t) => tests.includes(t.id)).map((t) => {
            const r = results[t.id];
            const skip = skips[t.id];
            if (!r && !skip && !running) return null;
            return (
              <Card
                key={t.id}
                title={t.label}
                icon={t.icon}
                sub={t.desc}
                actions={r && <Badge kind={VERDICT[r.verdict].kind}>{VERDICT[r.verdict].label} · {r.score}</Badge>}
              >
                {skip ? (
                  <div className="faint small">跳过：{skip}</div>
                ) : !r ? (
                  <div className="row" style={{ gap: 8 }}>
                    <Spinner /> <span className="faint small">运行中…</span>
                  </div>
                ) : (
                  <TestView test={r} keys={options.map(([k]) => k)} keyLabel={keyLabel} metricLabel={metricLabel} />
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Facts({ test, metricLabel }: { test: RobustTest; metricLabel: string }) {
  return (
    <div className="lab-facts">
      <div>
        <span>结论一致率</span>
        <b className="num">{pct(test.consistency, 0)}</b>
      </div>
      <div>
        <span>最大漂移</span>
        <b className="num">{(test.max_delta * 100).toFixed(1)} pp</b>
      </div>
      <div>
        <span>平均漂移</span>
        <b className="num">
          {test.mean_delta >= 0 ? "+" : ""}
          {(test.mean_delta * 100).toFixed(1)} pp
        </b>
      </div>
      <div>
        <span>基准 {metricLabel}</span>
        <b className="num">{pct(test.base_value)}</b>
      </div>
    </div>
  );
}

function TestView({
  test,
  keys,
  keyLabel,
  metricLabel,
}: {
  test: RobustTest;
  keys: string[];
  keyLabel: (k: string) => string;
  metricLabel: string;
}) {
  if (test.test === "order") {
    return (
      <div className="col" style={{ gap: 16 }}>
        <Facts test={test} metricLabel={metricLabel} />
        <div className="grid g2">
          <div>
            <div className="lab-sub">每个位置平均分到的概率（无偏时都约为 {pct(1 / keys.length, 0)}）</div>
            <div className="slots">
              {test.position_mass?.map((m, i) => (
                <div key={i} className="slot">
                  <div className="slot-bar">
                    <i style={{ height: `${Math.min(1, m) * 100}%` }} />
                    <span className="slot-even" style={{ bottom: `${100 / keys.length}%` }} />
                  </div>
                  <span className="letter">{LETTERS[i]}</span>
                  <span className="mono tiny num">{pct(m, 0)}</span>
                  <span className="faint tiny num">胜 {pct(test.position_winner_rate?.[i] ?? 0, 0)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="lab-sub">每种排列下各选项的概率</div>
            <div className="perm" style={{ gridTemplateColumns: `minmax(0, 1.4fr) repeat(${keys.length}, minmax(36px, 1fr))` }}>
              <span />
              {keys.map((k) => (
                <span key={k} className="perm-h mono">
                  {keyLabel(k)}
                </span>
              ))}
              {test.variants.slice(0, 12).map((v) => (
                <div key={v.label} style={{ display: "contents" }}>
                  <span className={`perm-l mono ${v.agree ? "" : "bad"}`}>{(v.order as string[]).map((k) => LETTERS[keys.indexOf(k)]).join("")}</span>
                  {keys.map((k) => (
                    <span key={k} className="perm-c" style={{ background: `rgba(124,108,255,${0.06 + v.probabilities[k] * 0.85})` }}>
                      {(v.probabilities[k] * 100).toFixed(0)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (test.test === "distractor") {
    const series = (["before", "after"] as const).map((pos) => ({
      name: pos === "before" ? "插在前面" : "插在后面",
      color: pos === "before" ? "#a78bfa" : "#22d3ee",
      points: [{ x: 0, y: test.base_value }, ...test.variants.filter((v) => v.position === pos).map((v) => ({ x: v.count as number, y: v.value }))],
    }));
    return (
      <div className="col" style={{ gap: 16 }}>
        <Facts test={test} metricLabel={metricLabel} />
        <LineChart series={series} height={220} yMin={0} yMax={1} yFormat={(v) => pct(v, 0)} xFormat={(v) => `${v} 段`} xLabel={`插入的无关段落数 → ${metricLabel}`} />
      </div>
    );
  }
  return (
    <div className="col" style={{ gap: 16 }}>
      <Facts test={test} metricLabel={metricLabel} />
      {test.test === "injection" && (
        <div className="small muted">
          被诱导选项的概率平均抬高 <b className={(test.mean_lift ?? 0) > 0.1 ? "bad" : ""}>{((test.mean_lift ?? 0) * 100).toFixed(1)} pp</b>；结论被劫持{" "}
          <b className={(test.hijacked ?? 0) > 0 ? "bad" : "ok"}>{test.hijacked ?? 0}</b> 次。
        </div>
      )}
      <div className="variants">
        {test.variants.map((v, i) => (
          <div key={i} className={`variant ${v.agree ? "" : "flip"}`}>
            <div className="variant-label">
              {v.style ? <Badge kind={v.style === "system" ? "bad" : "warn"}>{v.style === "system" ? "伪系统指令" : "诱导语"}</Badge> : null}
              {v.generated ? <Badge kind="brand">大模型生成</Badge> : null}
              <span className={test.test === "naming" ? "" : "ellipsis"}>{v.label}</span>
            </div>
            <div className="variant-bar">
              <i style={{ width: `${v.value * 100}%` }} />
              <span className="variant-base" style={{ left: `${test.base_value * 100}%` }} />
            </div>
            <span className="mono tiny num" style={{ width: 54, textAlign: "right" }}>
              {pct(v.value, 1)}
            </span>
            <span className={`mono tiny num ${Math.abs(v.delta) > 0.15 ? "bad" : "faint"}`} style={{ width: 62, textAlign: "right" }}>
              {v.delta >= 0 ? "+" : ""}
              {(v.delta * 100).toFixed(1)}
            </span>
            {v.agree ? <Badge kind="ok">一致</Badge> : <Badge kind="bad">→ {keyLabel(v.winner)}</Badge>}
          </div>
        ))}
      </div>
    </div>
  );
}
