import type { Answer, Kind, Question } from "../types";

// 与后端 / chinese-decision 的 options_for 保持一致的候选项展开。

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const KIND_LABEL: Record<Kind, string> = { noul: "是 / 否", choice: "单选", score: "评分" };
export const KIND_HINT: Record<Kind, string> = {
  noul: "判断一个命题为真的概率",
  choice: "从若干个命名选项里选一个",
  score: "在有序等级上打分，返回期望等级",
};

export function optionsOf(q: Question): [string, string][] {
  if (q.type === "choice") return Object.entries((q.criteria as Record<string, string>) ?? {});
  if (q.type === "score") return ((q.criteria as string[]) ?? []).map((v, i) => [String(i), v]);
  const c = (q.criteria as { false?: string; true?: string }) ?? {};
  return [
    ["false", c.false || "否"],
    ["true", c.true || "是"],
  ];
}

export function validateQuestion(q: Question): string | null {
  if (!q.instructions?.trim()) return "请填写问题";
  const options = optionsOf(q);
  if (q.type !== "noul") {
    if (options.length < 2) return "至少需要 2 个候选项";
    if (options.length > 26) return "最多 26 个候选项";
    if (q.type === "choice") {
      const keys = options.map(([k]) => k.trim());
      if (keys.some((k) => !k)) return "选项键不能为空";
      if (new Set(keys).size !== keys.length) return "选项键不能重复";
    }
    if (options.some(([, v]) => !String(v).trim())) return "候选项描述不能为空";
  }
  return null;
}

/** 用 logits 和温度重新算概率：softmax(z / T)。没有 logits 时用 log p 代替（数学上等价）。 */
export function rescale(answer: Answer, temperature: number): Answer {
  if (Math.abs(temperature - 1) < 1e-6) return answer;
  const keys = Object.keys(answer.probabilities);
  const z = keys.map((k) => (answer.logits ? answer.logits[k] : Math.log(Math.max(answer.probabilities[k], 1e-12))));
  const scaled = z.map((x) => x / temperature);
  const top = Math.max(...scaled);
  const exps = scaled.map((x) => Math.exp(x - top));
  const total = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / total);
  const probabilities = Object.fromEntries(keys.map((k, i) => [k, probs[i]]));
  const best = probs.indexOf(Math.max(...probs));
  const k = probs.length;
  const out: Answer = { ...answer, probabilities, confidence: (k * probs[best] - 1) / (k - 1) };
  if (answer.type === "noul") out.noul = probabilities.true;
  if (answer.type === "choice") out.choice = keys[best];
  if (answer.type === "score") out.score = probs.reduce((s, p, i) => s + i * p, 0);
  return out;
}

export function ranked(answer: Answer): [string, number][] {
  return Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
}

export function winner(answer: Answer): string {
  return ranked(answer)[0][0];
}

/** 归一化熵：0 = 完全确定，1 = 均匀分布。 */
export function entropy(answer: Answer): number {
  const ps = Object.values(answer.probabilities);
  const h = -ps.reduce((s, p) => s + (p > 0 ? p * Math.log(p) : 0), 0);
  return ps.length > 1 ? h / Math.log(ps.length) : 0;
}

export function margin(answer: Answer): number {
  const r = ranked(answer);
  return r.length > 1 ? r[0][1] - r[1][1] : r[0][1];
}

export type Verdict = "yes" | "no" | "unsure";
export function noulVerdict(p: number, lo = 0.3, hi = 0.7): Verdict {
  return p >= hi ? "yes" : p <= lo ? "no" : "unsure";
}

export function emptyQuestion(type: Kind = "choice"): Question {
  if (type === "choice") return { type, instructions: "", criteria: { option_a: "", option_b: "" } };
  if (type === "score") return { type, instructions: "", criteria: ["低", "中", "高"] };
  return { type, instructions: "" };
}

export function uniqueName(existing: string[], base = "q"): string {
  let i = existing.length + 1;
  while (existing.includes(`${base}${i}`)) i++;
  return `${base}${i}`;
}
