import { AlertTriangle, Briefcase, Crown, Play, SlidersHorizontal, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Radar } from "../../components/charts";
import { Badge, Button, Card, Segmented, Slider, Spinner } from "../../components/ui";
import { useApp } from "../../hooks/useApp";
import { ms, pct } from "../../lib/format";
import type { DecisionResponse, Question } from "../../types";
import { LatChip } from "./shared";

const JD =
  "高级后端工程师（技术负责人方向）：负责交易系统的架构设计与核心模块开发，带领 4–6 人小组；要求精通 Python 或 Go，有高并发分布式系统经验，能与产品、业务方高效沟通。";

// 每个维度是一个“简历里有没有这项证据”的是/否问题，而不是 4 档评分：
// 在真实模型上对比过，4 档 score 几乎全部落在“初步具备”，区分度很低；
// 字面化的证据问题（Jev 文档建议的写法）区分度高得多，也更容易解释。
const DIMS: { key: string; label: string; q: string }[] = [
  { key: "coding", label: "工程实现", q: "简历是否显示候选人目前仍在一线写代码，并且编程能力突出？" },
  { key: "design", label: "系统设计", q: "简历是否显示候选人设计或主导过高并发、分布式系统？" },
  { key: "leadership", label: "团队管理", q: "简历是否显示候选人有带领团队、管理下属的经验？" },
  { key: "business", label: "业务沟通", q: "简历是否显示候选人经常和业务方、产品或客户沟通协作？" },
  { key: "growth", label: "成长潜力", q: "简历是否体现出很强的学习能力或成长潜力（例如竞赛获奖、开源项目、快速成长）？" },
];
const QUESTIONS: Record<string, Question> = Object.fromEntries(DIMS.map((d) => [d.key, { type: "noul", instructions: d.q } as Question]));
const UNSURE = (p: number) => p > 0.35 && p < 0.65;

const CANDIDATES = [
  {
    name: "林一帆",
    title: "8 年 · 支付平台后端负责人",
    resume:
      "8 年后端经验。现任某支付公司交易平台后端负责人，带 6 人团队，主导了从单体到微服务的拆分，支撑双十一峰值 12 万 TPS。主力语言 Go，熟悉 Kafka、Redis、TiDB。曾负责与风控、清结算团队的方案对齐。",
  },
  {
    name: "苏晴",
    title: "4 年 · 算法竞赛背景的工程师",
    resume:
      "4 年经验，ACM 区域赛金牌。在某大厂做推荐系统的特征服务，Python/C++ 写得非常好，独立优化过在线服务 P99 延迟 40%。没有带团队经验，自述喜欢钻研技术，最近在自学分布式存储。",
  },
  {
    name: "周子豪",
    title: "10 年 · 技术经理",
    resume:
      "10 年经验，近 5 年转管理，目前是 20 人研发团队的经理，主要负责排期、招聘和与业务方沟通，最近三年很少写代码。早年做过 Java 电商后台。擅长跨部门协调，带出过多名骨干。",
  },
  {
    name: "何静",
    title: "6 年 · 全栈 + 业务分析",
    resume:
      "6 年经验，前 3 年做 B 端 SaaS 的全栈开发（Python/Django + React），后 3 年转为解决方案架构师，常驻客户现场梳理业务流程、写技术方案。系统设计主要是中小规模的业务系统，没有接触过高并发场景。",
  },
  {
    name: "唐骏",
    title: "2 年 · 应届转正",
    resume:
      "计算机硕士毕业 2 年，在一家创业公司做后端，用 Go 写过订单服务和对账脚本，参与过一次数据库迁移。学习速度快，业余维护一个 2k star 的开源工具库。目前还没有带过人。",
  },
];

const PRESETS: Record<string, { label: string; w: Record<string, number> }> = {
  ic: { label: "高级工程师", w: { coding: 0.35, design: 0.35, leadership: 0.05, business: 0.1, growth: 0.15 } },
  lead: { label: "技术负责人", w: { coding: 0.2, design: 0.3, leadership: 0.25, business: 0.15, growth: 0.1 } },
  manager: { label: "技术经理", w: { coding: 0.1, design: 0.15, leadership: 0.4, business: 0.25, growth: 0.1 } },
};

const ROW_H = 84;

export default function ResumeRanking() {
  const { toast } = useApp();
  const [results, setResults] = useState<DecisionResponse[] | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [preset, setPreset] = useState<string>("lead");
  const [weights, setWeights] = useState<Record<string, number>>(PRESETS.lead.w);
  const [selected, setSelected] = useState(0);

  const run = async () => {
    setLoading(true);
    try {
      const r = await api.batch(CANDIDATES.map((c) => ({ state: { 候选人简历: c.resume }, questions: QUESTIONS })));
      setResults(r.results.map((x) => ("answers" in x ? x : (null as unknown as DecisionResponse))));
      setLatency(r.latency_ms);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scored = useMemo(() => {
    if (!results) return [];
    const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    return CANDIDATES.map((c, i) => {
      const a = results[i]?.answers ?? {};
      const dims = Object.fromEntries(DIMS.map((d) => [d.key, a[d.key]?.noul ?? 0]));
      const composite = DIMS.reduce((s, d) => s + (weights[d.key] ?? 0) * dims[d.key], 0) / total;
      return { i, ...c, dims, composite };
    });
  }, [results, weights]);
  const ranking = [...scored].sort((a, b) => b.composite - a.composite);
  const rankOf = Object.fromEntries(ranking.map((r, k) => [r.i, k]));
  const sel = scored.find((s) => s.i === selected);
  const top = ranking[0];

  return (
    <div className="col" style={{ gap: 18 }}>
      <Card title="岗位要求" icon={<Briefcase />} actions={latency && <LatChip value={latency} label={`${CANDIDATES.length} 份简历 × 5 个证据问题`} />}>
        <div className="row" style={{ gap: 14 }}>
          <p className="grow small" style={{ lineHeight: 1.75 }}>
            {JD}
          </p>
          <Button icon={<Play />} loading={loading} onClick={run}>
            重新评分
          </Button>
        </div>
      </Card>
      <div className="rs">
        <Card title="权重（在代码里，不在模型里）" icon={<SlidersHorizontal />} sub="拖动滑块，排名实时重算——不需要再调用模型">
          <div className="weights">
            <Segmented
              value={preset}
              onChange={(v) => {
                setPreset(v);
                setWeights(PRESETS[v].w);
              }}
              options={Object.entries(PRESETS).map(([k, v]) => ({ value: k, label: v.label }))}
            />
            {DIMS.map((d) => (
              <div key={d.key} className="weight-row col" style={{ gap: 6 }}>
                <div className="row between">
                  <span>{d.label}</span>
                  <span className="mono num">{pct((weights[d.key] ?? 0) / (Object.values(weights).reduce((a, b) => a + b, 0) || 1), 0)}</span>
                </div>
                <Slider
                  value={weights[d.key] ?? 0}
                  min={0}
                  max={0.5}
                  step={0.01}
                  onChange={(v) => {
                    setPreset("custom");
                    setWeights((w) => ({ ...w, [d.key]: v }));
                  }}
                />
              </div>
            ))}
            <div className="divider" />
            {sel && (
              <div className="col" style={{ alignItems: "center", gap: 8 }}>
                <Radar
                  axes={DIMS.map((d) => d.label)}
                  size={270}
                  series={[
                    ...(top && top.i !== sel.i ? [{ name: top.name, color: "#64748b", values: DIMS.map((d) => top.dims[d.key]) }] : []),
                    { name: sel.name, color: "#f59e0b", values: DIMS.map((d) => sel.dims[d.key]) },
                  ]}
                />
                <div className="legend">
                  <span className="on">
                    <i style={{ background: "#f59e0b" }} />
                    {sel.name}
                  </span>
                  {top && top.i !== sel.i && (
                    <span>
                      <i style={{ background: "#64748b" }} />
                      第一名 {top.name}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card title="候选人排名" icon={<Trophy />} sub="每个维度是一个“简历里有没有这项证据”的是/否问题，条长 = 概率；条纹表示概率在 35%–65% 之间，模型拿不准，建议面试时重点确认">
          {!results ? (
            <div className="row" style={{ justifyContent: "center", padding: 60 }}>
              <Spinner />
            </div>
          ) : (
            <>
              <div className="board" style={{ height: CANDIDATES.length * ROW_H }}>
                {scored.map((c) => (
                  <div
                    key={c.i}
                    className={`board-row ${selected === c.i ? "on" : ""}`}
                    style={{ transform: `translateY(${rankOf[c.i] * ROW_H}px)` }}
                    onClick={() => setSelected(c.i)}
                  >
                    <span className={`rank ${rankOf[c.i] === 0 ? "gold" : ""}`}>{rankOf[c.i] === 0 ? <Crown size={22} color="#f59e0b" /> : rankOf[c.i] + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <b>{c.name}</b>
                      <div className="faint tiny ellipsis">{c.title}</div>
                    </div>
                    <div className="dims">
                      {DIMS.map((d) => (
                        <div key={d.key} className={`dim ${UNSURE(c.dims[d.key]) ? "unsure" : ""}`} title={`${d.q}
概率 ${pct(c.dims[d.key], 0)}`}>
                          <span>{d.label}</span>
                          <div className="dim-bar">
                            <i style={{ width: `${c.dims[d.key] * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="composite num">{(c.composite * 100).toFixed(1)}</div>
                  </div>
                ))}
              </div>
              {sel && (
                <div className="inset" style={{ padding: 14, marginTop: 16 }}>
                  <div className="row between" style={{ marginBottom: 6 }}>
                    <b>{sel.name} 的简历</b>
                    {DIMS.filter((d) => UNSURE(sel.dims[d.key])).length > 0 && (
                      <Badge kind="warn" icon={<AlertTriangle />}>
                        面试确认：{DIMS.filter((d) => UNSURE(sel.dims[d.key])).map((d) => d.label).join("、")}
                      </Badge>
                    )}
                  </div>
                  <p className="small muted" style={{ lineHeight: 1.75 }}>
                    {sel.resume}
                  </p>
                </div>
              )}
              {latency && <div className="faint tiny" style={{ marginTop: 10 }}>模型调用 {ms(latency)}；之后调权重都是纯前端计算。</div>}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
