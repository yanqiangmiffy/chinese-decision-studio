import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pct } from "../lib/format";
import type { ReliabilityBin } from "../types";

// 手写 SVG 图表：不引入图表库，配色和动效与设计系统一致。

export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setW(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const GRAD_STOPS = (
  <>
    <stop offset="0" stopColor="#a78bfa" />
    <stop offset=".5" stopColor="#6366f1" />
    <stop offset="1" stopColor="#22d3ee" />
  </>
);

// ---------------------------------------------------------------- 迷你折线
export function Sparkline({
  values,
  height = 42,
  color,
  fill = true,
}: {
  values: number[];
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  const [ref, w] = useSize<HTMLDivElement>();
  const id = useId().replace(/:/g, "");
  const path = useMemo(() => {
    if (values.length < 2 || !w) return null;
    const max = Math.max(...values, 1e-9);
    const min = Math.min(...values, 0);
    const x = (i: number) => (i / (values.length - 1)) * w;
    const y = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 8);
    const pts = values.map((v, i) => [x(i), y(v)] as const);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    return { line: d, area: `${d} L${w},${height} L0,${height} Z` };
  }, [values, w, height]);
  return (
    <div ref={ref} style={{ width: "100%", height }}>
      {path && (
        <svg width={w} height={height}>
          <defs>
            <linearGradient id={`sl-${id}`} x1="0" y1="0" x2="1" y2="0">
              {GRAD_STOPS}
            </linearGradient>
            <linearGradient id={`sa-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color ?? "#7c6cff"} stopOpacity=".28" />
              <stop offset="1" stopColor={color ?? "#7c6cff"} stopOpacity="0" />
            </linearGradient>
          </defs>
          {fill && <path d={path.area} fill={`url(#sa-${id})`} />}
          <path d={path.line} fill="none" stroke={color ?? `url(#sl-${id})`} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 圆环
export function Ring({
  value,
  size = 92,
  stroke = 9,
  children,
  color,
  track,
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  color?: string;
  track?: string;
}) {
  const id = useId().replace(/:/g, "");
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id={`rg-${id}`} x1="0" y1="0" x2="1" y2="1">
            {GRAD_STOPS}
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track ?? "var(--track)"} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color ?? `url(#rg-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset .9s cubic-bezier(.22,1,.36,1)", filter: "drop-shadow(0 0 6px rgba(124,108,255,.45))" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- 半圆仪表（score）
export function Gauge({ value, levels, width = 260 }: { value: number; levels: string[]; width?: number }) {
  const id = useId().replace(/:/g, "");
  const k = levels.length;
  const cx = width / 2;
  const r = width / 2 - 22;
  const cy = r + 14;
  const t = k > 1 ? Math.max(0, Math.min(1, value / (k - 1))) : 0;
  const angle = Math.PI * (1 - t);
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from);
    const a1 = Math.PI * (1 - to);
    return `M${cx + r * Math.cos(a0)},${cy - r * Math.sin(a0)} A${r},${r} 0 0 1 ${cx + r * Math.cos(a1)},${cy - r * Math.sin(a1)}`;
  };
  return (
    <svg width={width} height={cy + 26} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`gg-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#34d399" />
          <stop offset=".5" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#fb7185" />
        </linearGradient>
      </defs>
      <path d={arc(0, 1)} fill="none" stroke="var(--track)" strokeWidth="12" strokeLinecap="round" />
      <path d={arc(0, 1)} fill="none" stroke={`url(#gg-${id})`} strokeWidth="12" strokeLinecap="round" opacity=".85" />
      {levels.map((label, i) => {
        const a = Math.PI * (1 - (k > 1 ? i / (k - 1) : 0));
        const x1 = cx + (r - 14) * Math.cos(a);
        const y1 = cy - (r - 14) * Math.sin(a);
        const lx = cx + (r + 16) * Math.cos(a);
        const ly = cy - (r + 16) * Math.sin(a);
        return (
          <g key={i}>
            <circle cx={x1} cy={y1} r="2" fill="var(--text-3)" />
            <text
              x={lx}
              y={ly + 4}
              fontSize="10.5"
              fill="var(--text-3)"
              textAnchor={i === 0 ? "start" : i === k - 1 ? "end" : "middle"}
            >
              {label.length > 6 ? `${label.slice(0, 6)}…` : label}
            </text>
          </g>
        );
      })}
      <g style={{ transform: `rotate(${-(angle * 180) / Math.PI + 180}deg)`, transformOrigin: `${cx}px ${cy}px`, transition: "transform .9s cubic-bezier(.34,1.56,.64,1)" }}>
        <line x1={cx} y1={cy} x2={cx - r + 18} y2={cy} stroke="var(--text)" strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx={cx} cy={cy} r="7" fill="var(--panel-solid)" stroke="var(--text)" strokeWidth="2.5" />
    </svg>
  );
}

// ---------------------------------------------------------------- 横向条形对比
export function BarList({
  items,
  max,
  format = (v) => pct(v),
  highlight,
}: {
  items: { label: ReactNode; value: number | null; sub?: ReactNode; key?: string }[];
  max?: number;
  format?: (v: number) => string;
  highlight?: string;
}) {
  const top = max ?? Math.max(...items.map((i) => i.value ?? 0), 1e-9);
  return (
    <div className="barlist">
      {items.map((it, i) => (
        <div key={it.key ?? i} className={`barlist-row ${highlight && it.key === highlight ? "hl" : ""}`}>
          <div className="barlist-label">
            <span className="ellipsis">{it.label}</span>
            {it.sub && <span className="faint tiny">{it.sub}</span>}
          </div>
          <div className="barlist-track">
            <i style={{ width: `${((it.value ?? 0) / top) * 100}%` }} />
          </div>
          <div className="barlist-val num">{it.value === null ? "—" : format(it.value)}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 分组柱状（基准对比）
export function GroupedBars({
  groups,
  series,
  height = 240,
  min = 0,
  max = 1,
  format = (v: number) => pct(v, 0),
  lowerIsBetter,
}: {
  groups: string[];
  series: { name: string; color: string; values: (number | null)[]; highlight?: boolean }[];
  height?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  lowerIsBetter?: boolean;
}) {
  const [ref, w] = useSize<HTMLDivElement>();
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<{ g: number; s: number } | null>(null);
  const pad = { l: 36, r: 8, t: 12, b: 28 };
  const fillOf = (c: string) => (c === "brand" ? `url(#gb-${gid})` : c);
  const innerW = Math.max(0, w - pad.l - pad.r);
  const innerH = height - pad.t - pad.b;
  const gw = innerW / groups.length;
  const bw = Math.min(22, (gw - 16) / series.length);
  const y = (v: number) => pad.t + innerH - ((v - min) / (max - min)) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min));
  return (
    <div ref={ref} style={{ position: "relative" }}>
      {w > 0 && (
        <svg width={w} height={height}>
          <defs>
            <linearGradient id={`gb-${gid}`} x1="0" y1="1" x2="0" y2="0">
              {GRAD_STOPS}
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="3 4" />
              <text x={pad.l - 8} y={y(t) + 4} fontSize="10.5" textAnchor="end" fill="var(--text-3)">
                {format(t)}
              </text>
            </g>
          ))}
          {groups.map((g, gi) => {
            const x0 = pad.l + gi * gw + (gw - bw * series.length - 4 * (series.length - 1)) / 2;
            return (
              <g key={g}>
                {series.map((s, si) => {
                  const v = s.values[gi];
                  if (v === null || v === undefined) return null;
                  const x = x0 + si * (bw + 4);
                  const h = Math.max(1, pad.t + innerH - y(v));
                  const on = hover?.g === gi && hover?.s === si;
                  return (
                    <rect
                      key={s.name}
                      x={x}
                      y={pad.t + innerH - h}
                      width={bw}
                      height={h}
                      rx="4"
                      fill={fillOf(s.color)}
                      opacity={hover && !on ? 0.45 : s.highlight ? 1 : 0.78}
                      style={{ transition: "opacity .2s, height .6s, y .6s", filter: s.highlight ? "drop-shadow(0 0 8px rgba(124,108,255,.55))" : undefined }}
                      onMouseEnter={() => setHover({ g: gi, s: si })}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}
                <text x={pad.l + gi * gw + gw / 2} y={height - 8} fontSize="12" textAnchor="middle" fill="var(--text-2)">
                  {g}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {hover && (
        <div className="chart-tip" style={{ left: pad.l + hover.g * gw + gw / 2, top: 0 }}>
          <b>{series[hover.s].name}</b> · {groups[hover.g]}
          <div className="num">{format(series[hover.s].values[hover.g] ?? 0)}{lowerIsBetter ? "（越低越好）" : ""}</div>
        </div>
      )}
      <div className="legend">
        {series.map((s) => (
          <span key={s.name} className={s.highlight ? "on" : ""}>
            <i style={{ background: s.color === "brand" ? "var(--brand-grad)" : s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 可靠性图
export function ReliabilityDiagram({
  bins,
  after,
  height = 280,
}: {
  bins: ReliabilityBin[];
  after?: ReliabilityBin[];
  height?: number;
}) {
  const [ref, w] = useSize<HTMLDivElement>();
  const size = Math.min(w, height + 60);
  const pad = { l: 38, r: 10, t: 10, b: 32 };
  const iw = size - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const x = (v: number) => pad.l + v * iw;
  const y = (v: number) => pad.t + ih - v * ih;
  const maxN = Math.max(...bins.map((b) => b.n), 1);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div ref={ref} style={{ position: "relative", display: "flex", justifyContent: "center" }}>
      {w > 0 && (
        <svg width={size} height={height}>
          <defs>
            <linearGradient id="rel-g" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#6366f1" stopOpacity=".55" />
              <stop offset="1" stopColor="#a78bfa" stopOpacity=".95" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="3 4" />
              <text x={pad.l - 7} y={y(t) + 4} fontSize="10" textAnchor="end" fill="var(--text-3)">
                {Math.round(t * 100)}%
              </text>
              <text x={x(t)} y={height - 14} fontSize="10" textAnchor="middle" fill="var(--text-3)">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {bins.map((b, i) => {
            if (!b.n || b.accuracy === null) return null;
            const bw = (b.hi - b.lo) * iw - 3;
            const conf = b.confidence ?? (b.lo + b.hi) / 2;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {/* 置信度与准确率之间的差距 */}
                <rect
                  x={x(b.lo) + 1.5}
                  y={Math.min(y(b.accuracy), y(conf))}
                  width={bw}
                  height={Math.abs(y(b.accuracy) - y(conf))}
                  fill={b.accuracy < conf ? "rgba(251,113,133,.22)" : "rgba(52,211,153,.2)"}
                />
                <rect
                  x={x(b.lo) + 1.5}
                  y={y(b.accuracy)}
                  width={bw}
                  height={Math.max(0, pad.t + ih - y(b.accuracy))}
                  rx="3"
                  fill="url(#rel-g)"
                  opacity={0.35 + 0.65 * Math.sqrt(b.n / maxN)}
                />
              </g>
            );
          })}
          <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--text-3)" strokeDasharray="5 5" />
          {after && (
            <polyline
              fill="none"
              stroke="#22d3ee"
              strokeWidth="2"
              points={after
                .filter((b) => b.n && b.accuracy !== null)
                .map((b) => `${x(b.confidence ?? (b.lo + b.hi) / 2)},${y(b.accuracy ?? 0)}`)
                .join(" ")}
            />
          )}
          <text x={x(0.5)} y={height - 1} fontSize="10.5" textAnchor="middle" fill="var(--text-3)">
            置信度（p_max）
          </text>
        </svg>
      )}
      {hover !== null && bins[hover] && (
        <div className="chart-tip" style={{ left: "50%", top: 4, transform: "translateX(-50%)" }}>
          置信度 {pct(bins[hover].lo, 0)}–{pct(bins[hover].hi, 0)} · {bins[hover].n} 条
          <div className="num">
            平均置信 {pct(bins[hover].confidence)} · 实际准确 {pct(bins[hover].accuracy)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 折线图（多序列）
export interface Series {
  name: string;
  color: string;
  points: { x: number; y: number | null }[];
  dashed?: boolean;
  area?: boolean;
}
export function LineChart({
  series,
  height = 220,
  xFormat = (v) => String(v),
  yFormat = (v) => String(Math.round(v)),
  yMin,
  yMax,
  xLabel,
  markerX,
  onHoverX,
}: {
  series: Series[];
  height?: number;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  yMin?: number;
  yMax?: number;
  xLabel?: string;
  markerX?: number | null;
  onHoverX?: (x: number | null) => void;
}) {
  const [ref, w] = useSize<HTMLDivElement>();
  const id = useId().replace(/:/g, "");
  const pad = { l: 46, r: 12, t: 12, b: xLabel ? 36 : 24 };
  const all = series.flatMap((s) => s.points.filter((p) => p.y !== null));
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y as number);
  const x0 = xs.length ? Math.min(...xs) : 0;
  const x1 = xs.length ? Math.max(...xs) : 1;
  const lo = yMin ?? (ys.length ? Math.min(0, ...ys) : 0);
  const hi = yMax ?? (ys.length ? Math.max(...ys) * 1.12 || 1 : 1);
  const iw = Math.max(0, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * iw;
  const sy = (v: number) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const [hx, setHx] = useState<number | null>(null);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + t * (hi - lo));
  const nearest = (px: number) => {
    let best: number | null = null;
    let bd = Infinity;
    for (const v of xs) {
      const d = Math.abs(sx(v) - px);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      {w > 0 && (
        <svg
          width={w}
          height={height}
          onMouseMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const v = nearest(e.clientX - rect.left);
            setHx(v);
            onHoverX?.(v);
          }}
          onMouseLeave={() => {
            setHx(null);
            onHoverX?.(null);
          }}
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient key={i} id={`la-${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity=".25" />
                <stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeDasharray="3 4" />
              <text x={pad.l - 8} y={sy(t) + 4} fontSize="10.5" textAnchor="end" fill="var(--text-3)">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {[0, 0.5, 1].map((t) => {
            const v = x0 + t * (x1 - x0);
            return (
              <text key={t} x={sx(v)} y={height - (xLabel ? 20 : 6)} fontSize="10.5" textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"} fill="var(--text-3)">
                {xFormat(v)}
              </text>
            );
          })}
          {xLabel && (
            <text x={pad.l + iw / 2} y={height - 3} fontSize="10.5" textAnchor="middle" fill="var(--text-3)">
              {xLabel}
            </text>
          )}
          {series.map((s, i) => {
            const pts = s.points.filter((p) => p.y !== null) as { x: number; y: number }[];
            if (pts.length < 1) return null;
            const d = pts.map((p, j) => `${j ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join(" ");
            return (
              <g key={s.name}>
                {s.area && pts.length > 1 && (
                  <path d={`${d} L${sx(pts[pts.length - 1].x)},${sy(lo)} L${sx(pts[0].x)},${sy(lo)} Z`} fill={`url(#la-${id}-${i})`} />
                )}
                <path d={d} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" strokeDasharray={s.dashed ? "6 5" : undefined} />
                {pts.length < 16 && pts.map((p, j) => <circle key={j} cx={sx(p.x)} cy={sy(p.y)} r="3.2" fill="var(--panel-solid)" stroke={s.color} strokeWidth="2" />)}
              </g>
            );
          })}
          {(hx ?? markerX) !== null && (hx ?? markerX) !== undefined && (
            <line x1={sx((hx ?? markerX) as number)} x2={sx((hx ?? markerX) as number)} y1={pad.t} y2={pad.t + ih} stroke="var(--text-3)" strokeDasharray="3 3" />
          )}
        </svg>
      )}
      {hx !== null && (
        <div className="chart-tip" style={{ left: Math.min(sx(hx), w - 120), top: 4 }}>
          <b>{xFormat(hx)}</b>
          {series.map((s) => {
            const p = s.points.find((q) => q.x === hx);
            return (
              <div key={s.name} className="row num" style={{ gap: 6 }}>
                <i className="legend-dot" style={{ background: s.color }} />
                {s.name} {p && p.y !== null ? yFormat(p.y) : "—"}
              </div>
            );
          })}
        </div>
      )}
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 直方图（对 / 错堆叠）
export function StackHistogram({
  bins,
  height = 160,
}: {
  bins: { lo: number; hi: number; correct: number; wrong: number }[];
  height?: number;
}) {
  const [ref, w] = useSize<HTMLDivElement>();
  const max = Math.max(...bins.map((b) => b.correct + b.wrong), 1);
  const pad = { l: 8, r: 8, t: 6, b: 20 };
  const iw = Math.max(0, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const bw = iw / bins.length;
  return (
    <div ref={ref}>
      {w > 0 && (
        <svg width={w} height={height}>
          {bins.map((b, i) => {
            const hc = (b.correct / max) * ih;
            const hw = (b.wrong / max) * ih;
            const x = pad.l + i * bw + 1.5;
            return (
              <g key={i}>
                <title>{`${pct(b.lo, 0)}–${pct(b.hi, 0)}：正确 ${b.correct}，错误 ${b.wrong}`}</title>
                <rect x={x} y={pad.t + ih - hc - hw} width={bw - 3} height={hw} rx="2" fill="#fb7185" opacity=".85" />
                <rect x={x} y={pad.t + ih - hc} width={bw - 3} height={hc} rx="2" fill="#34d399" opacity=".8" />
              </g>
            );
          })}
          {[0, 0.5, 1].map((t) => (
            <text key={t} x={pad.l + t * iw} y={height - 4} fontSize="10.5" fill="var(--text-3)" textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"}>
              {Math.round(t * 100)}%
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 混淆矩阵
export function ConfusionMatrix({ keys, matrix, labels }: { keys: string[]; matrix: number[][]; labels?: Record<string, string> }) {
  const rowTotals = matrix.map((r) => r.reduce((a, b) => a + b, 0));
  return (
    <div className="cm" style={{ gridTemplateColumns: `minmax(70px, auto) repeat(${keys.length}, minmax(34px, 1fr))` }}>
      <div className="cm-corner">
        <span>真实 ↓</span>
        <span>预测 →</span>
      </div>
      {keys.map((k) => (
        <div key={k} className="cm-head" title={labels?.[k] ?? k}>
          {labels?.[k] ?? k}
        </div>
      ))}
      {matrix.map((row, i) => (
        <div key={keys[i]} style={{ display: "contents" }}>
          <div className="cm-head row-head" title={labels?.[keys[i]] ?? keys[i]}>
            {labels?.[keys[i]] ?? keys[i]}
          </div>
          {row.map((v, j) => {
            const share = rowTotals[i] ? v / rowTotals[i] : 0;
            const diag = i === j;
            return (
              <div
                key={j}
                className={`cm-cell ${diag ? "diag" : ""}`}
                style={{
                  background: v
                    ? diag
                      ? `rgba(124,108,255,${0.15 + share * 0.75})`
                      : `rgba(251,113,133,${0.12 + share * 0.7})`
                    : undefined,
                }}
                title={`${labels?.[keys[i]] ?? keys[i]} → ${labels?.[keys[j]] ?? keys[j]}：${v}`}
              >
                {v || ""}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 雷达图
export function Radar({
  axes,
  series,
  size = 260,
}: {
  axes: string[];
  series: { name: string; color: string; values: number[] }[];
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 38;
  const n = axes.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + r * v * Math.cos(a), cy + r * v * Math.sin(a)];
  };
  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <polygon key={t} points={axes.map((_, i) => pt(i, t).join(",")).join(" ")} fill="none" stroke="var(--line)" />
      ))}
      {axes.map((a, i) => {
        const [x, y] = pt(i, 1);
        const [lx, ly] = pt(i, 1.2);
        return (
          <g key={a}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" />
            <text x={lx} y={ly + 4} fontSize="11" fill="var(--text-2)" textAnchor={Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end"}>
              {a}
            </text>
          </g>
        );
      })}
      {series.map((s) => (
        <g key={s.name}>
          <polygon
            points={s.values.map((v, i) => pt(i, Math.max(0, Math.min(1, v))).join(",")).join(" ")}
            fill={s.color}
            fillOpacity=".16"
            stroke={s.color}
            strokeWidth="2"
            style={{ transition: "all .6s cubic-bezier(.22,1,.36,1)" }}
          />
          {s.values.map((v, i) => {
            const [x, y] = pt(i, Math.max(0, Math.min(1, v)));
            return <circle key={i} cx={x} cy={y} r="3" fill={s.color} />;
          })}
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- 环形分布
export function Donut({
  parts,
  size = 140,
  stroke = 18,
  children,
}: {
  parts: { label: string; value: number; color: string }[];
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const total = parts.reduce((a, b) => a + b.value, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        {parts.map((p) => {
          const len = (p.value / total) * c;
          const el = (
            <circle
              key={p.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
              strokeDashoffset={-offset}
              style={{ transition: "stroke-dasharray .8s cubic-bezier(.22,1,.36,1)" }}
            >
              <title>{`${p.label}：${p.value}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>{children}</div>
    </div>
  );
}

/** 进入视口后才渲染（重型图表用）。 */
export function Lazy({ children, height = 200 }: { children: ReactNode; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} style={{ minHeight: seen ? undefined : height }}>{seen && children}</div>;
}
