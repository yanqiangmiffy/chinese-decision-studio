import { AlertTriangle, ArrowLeftRight, CheckCircle2, Crown, Play, Scale, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Badge, Button, Card, Segmented } from "../../components/ui";
import { useApp } from "../../hooks/useApp";
import { pct } from "../../lib/format";
import type { Answer, Question } from "../../types";
import { LatChip } from "./shared";

const PREFER: Question = {
  type: "choice",
  instructions: "对于用户的问题，哪个回答更好（更准确、更有帮助）？",
  criteria: { first: "回答一更好", second: "回答二更好", tie: "两者差不多" },
};
const HELPFUL: Question = { type: "score", instructions: "这个回答对用户有多大帮助？", criteria: ["很差", "较差", "一般", "较好", "很好"] };
const FACT: Question = { type: "noul", instructions: "这个回答中是否存在明显的事实错误？" };

const PAIRS = [
  {
    label: "常识问答",
    q: "为什么天空是蓝色的？",
    a: "因为大气中的分子对太阳光发生瑞利散射，波长越短散射越强，蓝光波长较短，被散射到天空各个方向，所以我们看到的天空是蓝色的。日落时光线穿过的大气更厚，蓝光被散射掉，所以天空呈现橙红色。",
    b: "因为天空反射了海洋的颜色。海洋占地球表面的 70%，所以天空看起来是蓝色的。",
  },
  {
    label: "编程建议",
    q: "Python 里怎么高效地拼接大量字符串？",
    a: "用 + 号一个个拼就行，Python 会自动优化。",
    b: "推荐把片段放进列表，最后用 ''.join(parts) 一次性拼接。因为字符串不可变，循环里用 + 会反复创建新对象，复杂度接近 O(n²)；join 只分配一次内存。少量拼接用 f-string 更易读。",
  },
  {
    label: "两个都不错",
    q: "周末带三岁的孩子去哪玩比较好？",
    a: "可以去城市公园或植物园，孩子能跑能跳，还能认识花草；记得带上水、零食和备用衣服。",
    b: "推荐亲子农场或者科技馆的儿童区，互动项目多，下雨天也能玩；出发前看一下是否需要预约。",
  },
];

interface Verdict {
  forward: Answer;
  backward: Answer;
  helpA: Answer;
  helpB: Answer;
  factA: Answer;
  factB: Answer;
  latency: number;
}

/** 把"交换顺序"那一次的结果映射回 A / B。 */
function prefer(v: Verdict) {
  const f = v.forward.probabilities;
  const b = v.backward.probabilities;
  const forward = { A: f.first, B: f.second, tie: f.tie };
  const backward = { A: b.second, B: b.first, tie: b.tie };
  const avg = { A: (forward.A + backward.A) / 2, B: (forward.B + backward.B) / 2, tie: (forward.tie + backward.tie) / 2 };
  const top = (o: Record<string, number>) => Object.entries(o).sort((x, y) => y[1] - x[1])[0][0];
  return { forward, backward, avg, consistent: top(forward) === top(backward), winner: top(avg) };
}

function Stars({ value }: { value: number }) {
  return (
    <span className="stars">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} fill={value >= i + 0.5 ? "#fbbf24" : "none"} color={value >= i + 0.5 ? "#fbbf24" : "var(--text-4)"} />
      ))}
    </span>
  );
}

export default function LLMJudge() {
  const { toast } = useApp();
  const [pi, setPi] = useState(0);
  const [q, setQ] = useState(PAIRS[0].q);
  const [a, setA] = useState(PAIRS[0].a);
  const [b, setB] = useState(PAIRS[0].b);
  const [v, setV] = useState<Verdict | null>(null);
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  const run = async (qq = q, aa = a, bb = b) => {
    setLoading(true);
    try {
      const r = await api.batch([
        { state: { 用户问题: qq, 回答一: aa, 回答二: bb }, questions: { prefer: PREFER } },
        { state: { 用户问题: qq, 回答一: bb, 回答二: aa }, questions: { prefer: PREFER } },
        { state: { 用户问题: qq, 回答: aa }, questions: { helpful: HELPFUL, fact: FACT } },
        { state: { 用户问题: qq, 回答: bb }, questions: { helpful: HELPFUL, fact: FACT } },
      ]);
      const res = r.results.map((x) => ("answers" in x ? x.answers : null));
      if (res.some((x) => !x)) throw new Error("请求不合法");
      setV({
        forward: res[0]!.prefer,
        backward: res[1]!.prefer,
        helpA: res[2]!.helpful,
        factA: res[2]!.fact,
        helpB: res[3]!.helpful,
        factB: res[3]!.fact,
        latency: r.latency_ms,
      });
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const p = v ? prefer(v) : null;

  // 普通函数而不是组件：避免每次渲染都重新挂载 textarea 导致输入框失焦
  const answerCard = (side: "A" | "B", text: string, onChange: (s: string) => void) => {
    const help = v ? (side === "A" ? v.helpA : v.helpB) : null;
    const fact = v ? (side === "A" ? v.factA : v.factB) : null;
    const win = p && p.winner === side;
    return (
      <div className={`jd-answer ${win ? "win" : ""}`}>
        {win && (
          <span className="jd-crown">
            <Crown /> 胜出 · {pct(p.avg[side], 0)}
          </span>
        )}
        <div className="jd-label">回答 {side}</div>
        <textarea className="textarea jd-text" rows={6} value={text} onChange={(e) => onChange(e.target.value)} />
        {help && fact && (
          <div className="row wrap" style={{ gap: 14, marginTop: 12 }}>
            <div className="row" style={{ gap: 8 }}>
              <Stars value={(help.score ?? 0) + 1} />
              <span className="mono small">{((help.score ?? 0) + 1).toFixed(2)} / 5</span>
            </div>
            {(fact.noul ?? 0) > 0.5 ? (
              <Badge kind="bad" icon={<AlertTriangle />}>
                疑似事实错误 {pct(fact.noul, 0)}
              </Badge>
            ) : (
              <Badge kind="ok" icon={<CheckCircle2 />}>
                未发现事实错误
              </Badge>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      <Card
        title="待评估的问题"
        icon={<Scale />}
        actions={
          <>
            {v && <LatChip value={v.latency} label="4 个请求 · 6 个决策" />}
            <Button variant="primary" icon={<Play />} loading={loading} onClick={() => run()}>
              评判
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          <Segmented
            value={String(pi)}
            onChange={(x) => {
              const i = Number(x);
              setPi(i);
              setQ(PAIRS[i].q);
              setA(PAIRS[i].a);
              setB(PAIRS[i].b);
              run(PAIRS[i].q, PAIRS[i].a, PAIRS[i].b);
            }}
            options={PAIRS.map((x, i) => ({ value: String(i), label: x.label }))}
          />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      <div className="jd-pair">
        {answerCard("A", a, setA)}
        {answerCard("B", b, setB)}
      </div>

      {p && (
        <Card title="位置偏差检查" icon={<ArrowLeftRight />} sub="同一对回答按“A 在前”和“B 在前”各问一次。两次结论一致才自动采信，否则交给人工。">
          <div className="grid g3">
            {(
              [
                ["A 在前", p.forward],
                ["B 在前（映射回 A / B）", p.backward],
                ["两次平均", p.avg],
              ] as const
            ).map(([label, o]) => (
              <div key={label} className="tile">
                <div className="tile-name">{label}</div>
                {(["A", "B", "tie"] as const).map((k) => (
                  <div key={k} className="mini-prob">
                    <span>{k === "tie" ? "差不多" : `回答 ${k} 更好`}</span>
                    <span className="mono num">{pct(o[k], 1)}</span>
                    <div className="bar">
                      <i style={{ width: `${o[k] * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className={`verdict-banner ${p.consistent ? "pass" : "review"}`} style={{ marginTop: 14 }}>
            {p.consistent ? <CheckCircle2 /> : <AlertTriangle />}
            <div>
              <b>{p.consistent ? "交换顺序后结论一致" : "交换顺序后结论改变"}</b>
              <div>
                <span>
                  {p.consistent
                    ? `裁判结论：${p.winner === "tie" ? "两者差不多" : `回答 ${p.winner} 更好`}，可以自动采信。`
                    : "裁判存在位置偏差，这一对交给人工判断。"}
                </span>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
