import { Braces, Eraser, FlaskConical, Library, Play, ScanText, Sparkles, Tags } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { DomainPicker, EntityList, EntityText, ExtractionOffline, TypeEditor, TypeLegend, typeColors, typesPayload, useExtractionStatus } from "../components/extraction";
import { Badge, Button, Card, CodeBlock, Empty, Modal, PageHead, Segmented, Slider, Tabs } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { useStored } from "../hooks/useAsync";
import { CASES, DOMAINS, takeExtractHandoff, typesOf, type ExtractCase } from "../lib/extractionCases";
import { TYPE_SETS, type TypeSpec } from "../lib/extractionTypes";
import { ms } from "../lib/format";
import { useTitle } from "../router";
import type { ExtractResult } from "../types";

export type PlaygroundMode = "decide" | "extract";

/** 实验台顶部的“决策 / 抽取”切换：两种模式共用一个页面。 */
export function ModeSwitch({ value, onChange }: { value: PlaygroundMode; onChange: (v: PlaygroundMode) => void }) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        { value: "decide", label: "决策", icon: <FlaskConical /> },
        { value: "extract", label: "抽取", icon: <ScanText /> },
      ]}
    />
  );
}

interface Draft {
  text: string;
  types: TypeSpec[];
}

const draftOf = (c: ExtractCase): Draft => ({ text: c.text, types: typesOf(c).map((t) => ({ ...t })) });
const FIRST = CASES.find((c) => c.id === "address-1") ?? CASES[0];

function snippets(base: string, body: object) {
  const json = JSON.stringify(body, null, 2);
  return {
    curl: `curl ${base}/v1/extract \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`,
    python: `import requests\n\npayload = ${json}\n\nresp = requests.post("${base}/v1/extract", json=payload, timeout=30)\nfor e in resp.json()["entities"]:\n    print(e["label"], e["text"], e["start"], e["end"], e["score"])`,
  };
}

export default function ExtractionLab({ modeSwitch }: { modeSwitch: ReactNode }) {
  useTitle("决策实验台 · 抽取");
  const { toast } = useApp();
  const status = useExtractionStatus();
  const [draft, setDraft] = useStored<Draft>("ds-extract-draft", draftOf(FIRST));
  const [threshold, setThreshold] = useState(0);
  const [result, setResult] = useState<{ res: ExtractResult; order: string[]; body: object } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [domain, setDomain] = useState<string>(DOMAINS[0].id);
  const [tab, setTab] = useState<"curl" | "python" | "response">("curl");
  const abort = useRef<AbortController | null>(null);

  // 从场景库“在实验台打开”
  useEffect(() => {
    const incoming = takeExtractHandoff();
    if (incoming) {
      setDraft({ text: incoming.text, types: incoming.types.map((t) => ({ ...t })) });
      setResult(null);
    }
  }, [setDraft]);

  const payload = useMemo(() => typesPayload(draft.types), [draft.types]);
  const nameCount = Object.keys(payload).length;
  const problem = !draft.text.trim() ? "请填写要抽取的文本" : nameCount === 0 ? "至少需要一个有名称的类型" : draft.text.length > 2000 ? "文本最长 2000 字" : null;

  const run = useCallback(async () => {
    if (problem) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    setError(null);
    const body = { text: draft.text, types: payload, ...(threshold > 0 ? { threshold } : {}) };
    try {
      const res = await api.extract(body, ctrl.signal);
      setResult({ res, order: Object.keys(payload), body });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [draft.text, payload, threshold, problem]);

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

  const load = (c: ExtractCase) => {
    setDraft(draftOf(c));
    setResult(null);
    setLibraryOpen(false);
    toast(`已载入示例：${c.title}`, "ok");
  };

  const colors = typeColors(result?.order ?? Object.keys(payload));
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    result?.res.entities.forEach((e) => (out[e.label] = (out[e.label] ?? 0) + 1));
    return out;
  }, [result]);
  const code = result ? snippets(status.baseUrl ?? "http://<统一模型服务>:8011", result.body) : null;
  const shown = CASES.filter((c) => c.domain === domain);

  return (
    <div className="page">
      <PageHead
        eyebrow="PLAYGROUND · 决策实验台"
        icon={<ScanText />}
        title={
          <>
            从文本里找出<span className="grad-text">你定义的类型</span>
          </>
        }
        desc="写下文本，再写下要找的类型（名称 + 说明），模型直接返回每个实体的位置和概率。和决策是同一份权重，一次前向、不生成文本。"
        actions={
          <>
            {modeSwitch}
            <Button icon={<Library />} onClick={() => setLibraryOpen(true)}>
              示例库
            </Button>
            <Button
              variant="ghost"
              icon={<Eraser />}
              onClick={() => {
                setDraft({ text: "", types: [{ name: "", desc: "" }] });
                setResult(null);
              }}
            >
              清空
            </Button>
          </>
        }
      />

      {!status.ready ? (
        <ExtractionOffline />
      ) : (
        <div className="pg-grid">
          <Card title="输入" icon={<Braces />} className="pg-input" sub={`${nameCount} 个类型 · 一次请求`}>
            <div className="col" style={{ gap: 6 }}>
              <span className="label">
                文本 text <span className="hint">{draft.text.length} / 2000 字</span>
              </span>
              <textarea className="textarea" rows={5} value={draft.text} placeholder="粘贴一段要抽取的文本…" onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} />
            </div>
            <div className="col" style={{ gap: 8 }}>
              <div className="pg-qhead">
                <span className="label">
                  类型 types <span className="hint">每个类型是“名称 + 说明”</span>
                </span>
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="faint tiny">换成训练时的类型组：</span>
                {Object.entries(TYPE_SETS).map(([key, set]) => (
                  <button key={key} className="chip" title={`说明取自 ${set.source}`} onClick={() => setDraft((d) => ({ ...d, types: set.types.map((t) => ({ ...t })) }))}>
                    {set.title}
                  </button>
                ))}
              </div>
              <TypeEditor types={draft.types} onChange={(types) => setDraft((d) => ({ ...d, types }))} />
              <div className="ex-tip">
                <Sparkles size={14} />
                <span>
                  类型的说明越接近训练时的写法，召回越高。例如地址要素用训练说明能抽出 7 个，只写类型名只能抽出 3 个；训练里没有的新类型基本抽不出来。
                </span>
              </div>
            </div>
            <div className="col" style={{ gap: 6 }}>
              <div className="row between small">
                <span>最低概率 threshold</span>
                <b className="mono">{threshold.toFixed(2)}</b>
              </div>
              <Slider value={threshold} min={0} max={0.9} step={0.05} onChange={setThreshold} />
              <div className="faint tiny">0 = 保留模型判断为某类型的全部实体；调高只留高置信度的结果。</div>
            </div>
            <div className="pg-run">
              {problem && <span className="faint tiny">{problem}</span>}
              <span className="grow" />
              <span className="faint tiny row" style={{ gap: 4 }}>
                <kbd>Ctrl</kbd>
                <kbd>↵</kbd>
              </span>
              <Button variant="primary" size="lg" icon={<Play />} loading={running} disabled={!!problem} onClick={run}>
                运行抽取
              </Button>
            </div>
          </Card>

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
                  调整左侧的文本和类型，然后点击「运行抽取」或按 <kbd>Ctrl</kbd> + <kbd>↵</kbd>。
                  <div className="row wrap" style={{ justifyContent: "center", marginTop: 16, gap: 8 }}>
                    {CASES.filter((c) => ["address-1", "medical-1", "resume-1", "news-2", "ecom-1", "legal-1"].includes(c.id)).map((c) => (
                      <button key={c.id} className="chip" onClick={() => load(c)}>
                        {c.title}
                      </button>
                    ))}
                  </div>
                </Empty>
              </Card>
            )}
            {result && (
              <>
                <Card
                  title="标注结果"
                  icon={<Tags />}
                  sub={`${result.res.entities.length} 个实体 · ${result.res.model}`}
                  actions={<Badge kind="info">{ms(result.res.latency_ms)}</Badge>}
                >
                  <EntityText text={result.res.text} entities={result.res.entities} colors={colors} />
                  <div style={{ marginTop: 14 }}>
                    <TypeLegend names={result.order} colors={colors} counts={counts} />
                  </div>
                </Card>
                <Card title="按类型汇总" sub="每个实体后面是模型给它的概率">
                  <EntityList entities={result.res.entities} order={result.order} colors={colors} />
                </Card>
                <Card
                  title="调用方式"
                  actions={
                    <Tabs
                      value={tab}
                      onChange={setTab}
                      tabs={[
                        { value: "curl", label: "cURL" },
                        { value: "python", label: "Python" },
                        { value: "response", label: "响应" },
                      ]}
                    />
                  }
                >
                  {code && <CodeBlock code={tab === "response" ? JSON.stringify(result.res, null, 2) : code[tab]} lang={tab === "response" ? "json" : "text"} maxHeight={320} />}
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      <Modal open={libraryOpen} onClose={() => setLibraryOpen(false)} title="抽取示例库" wide>
        <DomainPicker value={domain} onChange={setDomain} />
        <p className="faint small" style={{ margin: "10px 0 14px" }}>
          {DOMAINS.find((d) => d.id === domain)?.desc}
        </p>
        <div className="ex-library">
          {shown.map((c) => (
            <button key={c.id} className="ex-case" onClick={() => load(c)}>
              <div className="row between">
                <b>{c.title}</b>
                <span className="faint tiny">{typesOf(c).length} 个类型</span>
              </div>
              <div className="ex-case-text">{c.text}</div>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
