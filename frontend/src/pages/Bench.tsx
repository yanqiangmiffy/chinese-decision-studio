import { Gauge, History, Play, Square, Timer, Trash2, TrendingUp, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { api, streamSSE } from "../api";
import { LineChart } from "../components/charts";
import { Badge, Button, Card, CodeBlock, Empty, PageHead, Segmented, Slider } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { useAsync } from "../hooks/useAsync";
import { ms, timeAgo } from "../lib/format";
import { useTitle } from "../router";
import type { BenchTick } from "../types";

const SWEEP = [1, 2, 4, 8, 16, 32, 64];

export default function Bench() {
  useTitle("性能压测");
  const { toast } = useApp();
  const presets = useAsync(() => api.benchPresets(), []);
  const history = useAsync(() => api.benchHistory(), []);
  const [preset, setPreset] = useState("ticket");
  const [mode, setMode] = useState<"single" | "sweep">("single");
  const [concurrency, setConcurrency] = useState(16);
  const [total, setTotal] = useState(400);
  const [running, setRunning] = useState(false);
  const [ticks, setTicks] = useState<BenchTick[]>([]);
  const [levels, setLevels] = useState<BenchTick[]>([]);
  const [engine, setEngine] = useState<Record<string, number | null> | null>(null);
  const abort = useRef<AbortController | null>(null);

  const start = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    setTicks([]);
    setLevels([]);
    setEngine(null);
    try {
      await streamSSE<BenchTick & { type: string; engine?: Record<string, number | null>; message?: string }>(
        "/api/bench",
        { preset, concurrency, total: mode === "sweep" ? Math.min(total, 300) : total, sweep: mode === "sweep" ? SWEEP : null },
        (ev) => {
          if (ev.type === "tick") setTicks((t) => [...t, ev]);
          else if (ev.type === "level") setLevels((l) => [...l, ev]);
          else if (ev.type === "summary") setEngine(ev.engine ?? null);
          else if (ev.type === "error") toast(ev.message ?? "压测出错", "bad");
        },
        ctrl.signal,
      );
      history.reload();
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message, "bad");
    } finally {
      setRunning(false);
    }
  };

  const last = ticks[ticks.length - 1];
  const currentLevelTicks = last ? ticks.filter((t) => t.level === last.level) : [];
  const body = presets.data?.find((p) => p.id === preset)?.body;
  const questions = body ? Object.keys(body.questions).length : 1;
  const histogram = levels[levels.length - 1]?.histogram ?? [];
  const histMax = Math.max(1, ...histogram.map((h) => h.n));
  const firstBin = histogram.findIndex((h) => h.n > 0);
  const lastBin = histogram.length - 1 - [...histogram].reverse().findIndex((h) => h.n > 0);
  const shownHist = firstBin >= 0 ? histogram.slice(Math.max(0, firstBin - 1), lastBin + 2) : [];

  return (
    <div className="page">
      <PageHead
        eyebrow="LOAD TEST · 性能压测"
        icon={<Gauge />}
        title={
          <>
            并发越高，<span className="grad-text">批越大</span>
          </>
        }
        desc="决策服务带动态批处理：几毫秒内到达的并发请求会被合进同一个前向。这里从平台后端向决策服务施压，实时观察吞吐和延迟；并发扫描会依次跑 1→64 个并发，画出吞吐-延迟曲线。"
      />
      <div className="bench-grid">
        <Card title="压测配置" icon={<Zap />}>
          <div className="col" style={{ gap: 18 }}>
            <div className="field">
              <label className="label">请求体</label>
              <div className="col" style={{ gap: 6 }}>
                {presets.data?.map((p) => (
                  <button key={p.id} className={`chip ${preset === p.id ? "on" : ""}`} style={{ justifyContent: "space-between" }} onClick={() => setPreset(p.id)}>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="label">模式</label>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: "single", label: "固定并发" },
                  { value: "sweep", label: "并发扫描 1→64" },
                ]}
              />
            </div>
            {mode === "single" && (
              <div className="field">
                <div className="row between">
                  <label className="label">并发数</label>
                  <b className="mono">{concurrency}</b>
                </div>
                <Slider value={Math.log2(concurrency)} min={0} max={7} step={1} onChange={(v) => setConcurrency(Math.pow(2, v))} />
              </div>
            )}
            <div className="field">
              <div className="row between">
                <label className="label">{mode === "sweep" ? "每档请求数" : "总请求数"}</label>
                <b className="mono">{mode === "sweep" ? Math.min(total, 300) : total}</b>
              </div>
              <Slider value={total} min={50} max={2000} step={50} onChange={setTotal} />
              <div className="faint tiny">
                每个请求 {questions} 个问题 · 共约 {(mode === "sweep" ? Math.min(total, 300) * SWEEP.length : total) * questions} 次决策
              </div>
            </div>
            {running ? (
              <Button size="lg" icon={<Square />} onClick={() => abort.current?.abort()}>
                停止
              </Button>
            ) : (
              <Button variant="primary" size="lg" icon={<Play />} onClick={start}>
                开始压测
              </Button>
            )}
            <div className="faint tiny" style={{ lineHeight: 1.7 }}>
              提示：决策服务和其他服务共用一张 GPU，压测会短暂占满它的算力。延迟包含平台后端到 GPU 服务器的网络往返。
            </div>
            {body && <CodeBlock lang="json" code={JSON.stringify(body, null, 2)} maxHeight={220} />}
          </div>
        </Card>

        <div className="col" style={{ gap: 18, minWidth: 0 }}>
          {!last ? (
            <Card>
              <Empty icon={<Gauge />} title="还没有开始">
                选择请求体和并发，点击「开始压测」。图表会每 250 ms 刷新一次。
              </Empty>
            </Card>
          ) : (
            <>
              <div className="bench-big">
                <div className="big-num">
                  <span>并发</span>
                  <b>{last.concurrency}</b>
                </div>
                <div className="big-num">
                  <span>吞吐（最近 1 秒）</span>
                  <b>
                    {(last.rps_window * questions).toFixed(0)}
                    <small>决策/秒</small>
                  </b>
                </div>
                <div className="big-num">
                  <span>p50 延迟</span>
                  <b>{ms(last.p50)}</b>
                </div>
                <div className="big-num">
                  <span>p95 / p99</span>
                  <b style={{ fontSize: 19, whiteSpace: "nowrap" }}>
                    {ms(last.p95)} / {ms(last.p99)}
                  </b>
                </div>
                <div className="big-num">
                  <span>完成 / 错误</span>
                  <b>
                    {last.done}
                    <small className={last.errors ? "bad" : ""}>/ {last.errors}</small>
                  </b>
                </div>
              </div>
              <Card title="实时曲线" icon={<TrendingUp />} sub={`当前档位：并发 ${last.concurrency} · 已用 ${last.elapsed_s.toFixed(1)} s`}>
                <div className="grid g2">
                  <LineChart
                    height={220}
                    xFormat={(v) => `${v.toFixed(1)}s`}
                    yFormat={(v) => `${Math.round(v)}`}
                    series={[{ name: "吞吐（决策/秒）", color: "#a78bfa", area: true, points: currentLevelTicks.map((t) => ({ x: t.elapsed_s, y: t.rps_window * questions })) }]}
                  />
                  <LineChart
                    height={220}
                    xFormat={(v) => `${v.toFixed(1)}s`}
                    yFormat={(v) => ms(v)}
                    series={[
                      { name: "窗口 p50", color: "#22d3ee", points: currentLevelTicks.map((t) => ({ x: t.elapsed_s, y: t.window_p50 })) },
                      { name: "累计 p95", color: "#fb7185", dashed: true, points: currentLevelTicks.map((t) => ({ x: t.elapsed_s, y: t.p95 })) },
                    ]}
                  />
                </div>
              </Card>
              {levels.length > 1 && (
                <Card title="吞吐-延迟曲线" icon={<TrendingUp />} sub="横轴为并发数。吞吐随并发上升、延迟开始陡增的位置，就是服务的拐点">
                  <LineChart
                    height={250}
                    xFormat={(v) => `并发 ${Math.round(v)}`}
                    yFormat={(v) => `${Math.round(v)}`}
                    series={[
                      { name: "吞吐（决策/秒）", color: "#a78bfa", points: levels.map((l) => ({ x: l.concurrency, y: l.decisions_per_s })) },
                      { name: "p50 延迟（ms）", color: "#22d3ee", points: levels.map((l) => ({ x: l.concurrency, y: l.p50 })) },
                      { name: "p95 延迟（ms）", color: "#fb7185", dashed: true, points: levels.map((l) => ({ x: l.concurrency, y: l.p95 })) },
                    ]}
                  />
                  <div className="table-wrap" style={{ marginTop: 12 }}>
                    <table className="doc-table">
                      <thead>
                        <tr>
                          <th>并发</th>
                          <th className="r">决策/秒</th>
                          <th className="r">p50</th>
                          <th className="r">p95</th>
                          <th className="r">p99</th>
                          <th className="r">错误</th>
                        </tr>
                      </thead>
                      <tbody>
                        {levels.map((l) => (
                          <tr key={l.concurrency}>
                            <td className="mono">{l.concurrency}</td>
                            <td className="r mono">{l.decisions_per_s.toFixed(0)}</td>
                            <td className="r mono">{ms(l.p50)}</td>
                            <td className="r mono">{ms(l.p95)}</td>
                            <td className="r mono">{ms(l.p99)}</td>
                            <td className="r mono">{l.errors}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
              {shownHist.length > 0 && (
                <Card
                  title="延迟分布"
                  icon={<Timer />}
                  sub="最后一个档位 · 对数分箱"
                  actions={
                    engine && (
                      <div className="row" style={{ gap: 6 }}>
                        <Badge kind="brand">平均批大小 {engine.avg_forward_batch?.toFixed(1) ?? "—"}</Badge>
                        <Badge>单次前向 p50 {ms(engine.forward_p50_ms)}</Badge>
                      </div>
                    )
                  }
                >
                  <div className="hist">
                    {shownHist.map((h, i) => (
                      <i key={i} style={{ height: `${(h.n / histMax) * 100}%` }} title={`${ms(h.lo)}–${ms(h.hi)}：${h.n}`} />
                    ))}
                  </div>
                  <div className="hist-axis">
                    <span>{ms(shownHist[0].lo)}</span>
                    <span>{ms(shownHist[shownHist.length - 1].hi)}</span>
                  </div>
                </Card>
              )}
            </>
          )}

          <Card title="压测记录" icon={<History />}>
            {history.data?.length ? (
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th className="r">最佳吞吐</th>
                    <th className="r">该档 p50</th>
                    <th>时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((h) => (
                    <tr key={h.id}>
                      <td>{h.name}</td>
                      <td className="r mono">{h.summary.best ? `${h.summary.best.decisions_per_s.toFixed(0)} /s @${h.summary.best.concurrency}` : "—"}</td>
                      <td className="r mono">{ms(h.summary.best?.p50)}</td>
                      <td className="faint tiny">{timeAgo(h.created_at)}</td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          square
                          className="danger"
                          icon={<Trash2 />}
                          onClick={async () => {
                            await api.deleteBench(h.id);
                            history.reload();
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="faint small">还没有记录</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
