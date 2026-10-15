import {
  ArrowDown,
  ArrowUp,
  Braces,
  CircleCheck,
  CircleHelp,
  CircleX,
  Plus,
  Trash2,
  Type,
} from "lucide-react";
import { type ReactNode } from "react";
import { entropy, KIND_HINT, KIND_LABEL, LETTERS, margin, noulVerdict, optionsOf, ranked } from "../lib/decision";
import { ms, pct } from "../lib/format";
import type { Answer, Kind, LLMAnswer, Question } from "../types";
import { Gauge, Ring } from "./charts";
import { Badge, Segmented, Tip } from "./ui";

// ======================================================================= 结果展示

export function ProbBars({
  answer,
  question,
  llm,
  limit,
}: {
  answer: Answer;
  question?: Question;
  llm?: LLMAnswer | null;
  limit?: number;
}) {
  const options = question ? optionsOf(question) : Object.keys(answer.probabilities).map((k) => [k, ""] as [string, string]);
  const descs = Object.fromEntries(options);
  const order = options.map(([k]) => k);
  const win = ranked(answer)[0][0];
  const rows = answer.type === "score" ? order : ranked(answer).map(([k]) => k);
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <div className="probs">
      {shown.map((k) => {
        const p = answer.probabilities[k] ?? 0;
        const letter = LETTERS[order.indexOf(k)];
        const llmP = llm && !llm.error ? llm.probabilities[order.indexOf(k)] : null;
        return (
          <div key={k} className={`prob ${k === win ? "win" : ""}`} title={answer.logits ? `logit ${answer.logits[k]}` : undefined}>
            <span className={`letter ${k === win ? "win" : ""}`}>{letter}</span>
            <div className="prob-label">
              <span className="prob-key">{answer.type === "score" ? descs[k] || k : k}</span>
              {answer.type !== "score" && descs[k] && <span className="prob-desc">{descs[k]}</span>}
            </div>
            <span className="prob-val">{pct(p, 1)}</span>
            <div className="prob-track">
              <div className="prob-fill" style={{ width: `${p * 100}%` }} />
              {llmP !== null && llmP !== undefined && (
                <Tip text={`${llm?.model}：${pct(llmP, 1)}`}>
                  <span className="llm-mark" style={{ left: `calc(${llmP * 100}% - 1px)` }} />
                </Tip>
              )}
            </div>
          </div>
        );
      })}
      {limit && rows.length > limit && <div className="faint tiny">还有 {rows.length - limit} 个候选项…</div>}
    </div>
  );
}

export function NoulMeter({ p, labels }: { p: number; labels?: [string, string] }) {
  const v = noulVerdict(p);
  return (
    <div className="noul">
      <div className="noul-top">
        <div>
          <div className="noul-big num">
            {(p * 100).toFixed(1)}
            <span>%</span>
          </div>
          <div className="faint small">判断为「{labels?.[1] ?? "是"}」的概率</div>
        </div>
        <VerdictPill verdict={v} labels={labels} />
      </div>
      <div className="noul-bar">
        <div className="noul-no" style={{ width: `${(1 - p) * 100}%` }}>
          <span>{labels?.[0] ?? "否"}</span>
        </div>
        <div className="noul-yes" style={{ width: `${p * 100}%` }}>
          <span>{labels?.[1] ?? "是"}</span>
        </div>
        <i className="noul-band" />
      </div>
      <div className="noul-scale">
        <span>0</span>
        <span>30%</span>
        <span>50%</span>
        <span>70%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export function VerdictPill({ verdict, labels }: { verdict: "yes" | "no" | "unsure"; labels?: [string, string] }) {
  if (verdict === "yes")
    return (
      <span className="verdict yes">
        <CircleCheck /> {labels?.[1] ?? "是"}
      </span>
    );
  if (verdict === "no")
    return (
      <span className="verdict no">
        <CircleX /> {labels?.[0] ?? "否"}
      </span>
    );
  return (
    <span className="verdict unsure">
      <CircleHelp /> 不确定
    </span>
  );
}

export function ConfidenceStats({ answer }: { answer: Answer }) {
  const top = ranked(answer)[0][1];
  return (
    <div className="conf">
      <Ring value={answer.confidence} size={76} stroke={8}>
        <div>
          <div className="conf-val num">{(answer.confidence * 100).toFixed(0)}</div>
          <div className="conf-lbl">置信度</div>
        </div>
      </Ring>
      <div className="conf-list">
        <Tip text="最高候选的概率。在校准良好的模型上，它近似于判断正确的概率。">
          <div className="conf-item">
            <span>p_max</span>
            <b className="num">{pct(top)}</b>
          </div>
        </Tip>
        <Tip text="第一名与第二名的概率差。差距越小，越需要人工复核。">
          <div className="conf-item">
            <span>领先幅度</span>
            <b className="num">{pct(margin(answer))}</b>
          </div>
        </Tip>
        <Tip text="归一化熵：0 表示完全确定，100% 表示均匀分布。">
          <div className="conf-item">
            <span>不确定性</span>
            <b className="num">{pct(entropy(answer), 0)}</b>
          </div>
        </Tip>
      </div>
    </div>
  );
}

export function LLMCompare({ llm, answer, decisionMs }: { llm: LLMAnswer; answer: Answer; decisionMs?: number }) {
  if (llm.error) return <div className="llm-row faint small">对照大模型：{llm.error}</div>;
  const keys = Object.keys(answer.probabilities);
  const agree = llm.prediction === ranked(answer)[0][0];
  const llmTop = Math.max(...llm.probabilities);
  return (
    <div className="llm-row">
      <span className="llm-dot" />
      <span className="mono small">{llm.model}</span>
      <span className="small">
        选择 <b className="mono">{llm.prediction}</b>（{pct(llmTop)}）
      </span>
      {agree ? <Badge kind="ok">一致</Badge> : <Badge kind="warn">不一致</Badge>}
      <span className="grow" />
      <span className="faint tiny num">
        {ms(llm.latency_ms)}
        {decisionMs ? ` · 决策模型 ${ms(decisionMs)}` : ""}
      </span>
      {llm.method === "text" && keys.length > 0 && <Badge>无 logprobs</Badge>}
    </div>
  );
}

/** 一个问题的完整结果卡片内容。 */
export function AnswerView({
  answer,
  question,
  llm,
  decisionMs,
  compact,
}: {
  answer: Answer;
  question: Question;
  llm?: LLMAnswer | null;
  decisionMs?: number;
  compact?: boolean;
}) {
  const options = optionsOf(question);
  let main: ReactNode;
  if (answer.type === "noul") {
    main = <NoulMeter p={answer.noul ?? answer.probabilities.true} labels={[options[0][1], options[1][1]]} />;
  } else if (answer.type === "score") {
    const levels = options.map(([, v]) => v);
    main = (
      <div className="score-view">
        <div className="score-gauge">
          <Gauge value={answer.score ?? 0} levels={levels} width={compact ? 220 : 250} />
          <div className="score-num">
            <b className="num">{(answer.score ?? 0).toFixed(2)}</b>
            <span className="faint">/ {levels.length - 1}</span>
          </div>
          <div className="faint tiny">期望等级（概率加权）</div>
        </div>
        <div className="grow">
          <ProbBars answer={answer} question={question} llm={llm} />
        </div>
      </div>
    );
  } else {
    main = <ProbBars answer={answer} question={question} llm={llm} limit={compact ? 4 : undefined} />;
  }
  return (
    <div className="answer">
      <div className={`answer-main ${compact ? "compact" : ""}`}>
        <div className="grow">{main}</div>
        {!compact && <ConfidenceStats answer={answer} />}
      </div>
      {llm && <LLMCompare llm={llm} answer={answer} decisionMs={decisionMs} />}
    </div>
  );
}

// ======================================================================= 编辑器

export function KindPicker({ value, onChange }: { value: Kind; onChange: (k: Kind) => void }) {
  return (
    <Segmented
      size="sm"
      value={value}
      onChange={onChange}
      options={(["noul", "choice", "score"] as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
    />
  );
}

export function QuestionEditor({
  name,
  question,
  error,
  onRename,
  onChange,
  onRemove,
  index,
}: {
  name: string;
  question: Question;
  error?: string | null;
  onRename: (name: string) => void;
  onChange: (q: Question) => void;
  onRemove?: () => void;
  index: number;
}) {
  const setType = (type: Kind) => {
    if (type === question.type) return;
    const current = optionsOf(question).map(([, v]) => v).filter((v) => v && v !== "否" && v !== "是");
    if (type === "choice") {
      const descs = current.length >= 2 ? current : ["", ""];
      onChange({ type, instructions: question.instructions, criteria: Object.fromEntries(descs.map((d, i) => [`option_${String.fromCharCode(97 + i)}`, d])) });
    } else if (type === "score") {
      onChange({ type, instructions: question.instructions, criteria: current.length >= 2 ? current : ["低", "中", "高"] });
    } else {
      onChange({ type, instructions: question.instructions });
    }
  };

  const choice = (question.criteria as Record<string, string>) ?? {};
  const levels = (question.criteria as string[]) ?? [];
  const noul = (question.criteria as { false?: string; true?: string }) ?? {};

  const setChoice = (entries: [string, string][]) => onChange({ ...question, criteria: Object.fromEntries(entries) });
  const entries = Object.entries(choice);

  return (
    <div className={`qedit ${error ? "invalid" : ""}`}>
      <div className="qedit-head">
        <span className={`qedit-index ${question.type}`}>{index + 1}</span>
        <input
          className="input sm mono qedit-name"
          value={name}
          spellCheck={false}
          onChange={(e) => onRename(e.target.value.replace(/[^\w-]/g, "_"))}
          title="问题名（响应里的键）"
        />
        <KindPicker value={question.type} onChange={setType} />
        <span className="grow" />
        <Tip text={KIND_HINT[question.type]} right>
          <CircleHelp size={15} className="faint" />
        </Tip>
        {onRemove && (
          <button className="btn ghost sm icon" onClick={onRemove} aria-label="删除问题">
            <Trash2 />
          </button>
        )}
      </div>
      <textarea
        className="textarea qedit-instr"
        rows={1}
        placeholder={question.type === "noul" ? "例：客户是否表达了紧迫性？" : question.type === "score" ? "例：客户有多不满？" : "例：应该由哪个部门处理？"}
        value={question.instructions}
        onChange={(e) => onChange({ ...question, instructions: e.target.value })}
      />
      {question.type === "choice" && (
        <div className="crit">
          {entries.map(([k, v], i) => (
            <div className="crit-row" key={i}>
              <span className="letter">{LETTERS[i]}</span>
              <input
                className="input sm mono crit-key"
                value={k}
                spellCheck={false}
                placeholder="键"
                onChange={(e) => setChoice(entries.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))}
              />
              <input
                className="input sm grow"
                value={v}
                placeholder="描述：这个选项代表什么"
                onChange={(e) => setChoice(entries.map((x, j) => (j === i ? [x[0], e.target.value] : x)))}
              />
              <div className="crit-tools">
                <button className="btn ghost sm icon" disabled={i === 0} onClick={() => setChoice(swap(entries, i, i - 1))} aria-label="上移">
                  <ArrowUp />
                </button>
                <button className="btn ghost sm icon" disabled={i === entries.length - 1} onClick={() => setChoice(swap(entries, i, i + 1))} aria-label="下移">
                  <ArrowDown />
                </button>
                <button className="btn ghost sm icon" disabled={entries.length <= 2} onClick={() => setChoice(entries.filter((_, j) => j !== i))} aria-label="删除选项">
                  <Trash2 />
                </button>
              </div>
            </div>
          ))}
          {entries.length < 26 && (
            <button className="crit-add" onClick={() => setChoice([...entries, [`option_${String.fromCharCode(97 + entries.length)}`, ""]])}>
              <Plus size={14} /> 添加选项
            </button>
          )}
        </div>
      )}
      {question.type === "score" && (
        <div className="crit">
          {levels.map((v, i) => (
            <div className="crit-row" key={i}>
              <span className="level-idx num">{i}</span>
              <input
                className="input sm grow"
                value={v}
                placeholder={`等级 ${i} 的描述`}
                onChange={(e) => onChange({ ...question, criteria: levels.map((x, j) => (j === i ? e.target.value : x)) })}
              />
              <div className="crit-tools">
                <button className="btn ghost sm icon" disabled={i === 0} onClick={() => onChange({ ...question, criteria: swap(levels, i, i - 1) })} aria-label="上移">
                  <ArrowUp />
                </button>
                <button className="btn ghost sm icon" disabled={i === levels.length - 1} onClick={() => onChange({ ...question, criteria: swap(levels, i, i + 1) })} aria-label="下移">
                  <ArrowDown />
                </button>
                <button className="btn ghost sm icon" disabled={levels.length <= 2} onClick={() => onChange({ ...question, criteria: levels.filter((_, j) => j !== i) })} aria-label="删除等级">
                  <Trash2 />
                </button>
              </div>
            </div>
          ))}
          <div className="row between">
            {levels.length < 26 && (
              <button className="crit-add" onClick={() => onChange({ ...question, criteria: [...levels, ""] })}>
                <Plus size={14} /> 添加等级
              </button>
            )}
            <span className="faint tiny">等级从低到高排列，结果返回概率加权的期望等级</span>
          </div>
        </div>
      )}
      {question.type === "noul" && (
        <div className="crit noul-crit">
          <div className="crit-row">
            <span className="letter">A</span>
            <span className="mono tiny faint" style={{ width: 38 }}>false</span>
            <input
              className="input sm grow"
              value={noul.false ?? ""}
              placeholder="否（可选：说明“否”的含义）"
              onChange={(e) => onChange({ ...question, criteria: { ...noul, false: e.target.value || undefined } })}
            />
          </div>
          <div className="crit-row">
            <span className="letter">B</span>
            <span className="mono tiny faint" style={{ width: 38 }}>true</span>
            <input
              className="input sm grow"
              value={noul.true ?? ""}
              placeholder="是（可选：说明“是”的含义）"
              onChange={(e) => onChange({ ...question, criteria: { ...noul, true: e.target.value || undefined } })}
            />
          </div>
        </div>
      )}
      {error && <div className="qedit-error">{error}</div>}
    </div>
  );
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function StateEditor({
  value,
  json,
  onChange,
  onToggleJson,
  error,
  rows = 6,
  tokens,
}: {
  value: string;
  json: boolean;
  onChange: (v: string) => void;
  onToggleJson: (v: boolean) => void;
  error?: string | null;
  rows?: number;
  tokens?: number | null;
}) {
  return (
    <div className="state-editor">
      <div className="row between">
        <label className="label">
          上下文 state <span className="hint">模型判断所依据的材料，可以是文本或 JSON</span>
        </label>
        <Segmented
          size="sm"
          value={json ? "json" : "text"}
          onChange={(v) => onToggleJson(v === "json")}
          options={[
            { value: "text", label: "文本", icon: <Type /> },
            { value: "json", label: "JSON", icon: <Braces /> },
          ]}
        />
      </div>
      <textarea
        className={`textarea ${json ? "mono" : ""} ${error ? "invalid" : ""}`}
        style={json ? { fontFamily: "var(--mono)", fontSize: 12.5 } : undefined}
        rows={rows}
        spellCheck={!json}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={json ? '{"材料": "...", "问题": "..."}' : "粘贴一段客户留言、评论、对话、文档片段……"}
      />
      <div className="row between tiny faint">
        <span className={error ? "bad" : ""}>{error ?? `${value.length} 字符`}</span>
        {tokens ? <span className="num">约 {tokens} tokens（含提示词模板）</span> : null}
      </div>
    </div>
  );
}

// ======================================================================= 证据热力文本

export function EvidenceText({
  segments,
  structured,
}: {
  segments: { text: string; delta: number; flipped: boolean }[];
  structured?: boolean;
}) {
  const maxAbs = Math.max(...segments.map((s) => Math.abs(s.delta)), 0.02);
  return (
    <div className={`evidence ${structured ? "structured" : ""}`}>
      {segments.map((s, i) => {
        const t = Math.abs(s.delta) / maxAbs;
        const color = s.delta >= 0 ? `rgba(52, 211, 153, ${0.08 + t * 0.5})` : `rgba(251, 113, 133, ${0.08 + t * 0.5})`;
        return (
          <Tip key={i} text={`删掉这一段：目标值 ${s.delta >= 0 ? "下降" : "上升"} ${(Math.abs(s.delta) * 100).toFixed(1)} 个百分点${s.flipped ? "，并且判断会改变" : ""}`}>
            <span className={`ev-seg ${s.flipped ? "flip" : ""}`} style={{ background: Math.abs(s.delta) < 0.005 ? undefined : color }}>
              {s.text}
            </span>
          </Tip>
        );
      })}
    </div>
  );
}
