import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleX,
  FlaskConical,
  Gauge,
  Grid3x3,
  ListFilter,
  RotateCcw,
  ShieldCheck,
  Square,
  Tags,
  Thermometer,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, streamSSE } from "../api";
import { BarList, ConfusionMatrix, LineChart, ReliabilityDiagram, StackHistogram } from "../components/charts";
import { Badge, Button, Card, Empty, KindBadge, Modal, Progress, Segmented, Skeleton, Slider, Stat, Tabs, Toggle } from "../components/ui";
import { AnswerView } from "../components/decision";
import { useApp } from "../hooks/useApp";
import { useAsync } from "../hooks/useAsync";
import { KIND_LABEL, optionsOf } from "../lib/decision";
import { duration, ms, pct, stateText, timeAgo } from "../lib/format";
import { handoff } from "../lib/presets";
import { Link, navigate, useTitle } from "../router";
import type { Answer, Kind, RunMetrics, RunResultItem } from "../types";
import { StatusBadge } from "./Eval";

interface ProgressEvent {
  status?: string;
  phase?: string;
  done: number;
  total: number;
  correct?: number;
  hard?: number;
  errors?: number;
  elapsed_ms?: number;
}

function toAnswer(r: RunResultItem): Answer | null {
  if (!r.probabilities.length || !r.question_body) return null;
  const probabilities = Object.fromEntries(r.keys.map((k, i) => [k, r.probabilities[i]]));
  const best = r.probabilities.indexOf(Math.max(...r.probabilities));
  const a: Answer = { type: r.kind, probabilities, confidence: r.confidence, logits: Object.fromEntries(r.keys.map((k, i) => [k, r.logits[i]])) };
  if (r.kind === "noul") a.noul = probabilities.true;
  if (r.kind === "choice") a.choice = r.keys[best];
  if (r.kind === "score") a.score = r.probabilities.reduce((s, p, i) => s + i * p, 0);
  return a;
}

function MiniDist({ r }: { r: RunResultItem }) {
  const opts = r.question_body ? Object.fromEntries(optionsOf(r.question_body)) : {};
  const gold = r.keys[r.target.indexOf(Math.max(...r.target))];
  const rows = r.keys.map((k, i) => ({ k, p: r.probabilities[i] })).sort((a, b) => b.p - a.p).slice(0, 4);
  return (
    <div className="mini-dist">
      {rows.map(({ k, p }) => (
        <div key={k} className={`mini-dist-row ${k === r.prediction ? "pred" : ""} ${k === gold ? "gold" : ""}`} title={opts[k]}>
          <span className="ellipsis">{r.kind === "score" ? opts[k] : r.kind === "noul" ? (k === "true" ? "是" : "否") : k}</span>
          <div className="bar">
            <i style={{ width: `${p * 100}%` }} />
          </div>
          <span className="mono num">{(p * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

function Results({ runId, metrics, hasLLM }: { runId: number; metrics: RunMetrics; hasLLM: boolean }) {
  const [filter, setFilter] = useState("wrong");
  const [kind, setKind] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("-confidence");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<RunResultItem | null>(null);
  const data = useAsync(() => api.runResults(runId, { filter, kind, tag, sort, page, size: 15 }), [runId, filter, kind, tag, sort, page]);
  const tags = Object.keys(metrics.by_tag ?? {});
  const answer = detail ? toAnswer(detail) : null;
  return (
    <Card title="逐题结果" icon={<ListFilter />} sub="默认显示“高置信度却答错”的题——它们最危险，也最值得看">
      <div className="col" style={{ gap: 12 }}>
        <Tabs
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          tabs={[
            { value: "wrong", label: "答错" },
            { value: "uncertain", label: "低置信（p < 60%）" },
            { value: "correct", label: "答对" },
            { value: "all", label: "全部" },
            ...(hasLLM ? [{ value: "disagree", label: "与大模型不一致" }] : []),
            { value: "errors", label: "出错" },
          ]}
        />
        <div className="row wrap" style={{ gap: 8 }}>
          <Segmented
            size="sm"
            value={kind}
            onChange={(v) => {
              setKind(v);
              setPage(1);
            }}
            options={[{ value: "", label: "全部题型" }, ...(["noul", "choice", "score"] as Kind[]).filter((k) => metrics.by_kind[k]).map((k) => ({ value: k, label: KIND_LABEL[k] }))]}
          />
          {tags.length > 1 && (
            <select className="select" style={{ width: 180, height: 32 }} value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">全部标签</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <span className="grow" />
          <Segmented
            size="sm"
            value={sort}
            onChange={setSort}
            options={[
              { value: "-confidence", label: "置信度高→低" },
              { value: "confidence", label: "低→高" },
              { value: "id", label: "原顺序" },
            ]}
          />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>上下文与问题</th>
                <th>模型分布（紫 = 预测，绿字 = 标准答案）</th>
                <th className="r">p_max</th>
                {hasLLM && <th>大模型</th>}
                <th>标签</th>
              </tr>
            </thead>
            <tbody>
              {data.data?.items.map((r) => (
                <tr key={r.id} className="click result-row" onClick={() => setDetail(r)}>
                  <td>{r.error ? <Badge kind="bad">出错</Badge> : r.correct === null ? <Badge>软标签</Badge> : r.correct ? <CheckCircle2 size={18} color="var(--ok)" /> : <CircleX size={18} color="var(--bad)" />}</td>
                  <td>
                    <div className="result-state">{stateText(r.state, 200)}</div>
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      <KindBadge kind={r.kind} />
                      <span className="tiny muted">{r.question_body?.instructions}</span>
                    </div>
                    {r.error && <div className="tiny bad">{r.error}</div>}
                  </td>
                  <td>{!r.error && <MiniDist r={r} />}</td>
                  <td className="r mono">{pct(r.p_max, 0)}</td>
                  {hasLLM && (
                    <td className="mono tiny">
                      {r.llm ? (
                        <span className={r.llm.prediction === r.prediction ? "" : "warn"}>
                          {r.llm.prediction} · {pct(Math.max(...r.llm.probabilities), 0)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  <td>{r.tag && <span className="src-tag">{r.tag}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.data && data.data.items.length === 0 && <div className="faint small" style={{ padding: 20, textAlign: "center" }}>没有符合条件的结果</div>}
        </div>
        {data.data && data.data.total > 15 && (
          <div className="pager">
            <span className="num">
              {data.data.total} 条 · 第 {page} / {Math.ceil(data.data.total / 15)} 页
            </span>
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <Button size="sm" disabled={page * 15 >= data.data.total} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        )}
      </div>
      <Modal
        open={!!detail}
        title={detail ? `${detail.question} · ${detail.correct ? "答对" : detail.correct === false ? "答错" : "软标签"}` : ""}
        onClose={() => setDetail(null)}
        wide
        actions={
          detail?.question_body && detail.state !== null ? (
            <Button
              size="sm"
              icon={<FlaskConical />}
              onClick={() => {
                handoff({ state: detail.state!, questions: { [detail.question]: detail.question_body! } });
                navigate("/playground");
              }}
            >
              在实验台打开
            </Button>
          ) : undefined
        }
      >
        {detail && (
          <div className="col" style={{ gap: 16 }}>
            <div className="inset" style={{ padding: 14, whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.75, maxHeight: 260, overflow: "auto" }}>
              {typeof detail.state === "string" ? detail.state : JSON.stringify(detail.state, null, 2)}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <KindBadge kind={detail.kind} />
              <b>{detail.question_body?.instructions}</b>
              <span className="grow" />
              <span className="small">
                标准答案：
                <b className="ok mono">{detail.keys[detail.target.indexOf(Math.max(...detail.target))]}</b>
              </span>
            </div>
            {answer && detail.question_body && <AnswerView answer={answer} question={detail.question_body} llm={detail.llm} />}
          </div>
        )}
      </Modal>
    </Card>
  );
}

export default function RunPage({ id }: { id: number }) {
  const { toast } = useApp();
  const run = useAsync(() => api.run(id), [id]);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [threshold, setThreshold] = useState(0.8);
  const [showCal, setShowCal] = useState(false);
  useTitle(run.data ? `${run.data.suite_name} · 评测报告` : "评测报告");

  const live = run.data && (run.data.status === "running" || run.data.status === "queued");
  useEffect(() => {
    if (!live) return;
    const ctrl = new AbortController();
    streamSSE<ProgressEvent & { type: string }>(
      `/api/runs/${id}/events`,
      undefined,
      (ev) => {
        if (ev.type === "progress") setProgress(ev);
        if (ev.type === "done") run.reload();
      },
      ctrl.signal,
    ).catch(() => undefined);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, live]);

  const r = run.data;
  const m = r && "overall" in (r.metrics ?? {}) ? (r.metrics as RunMetrics) : null;
  const point = useMemo(() => {
    if (!m?.selective.length) return null;
    return m.selective.reduce((best, p) => (Math.abs(p.threshold - threshold) < Math.abs(best.threshold - threshold) ? p : best));
  }, [m, threshold]);

  if (run.error) return <Empty icon={<Activity />} title="运行不存在" />;
  if (!r)
    return (
      <div className="page col" style={{ gap: 16 }}>
        <Skeleton h={80} />
        <Skeleton h={300} />
      </div>
    );

  const rerun = async () => {
    if (!r.suite_id) return;
    const next = await api.createRun({ suite_id: r.suite_id, temperature: r.config?.temperature ?? 1, compare_llm: !!r.config?.compare_llm, limit: r.config?.limit });
    navigate(`/eval/runs/${next.id}`);
  };
  const remove = async () => {
    if (!window.confirm("删除这次评测运行及其全部结果？")) return;
    await api.deleteRun(r.id);
    navigate("/eval");
  };

  const hardN = m?.overall.hard_n ?? 0;
  const llm = m?.llm;

  return (
    <div className="page">
      <div className="scn-head">
        <Link to={r.suite_id ? `/eval/suites/${r.suite_id}` : "/eval"} className="btn ghost sm">
          <ArrowLeft /> {r.suite_name}
        </Link>
        <div className="scn-head-main">
          <div className="grow">
            <div className="row" style={{ gap: 10 }}>
              <h1 className="page-title">评测报告 #{r.id}</h1>
              <StatusBadge run={{ ...r, done: progress?.done ?? r.done, total: progress?.total ?? r.total }} />
            </div>
            <p className="page-desc">
              {r.suite_name} · step {r.model?.step ?? "—"} · T = {r.config?.temperature?.toFixed(2)} · {r.model?.prompt_version ?? "hmm-zh-v1"} ·{" "}
              {timeAgo(r.created_at)}
              {r.duration_ms ? ` · 用时 ${duration(r.duration_ms / 1000)}` : ""}
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {live ? (
              <Button
                icon={<Square />}
                onClick={async () => {
                  await api.cancelRun(r.id);
                  toast("已请求取消", "info");
                }}
              >
                取消
              </Button>
            ) : (
              <>
                <Button variant="ghost" className="danger" icon={<Trash2 />} onClick={remove}>
                  删除
                </Button>
                <Button icon={<RotateCcw />} onClick={rerun}>
                  再跑一次
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {live && (
        <Card className="run-progress" bodyClass="card-body">
          <div className="row between">
            <b>{progress?.phase === "llm" ? "对照大模型作答中…" : "决策模型评测中…"}</b>
            <span className="mono num">
              {progress?.done ?? 0} / {progress?.total ?? r.total}
            </span>
          </div>
          <Progress value={progress?.total ? progress.done / progress.total : 0} indeterminate={!progress} />
          <div className="row" style={{ gap: 18 }}>
            {progress?.hard ? (
              <span className="small">
                当前准确率 <b className="num">{pct((progress.correct ?? 0) / progress.hard)}</b>
              </span>
            ) : null}
            {progress?.elapsed_ms ? (
              <span className="small faint">
                {ms(progress.elapsed_ms)} · {((progress.done / progress.elapsed_ms) * 1000).toFixed(0)} 决策/秒
              </span>
            ) : null}
          </div>
        </Card>
      )}

      {r.status === "failed" && <div className="card card-pad pg-error">运行失败：{r.error}</div>}

      {m && (
        <div className="col" style={{ gap: 18 }}>
          <div className="run-head stagger">
            <Stat accent label="准确率" icon={<CheckCircle2 />} value={pct(m.overall.accuracy)} foot={<>{hardN} 个硬标签决策</>} />
            <Stat label="ECE（15 箱）" icon={<Activity />} value={pct(m.overall.ece, 2)} foot={<>越低越好 · 置信度与准确率的差距</>} />
            <Stat label="NLL" icon={<Gauge />} value={m.overall.nll?.toFixed(3) ?? "—"} foot={<>分布交叉熵，含软标签</>} />
            <Stat label="Brier" icon={<Grid3x3 />} value={m.overall.brier?.toFixed(3) ?? "—"} foot={<>概率的均方误差</>} />
            <Stat
              label="吞吐"
              icon={<Activity />}
              value={m.throughput ? Math.round(m.throughput.decisions / m.throughput.seconds) : "—"}
              unit="决策/秒"
              foot={<>{m.throughput?.decisions} 个决策 · {duration(m.throughput?.seconds ?? 0)}</>}
            />
          </div>

          <div className="grid g2">
            <Card
              title="可靠性图"
              icon={<ShieldCheck />}
              sub="柱高 = 每个置信度区间的实际准确率；虚线 = 完美校准。红色缺口 = 过度自信，绿色 = 过度保守"
              actions={m.calibration && <Toggle on={showCal} onChange={setShowCal} label={<span className="tiny">叠加校准后</span>} />}
            >
              <ReliabilityDiagram bins={m.overall.reliability ?? []} after={showCal ? m.calibration?.reliability_after : undefined} height={300} />
            </Card>
            <div className="col" style={{ gap: 18 }}>
              <Card title="置信度分布" icon={<Activity />} sub="绿色答对，红色答错。理想情况下，错题都挤在左边（低置信）">
                <StackHistogram bins={m.histogram} />
              </Card>
              {m.calibration && (
                <Card title="温度校准诊断" icon={<Thermometer />} sub="在本次结果的 logits 上拟合使 NLL 最小的温度，只用于诊断">
                  <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
                    <div>
                      <div className="faint tiny">最优温度 T*</div>
                      <div className="train-pct num">{m.calibration.temperature.toFixed(2)}</div>
                      <div className="faint tiny" style={{ maxWidth: 180, marginTop: 6 }}>
                        {m.calibration.temperature > 1.1 ? "> 1：模型过度自信，需要把分布压平" : m.calibration.temperature < 0.9 ? "< 1：模型过度保守，可以更果断" : "≈ 1：已经校准得不错"}
                      </div>
                    </div>
                    <div className="cal-compare grow">
                      {(["ece", "nll", "brier"] as const).map((k) => (
                        <div key={k}>
                          {k.toUpperCase()}
                          <b>
                            {k === "ece" ? pct(m.calibration!.before[k], 2) : m.calibration!.before[k].toFixed(3)} <span className="arrow">→</span>{" "}
                            {k === "ece" ? pct(m.calibration!.after[k], 2) : m.calibration!.after[k].toFixed(3)}
                          </b>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>

          {m.selective.length > 0 && (
            <Card title="复核预算：自动执行多少、交给人多少" icon={<Gauge />} sub="只自动执行 p_max ≥ 阈值的决策，其余交给人工。阈值越高，自动部分越准，但覆盖越少">
              <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", alignItems: "start" }}>
                <div>
                  <LineChart
                    height={250}
                    yMin={0}
                    yMax={1}
                    yFormat={(v) => pct(v, 0)}
                    xFormat={(v) => `≥ ${pct(v, 0)}`}
                    xLabel="置信度阈值"
                    markerX={point?.threshold ?? null}
                    series={[
                      { name: "自动执行部分的准确率", color: "#a78bfa", points: m.selective.map((p) => ({ x: p.threshold, y: p.accuracy })) },
                      { name: "覆盖率（自动执行占比）", color: "#22d3ee", area: true, points: m.selective.map((p) => ({ x: p.threshold, y: p.coverage })) },
                    ]}
                  />
                </div>
                <div className="col" style={{ gap: 14 }}>
                  <div className="col" style={{ gap: 6 }}>
                    <div className="row between small">
                      <span>阈值</span>
                      <b className="mono">{pct(threshold, 0)}</b>
                    </div>
                    <Slider value={threshold} min={0} max={1} step={0.025} onChange={setThreshold} />
                  </div>
                  {point && (
                    <div className="threshold-readout" style={{ gridTemplateColumns: "1fr 1fr" }}>
                      <div>
                        自动执行
                        <b>{pct(point.coverage, 0)}</b>
                        <span className="faint">{point.kept} 条</span>
                      </div>
                      <div>
                        自动部分准确率
                        <b>{pct(point.accuracy)}</b>
                      </div>
                      <div>
                        交给人工
                        <b>{hardN - point.kept}</b>
                      </div>
                      <div>
                        漏网错误
                        <b className={point.errors_kept ? "bad" : "ok"}>{point.errors_kept}</b>
                      </div>
                    </div>
                  )}
                  <div className="budget">
                    {(["0.9", "0.95", "0.99"] as const).map((g) => {
                      const b = m.budgets[g];
                      return (
                        <div key={g}>
                          <span>要求 ≥ {pct(Number(g), 0)} 准确</span>
                          <b>{b ? pct(b.coverage, 0) : "—"}</b>
                          <span>{b ? `可自动 · 阈值 ${pct(b.threshold, 0)}` : "达不到"}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <div className="grid g2">
            <Card title="按题型" icon={<Grid3x3 />}>
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>题型</th>
                    <th className="r">决策</th>
                    <th className="r">准确率</th>
                    <th className="r">ECE</th>
                    <th className="r">NLL</th>
                    <th className="r">评分 MAE</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.entries(m.by_kind) as [Kind, (typeof m.by_kind)[Kind]][]).map(([k, v]) => (
                    <tr key={k}>
                      <td>
                        <KindBadge kind={k} />
                      </td>
                      <td className="r mono">{v?.n}</td>
                      <td className="r mono">{pct(v?.accuracy)}</td>
                      <td className="r mono">{pct(v?.ece, 2)}</td>
                      <td className="r mono">{v?.nll?.toFixed(3)}</td>
                      <td className="r mono">{v?.score_mae?.toFixed(3) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="按标签" icon={<Tags />} sub="用例 meta.tag：类别、来源或领域">
              {Object.keys(m.by_tag).length ? (
                <BarList
                  max={1}
                  items={Object.entries(m.by_tag)
                    .sort((a, b) => (b[1].accuracy ?? 0) - (a[1].accuracy ?? 0))
                    .map(([t, v]) => ({ label: t, value: v.accuracy, sub: `${v.n} 个决策 · ECE ${pct(v.ece, 1)}`, key: t }))}
                />
              ) : (
                <div className="faint small">用例没有标签</div>
              )}
            </Card>
          </div>

          {m.confusion.length > 0 && (
            <Card title="混淆矩阵" icon={<Grid3x3 />} sub="同一问题、同一组候选项的硬标签样本。对角线是答对的">
              <div className="grid g2">
                {m.confusion.map((c) => (
                  <div key={`${c.question}-${c.keys.join()}`}>
                    <div className="row between small" style={{ marginBottom: 8 }}>
                      <span className="mono">{c.question}</span>
                      <span className="faint">{c.n} 条</span>
                    </div>
                    <ConfusionMatrix keys={c.keys} matrix={c.matrix} labels={c.kind === "noul" ? { true: "是", false: "否" } : undefined} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {llm && (
            <Card title={`决策模型 vs ${llm.model}`} icon={<Bot />} sub={`同一批 ${llm.n} 道题，题面完全相同；大模型的概率来自第一个 token 的 logprobs`}>
              <div className="vs">
                <div className="vs-side">
                  <h4>
                    Chinese Decision 0.8B <Badge kind="brand">决策模型</Badge>
                  </h4>
                  <div className="threshold-readout" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 0 }}>
                    <div>
                      准确率<b>{pct(llm.decision.accuracy)}</b>
                    </div>
                    <div>
                      ECE<b>{pct(llm.decision.ece, 2)}</b>
                    </div>
                    <div>
                      NLL<b>{llm.decision.nll?.toFixed(3)}</b>
                    </div>
                    <div>
                      吞吐<b>{m.throughput ? Math.round(m.throughput.decisions / m.throughput.seconds) : "—"}/s</b>
                    </div>
                  </div>
                </div>
                <div className="vs-mid">VS</div>
                <div className="vs-side">
                  <h4>
                    {llm.model} <Badge kind="warn">生成式大模型</Badge>
                  </h4>
                  <div className="threshold-readout" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 0 }}>
                    <div>
                      准确率<b>{pct(llm.llm.accuracy)}</b>
                    </div>
                    <div>
                      ECE<b>{pct(llm.llm.ece, 2)}</b>
                    </div>
                    <div>
                      NLL<b>{llm.llm.nll?.toFixed(3)}</b>
                    </div>
                    <div>
                      延迟 p50<b>{ms(llm.llm_latency_p50_ms)}</b>
                    </div>
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 10, margin: "14px 0" }}>
                <Badge kind="info">结论一致率 {pct(llm.agreement)}</Badge>
                <span className="faint small">在“与大模型不一致”筛选里可以逐条看分歧。</span>
              </div>
              <div className="grid g2">
                <div>
                  <div className="lab-sub">决策模型 · 可靠性</div>
                  <ReliabilityDiagram bins={llm.decision.reliability ?? []} height={220} />
                </div>
                <div>
                  <div className="lab-sub">{llm.model} · 可靠性</div>
                  <ReliabilityDiagram bins={llm.llm.reliability ?? []} height={220} />
                </div>
              </div>
            </Card>
          )}

          <Results runId={r.id} metrics={m} hasLLM={!!llm} />
        </div>
      )}
    </div>
  );
}
