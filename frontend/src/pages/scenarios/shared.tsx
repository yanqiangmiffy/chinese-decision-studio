import { Zap } from "lucide-react";
import type { ReactNode } from "react";
import { optionsOf, ranked } from "../../lib/decision";
import { ms, pct } from "../../lib/format";
import type { Answer, Question } from "../../types";

export function MiniProb({ label, p, right }: { label: ReactNode; p: number; right?: ReactNode }) {
  return (
    <div className="mini-prob">
      <span className="ellipsis">{label}</span>
      <span className="mono num">{right ?? pct(p, 0)}</span>
      <div className="bar">
        <i style={{ width: `${Math.max(0, Math.min(1, p)) * 100}%` }} />
      </div>
    </div>
  );
}

export function LatChip({ value, label }: { value: number | null | undefined; label?: string }) {
  return (
    <span className="lat-chip">
      <Zap />
      {label ? `${label} ` : ""}
      {ms(value)}
    </span>
  );
}

/** 一句话概括一个回答：choice → 胜出选项的描述，noul → 是/否 + 概率，score → 期望等级。 */
export function summarize(answer: Answer, question: Question): { text: string; p: number } {
  const options = Object.fromEntries(optionsOf(question));
  if (answer.type === "noul") {
    const p = answer.noul ?? answer.probabilities.true;
    return { text: p >= 0.5 ? "是" : "否", p };
  }
  if (answer.type === "score") {
    const levels = optionsOf(question);
    const s = answer.score ?? 0;
    return { text: `${levels[Math.round(s)]?.[1] ?? ""}（${s.toFixed(2)}）`, p: s / (levels.length - 1) };
  }
  const [k, p] = ranked(answer)[0];
  return { text: options[k] ?? k, p };
}

export const AVATAR_COLORS = ["#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#14b8a6", "#6366f1"];

export function Avatar({ name, i }: { name: string; i: number }) {
  return (
    <span className="avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
      {name.slice(0, 1)}
    </span>
  );
}
