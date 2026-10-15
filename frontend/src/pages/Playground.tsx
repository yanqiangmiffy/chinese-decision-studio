import {
  Bot,
  Braces,
  CircleDot,
  Code2,
  Eraser,
  FileJson,
  FlaskConical,
  Gauge as GaugeIcon,
  Highlighter,
  Library,
  ListChecks,
  Microscope,
  Play,
  Plus,
  Sparkles,
  Tag,
  Terminal,
  Thermometer,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { AnswerView, EvidenceText, QuestionEditor, StateEditor } from "../components/decision";
import {
  Badge,
  Button,
  Card,
  CodeBlock,
  Empty,
  KindBadge,
  Modal,
  PageHead,
  Slider,
  Spinner,
  Tabs,
  Tip,
  Toggle,
} from "../components/ui";
import { useApp } from "../hooks/useApp";
import { useStored } from "../hooks/useAsync";
import { emptyQuestion, optionsOf, rescale, uniqueName, validateQuestion } from "../lib/decision";
import { ms, pct } from "../lib/format";
import { handoff, PRESET_CATEGORIES, PRESETS, takeHandoff, type Preset } from "../lib/presets";
import { navigate, useTitle } from "../router";
import type { DecideResult, DecisionRequest, ExplainResult, Kind, Question, State } from "../types";

interface Draft {
  stateText: string;
  json: boolean;
  questions: { name: string; q: Question }[];
}

function draftFrom(state: State, questions: Record<string, Question>): Draft {
  const json = typeof state !== "string";
  return {
    stateText: json ? JSON.stringify(state, null, 2) : (state as string),
    json,
    questions: Object.entries(questions).map(([name, q]) => ({ name, q })),
  };
}

const DEFAULT = draftFrom(PRESETS[0].state, PRESETS[0].questions);

function snippets(base: string, req: DecisionRequest) {
  const body = JSON.stringify(req, null, 2);
  const oneLine = JSON.stringify(req);
  return {
    curl: `curl ${base}/v1/systemone \\\n  -H 'Content-Type: application/json' \\\n  -d '${oneLine.replace(/'/g, "'\\''")}'`,
    python: `import requests\n\npayload = ${body.replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None")}\n\nresp = requests.post("${base}/v1/systemone", json=payload, timeout=30)\nanswers = resp.json()["answers"]\nfor name, answer in answers.items():\n    print(name, answer["type"], answer["probabilities"])`,
    js: `const resp = await fetch("${base}/v1/systemone", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(${body.replace(/\n/g, "\n  ")}),\n});\nconst { answers, latency_ms } = await resp.json();`,
  };
}

export default function Playground() {
  useTitle("决策实验台");
  const { health, toast } = useApp();
  const [draft, setDraft] = useStored<Draft>("ds-playground", DEFAULT);
  const [result, setResult] = useState<DecideResult | null>(null);
  const [lastReq, setLastReq] = useState<DecisionRequest | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temperature, setTemperature] = useState(1);
  const [compareLLM, setCompareLLM] = useStored("ds-compare-llm", false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [tab, setTab] = useState<"request" | "response" | "curl" | "python" | "js" | "prompt">("request");
  const [explains, setExplains] = useState<Record<string, ExplainResult | "loading">>({});
  const [prompts, setPrompts] = useState<Awaited<ReturnType<typeof api.compile>> | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const abort = useRef<AbortController | null>(null);

  // 从其他页面"在实验台打开"
  useEffect(() => {
    const incoming = takeHandoff();
    if (incoming) {
      setDraft(draftFrom(incoming.state, incoming.questions));
      setResult(null);
    }
  }, [setDraft]);

  const parsed = useMemo((): { state: State | null; error: string | null } => {
    if (!draft.json) return { state: draft.stateText, error: draft.stateText.trim() ? null : "请填写上下文" };
    try {
      return { state: JSON.parse(draft.stateText), error: null };
    } catch (e) {
      return { state: null, error: `JSON 格式错误：${(e as Error).message}` };
    }
  }, [draft.stateText, draft.json]);

  const qErrors = draft.questions.map(({ q }) => validateQuestion(q));
  const names = draft.questions.map((x) => x.name);
  const nameError = new Set(names).size !== names.length ? "问题名不能重复" : names.some((n) => !n) ? "问题名不能为空" : null;
  const canRun = !parsed.error && !nameError && qErrors.every((e) => !e) && draft.questions.length > 0;

  const request = useMemo((): DecisionRequest | null => {
    if (parsed.state === null) return null;
    return { state: parsed.state, questions: Object.fromEntries(draft.questions.map(({ name, q }) => [name, cleanQuestion(q)])) };
  }, [parsed.state, draft.questions]);

  const run = useCallback(async () => {
    if (!request || !canRun) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    setError(null);
    setExplains({});
    setPrompts(null);
    setLabels({});
    try {
      const res = await api.decide({ ...request, source: "playground", compare_llm: compareLLM }, ctrl.signal);
      setResult(res);
      setLastReq(request);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [request, canRun, compareLLM]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

  useEffect(() => {
    if (tab === "prompt" && lastReq && !prompts) api.compile(lastReq).then(setPrompts).catch(() => undefined);
  }, [tab, lastReq, prompts]);

  const loadPreset = (p: Preset) => {
    setDraft(draftFrom(p.state, p.questions));
    setResult(null);
    setPresetOpen(false);
    toast(`已载入示例：${p.title}`, "ok");
  };

  const addQuestion = (type: Kind) =>
    setDraft((d) => ({ ...d, questions: [...d.questions, { name: uniqueName(d.questions.map((x) => x.name)), q: emptyQuestion(type) }] }));

  const explain = async (name: string) => {
    if (!lastReq) return;
    setExplains((x) => ({ ...x, [name]: "loading" }));
    try {
      const res = await api.explain(lastReq.state, lastReq.questions[name]);
      setExplains((x) => ({ ...x, [name]: res }));
    } catch (e) {
      toast((e as Error).message, "bad");
      setExplains((x) => {
        const next = { ...x };
        delete next[name];
        return next;
      });
    }
  };

  const label = async (name: string, key: string) => {
    if (!result?.log_id) return;
    const next = { ...labels, [name]: key };
    setLabels(next);
    try {
      await api.labelHistory(result.log_id, { labels: Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v])) });
      toast("已保存标注，可以在历史记录里把它加入评测集", "ok");
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  const openInLab = (name: string) => {
    if (!lastReq) return;
    handoff({ state: lastReq.state, questions: { [name]: lastReq.questions[name] } });
    navigate("/lab");
  };

  const base = health?.decision.base_url ?? "http://<决策服务>:8003";
  const code = request ? snippets(base, request) : null;
  const answers = result?.response.answers ?? {};
  const decisionMs = result?.response.latency_ms;

  return (
    <div className="page">
      <PageHead
        eyebrow="PLAYGROUND · 决策实验台"
        icon={<FlaskConical />}
        title={
          <>
            把任何判断变成<span className="grad-text">一次前向</span>
          </>
        }
        desc="写下上下文和几个问题，模型直接返回每个候选项的概率——不生成文本、零输出 token。多个问题在一次请求里并行评估。"
        actions={
          <>
            <Button icon={<Library />} onClick={() => setPresetOpen(true)}>
              示例库
            </Button>
            <Button
              variant="ghost"
              icon={<Eraser />}
              onClick={() => {
                setDraft({ stateText: "", json: false, questions: [{ name: "q1", q: emptyQuestion("noul") }] });
                setResult(null);
              }}
            >
              清空
            </Button>
          </>
        }
      />

      <div className="pg-grid">
        {/* ---------------------------------------------------------------- 输入 */}
        <Card title="输入" icon={<Braces />} className="pg-input" sub={`${draft.questions.length} 个问题 · 一次请求`}>
          <StateEditor
            value={draft.stateText}
            json={draft.json}
            onChange={(v) => setDraft((d) => ({ ...d, stateText: v }))}
            onToggleJson={(json) => {
              setDraft((d) => {
                if (json && !d.json) return { ...d, json, stateText: JSON.stringify({ 内容: d.stateText }, null, 2) };
                if (!json && d.json) {
                  try {
                    const v = JSON.parse(d.stateText);
                    return { ...d, json, stateText: typeof v === "string" ? v : JSON.stringify(v, null, 2) };
                  } catch {
                    return { ...d, json };
                  }
                }
                return d;
              });
            }}
            error={parsed.error && draft.stateText ? parsed.error : null}
            tokens={result?.response.usage.input_tokens ? Math.round(result.response.usage.input_tokens / Math.max(1, Object.keys(answers).length)) : null}
          />
          <div className="pg-qhead">
            <span className="label">
              问题 questions <span className="hint">每个问题独立评估，可混合三种题型</span>
            </span>
            <div className="row">
              <Button size="sm" icon={<Plus />} onClick={() => addQuestion("noul")}>
                是/否
              </Button>
              <Button size="sm" icon={<Plus />} onClick={() => addQuestion("choice")}>
                单选
              </Button>
              <Button size="sm" icon={<Plus />} onClick={() => addQuestion("score")}>
                评分
              </Button>
            </div>
          </div>
          <div className="col" style={{ gap: 10 }}>
            {draft.questions.map(({ name, q }, i) => (
              <QuestionEditor
                key={i}
                index={i}
                name={name}
                question={q}
                error={qErrors[i]}
                onRename={(n) => setDraft((d) => ({ ...d, questions: d.questions.map((x, j) => (j === i ? { ...x, name: n } : x)) }))}
                onChange={(nq) => setDraft((d) => ({ ...d, questions: d.questions.map((x, j) => (j === i ? { ...x, q: nq } : x)) }))}
                onRemove={draft.questions.length > 1 ? () => setDraft((d) => ({ ...d, questions: d.questions.filter((_, j) => j !== i) })) : undefined}
              />
            ))}
            {nameError && <div className="qedit-error">{nameError}</div>}
          </div>
          <div className="pg-run">
            <Toggle
              on={compareLLM}
              onChange={setCompareLLM}
              label={
                <span className="row" style={{ gap: 6 }}>
                  <Bot size={15} /> 对比大模型
                  {health?.llm.configured ? (
                    <span className="faint tiny">{health.llm.model}</span>
                  ) : (
                    <span className="faint tiny">（未配置）</span>
                  )}
                </span>
              }
            />
            <span className="grow" />
            <span className="faint tiny row" style={{ gap: 4 }}>
              <kbd>Ctrl</kbd>
              <kbd>↵</kbd>
            </span>
            <Button variant="primary" size="lg" icon={<Play />} loading={running} disabled={!canRun} onClick={run}>
              运行决策
            </Button>
          </div>
        </Card>

        {/* ---------------------------------------------------------------- 输出 */}
        <div className="pg-output">
          {error && (
            <div className="card card-pad pg-error">
              <b>请求失败：</b>
              {error}
            </div>
          )}
          {!result && !running && !error && (
            <Card className="pg-empty-card">
              <Empty icon={<Sparkles />} title="准备好了">
                调整左侧的上下文和问题，然后点击「运行决策」或按 <kbd>Ctrl</kbd> + <kbd>↵</kbd>。
                <div className="row wrap" style={{ justifyContent: "center", marginTop: 16, gap: 8 }}>
                  {PRESETS.slice(0, 6).map((p) => (
                    <button key={p.id} className="chip" onClick={() => loadPreset(p)}>
                      {p.title}
                    </button>
                  ))}
                </div>
              </Empty>
            </Card>
          )}
          {running && !result && (
            <Card className="pg-empty-card">
              <Empty icon={<Spinner />} title="正在前向计算…">
                {draft.questions.length} 个问题会被合进同一个 batch
              </Empty>
            </Card>
          )}
          {result && lastReq && (
            <>
              <div className="pg-meta card">
                <div className="pg-meta-item">
                  <Zap />
                  <div>
                    <div className="pg-meta-val num">{ms(decisionMs)}</div>
                    <div className="pg-meta-lbl">端到端延迟</div>
                  </div>
                </div>
                <div className="pg-meta-item">
                  <ListChecks />
                  <div>
                    <div className="pg-meta-val num">{Object.keys(answers).length}</div>
                    <div className="pg-meta-lbl">个决策</div>
                  </div>
                </div>
                <div className="pg-meta-item">
                  <CircleDot />
                  <div>
                    <div className="pg-meta-val num">
                      {result.response.usage.input_tokens}
                      <span className="faint"> / 0</span>
                    </div>
                    <div className="pg-meta-lbl">输入 / 输出 tokens</div>
                  </div>
                </div>
                <div className="pg-temp">
                  <div className="row between">
                    <span className="pg-meta-lbl row" style={{ gap: 5 }}>
                      <Thermometer size={14} /> 温度 T
                      <Tip text="在客户端对 logits 做 softmax(z / T)：T > 1 让分布更平缓，T < 1 更尖锐。决策服务当前未校准（T = 1）。">
                        <span className="faint">ⓘ</span>
                      </Tip>
                    </span>
                    <b className="mono num">{temperature.toFixed(2)}</b>
                  </div>
                  <Slider value={Math.log2(temperature)} min={-2} max={2} step={0.05} onChange={(v) => setTemperature(Math.pow(2, v))} />
                  <div className="row between tiny faint">
                    <span>0.25 尖锐</span>
                    <button className="linklike" onClick={() => setTemperature(1)}>
                      重置
                    </button>
                    <span>4 平缓</span>
                  </div>
                </div>
              </div>

              <div className="col stagger" style={{ gap: 14 }}>
                {Object.entries(answers).map(([name, raw], i) => {
                  const q = lastReq.questions[name];
                  const answer = rescale(raw, temperature);
                  const ex = explains[name];
                  const keys = optionsOf(q).map(([k, v]) => ({ k, v }));
                  return (
                    <Card
                      key={name}
                      className="result-card"
                      title={
                        <span className="row" style={{ gap: 8 }}>
                          <span className={`qedit-index ${q.type}`}>{i + 1}</span>
                          <span className="mono">{name}</span>
                          <KindBadge kind={q.type} />
                        </span>
                      }
                      sub={<span className="result-instr">{q.instructions}</span>}
                      actions={
                        <>
                          <Button size="sm" variant="ghost" icon={<Highlighter />} loading={ex === "loading"} onClick={() => explain(name)}>
                            证据归因
                          </Button>
                          <Button size="sm" variant="ghost" icon={<Microscope />} onClick={() => openInLab(name)}>
                            鲁棒性
                          </Button>
                        </>
                      }
                    >
                      <AnswerView answer={answer} question={q} llm={result.llm?.[name]} decisionMs={decisionMs} />
                      {ex && ex !== "loading" && (
                        <div className="explain-box">
                          <div className="row between" style={{ marginBottom: 10 }}>
                            <span className="small" style={{ fontWeight: 600 }}>
                              证据归因 · 逐段遮挡，看
                              {ex.metric === "expected_score" ? "期望等级" : `「${ex.target}」的概率`}
                              变化多少
                            </span>
                            <span className="faint tiny num">
                              {ex.decisions} 次前向 · {ms(ex.latency_ms)}
                            </span>
                          </div>
                          <EvidenceText segments={ex.segments} structured={ex.structured} />
                          <div className="ev-legend" style={{ marginTop: 10 }}>
                            <span>
                              <i style={{ background: "rgba(52,211,153,.5)" }} />
                              支撑当前判断
                            </span>
                            <span>
                              <i style={{ background: "rgba(251,113,133,.5)" }} />
                              拉向反方向
                            </span>
                            <span>
                              <i style={{ outline: "1.5px dashed rgba(251,191,36,.8)" }} />
                              删掉后判断会翻转
                            </span>
                          </div>
                        </div>
                      )}
                      {result.log_id && (
                        <div className="label-row">
                          <Tag size={14} />
                          <span className="faint tiny">标注正确答案</span>
                          {keys.map(({ k, v }) => (
                            <button key={k} className={`chip ${labels[name] === k ? "on" : ""}`} onClick={() => label(name, k)} title={v}>
                              {q.type === "score" ? v : q.type === "noul" ? (k === "true" ? "是" : "否") : k}
                            </button>
                          ))}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          {request && (
            <Card className="pg-code" bodyClass="">
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: "request", label: "请求", icon: <FileJson /> },
                  { value: "response", label: "响应", icon: <Braces /> },
                  { value: "curl", label: "cURL", icon: <Terminal /> },
                  { value: "python", label: "Python", icon: <Code2 /> },
                  { value: "js", label: "JavaScript", icon: <Code2 /> },
                  { value: "prompt", label: "编译后的提示词", icon: <GaugeIcon /> },
                ]}
              />
              <div className="card-body">
                {tab === "request" && <CodeBlock lang="json" code={JSON.stringify(request, null, 2)} />}
                {tab === "response" &&
                  (result ? <CodeBlock lang="json" code={JSON.stringify(result.response, null, 2)} /> : <div className="faint small">运行后显示决策服务的原始响应。</div>)}
                {tab === "curl" && code && <CodeBlock code={code.curl} />}
                {tab === "python" && code && <CodeBlock code={code.python} />}
                {tab === "js" && code && <CodeBlock code={code.js} />}
                {tab === "prompt" &&
                  (!lastReq ? (
                    <div className="faint small">运行后显示每个问题被编译成的提示词（与训练时完全一致）。</div>
                  ) : !prompts ? (
                    <Spinner />
                  ) : (
                    <div className="col" style={{ gap: 12 }}>
                      {Object.entries(prompts.questions).map(([name, p]) => (
                        <div key={name}>
                          <div className="row between small" style={{ marginBottom: 6 }}>
                            <span className="mono">{name}</span>
                            <span className="faint num">
                              {p.input_tokens} tokens · {prompts.prompt_version}
                            </span>
                          </div>
                          <CodeBlock code={p.prompt} maxHeight={280} />
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            </Card>
          )}
          {result && (
            <div className="faint tiny row" style={{ gap: 6, justifyContent: "flex-end" }}>
              <Badge kind="brand">step {health?.decision.step ?? "—"}</Badge>
              已写入历史记录 #{result.log_id} · 最高置信 {pct(Math.max(...Object.values(answers).map((a) => a.confidence)), 0)}
            </div>
          )}
        </div>
      </div>

      <Modal open={presetOpen} title="示例库" onClose={() => setPresetOpen(false)} wide>
        <div className="col" style={{ gap: 22 }}>
          {PRESET_CATEGORIES.map((cat) => (
            <div key={cat}>
              <div className="preset-cat">{cat}</div>
              <div className="preset-grid">
                {PRESETS.filter((p) => p.category === cat).map((p) => (
                  <button key={p.id} className="preset" onClick={() => loadPreset(p)}>
                    <div className="row between">
                      <b>{p.title}</b>
                      <div className="row" style={{ gap: 4 }}>
                        {Array.from(new Set(Object.values(p.questions).map((q) => q.type))).map((k) => (
                          <KindBadge key={k} kind={k} />
                        ))}
                      </div>
                    </div>
                    <p>{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/** 去掉空的可选字段，让请求体干净一些（noul 的空描述不传）。 */
function cleanQuestion(q: Question): Question {
  if (q.type === "noul") {
    const c = (q.criteria as { false?: string; true?: string }) ?? {};
    const out: Record<string, string> = {};
    if (c.false?.trim()) out.false = c.false.trim();
    if (c.true?.trim()) out.true = c.true.trim();
    return Object.keys(out).length ? { type: "noul", instructions: q.instructions.trim(), criteria: out } : { type: "noul", instructions: q.instructions.trim() };
  }
  if (q.type === "choice") {
    const entries = Object.entries((q.criteria as Record<string, string>) ?? {}).map(([k, v]) => [k.trim(), v.trim()]);
    return { type: "choice", instructions: q.instructions.trim(), criteria: Object.fromEntries(entries) };
  }
  return { type: "score", instructions: q.instructions.trim(), criteria: ((q.criteria as string[]) ?? []).map((v) => v.trim()) };
}
