import { Check, Copy, Loader2, X } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTween } from "../hooks/useAsync";
import { KIND_LABEL } from "../lib/decision";
import type { Kind } from "../types";

// ---------------------------------------------------------------- 按钮
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "default";
  size?: "sm" | "lg";
  icon?: ReactNode;
  loading?: boolean;
  square?: boolean;
};
export function Button({ variant = "default", size, icon, loading, square, className = "", children, disabled, ...rest }: BtnProps) {
  const cls = ["btn", variant !== "default" && variant, size, square && "icon", className].filter(Boolean).join(" ");
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- 卡片
export function Card({
  title,
  sub,
  icon,
  actions,
  children,
  className = "",
  bodyClass = "card-body",
  glow,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClass?: string;
  glow?: boolean;
}) {
  return (
    <section className={`card ${glow ? "glow-border" : ""} ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && (
              <h3 className="card-title">
                {icon}
                {title}
              </h3>
            )}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function PageHead({
  eyebrow,
  icon,
  title,
  desc,
  actions,
}: {
  eyebrow?: string;
  icon?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && (
          <div className="page-eyebrow">
            {icon}
            {eyebrow}
          </div>
        )}
        <h1 className="page-title">{title}</h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- 表单控件
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size,
}: {
  value: T;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm";
}) {
  return (
    <div className={`seg ${size ?? ""}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <span className="track" />
      {label}
    </label>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ["--fill" as string]: fill }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

// ---------------------------------------------------------------- 徽标
export function Badge({ kind, children, icon }: { kind?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={`badge ${kind ?? ""}`}>
      {icon}
      {children}
    </span>
  );
}

export function KindBadge({ kind }: { kind: Kind }) {
  return <span className={`badge ${kind}`}>{KIND_LABEL[kind]}</span>;
}

export function Tip({ text, children, right }: { text: string; children: ReactNode; right?: boolean }) {
  return (
    <span className={`tip ${right ? "right" : ""}`} data-tip={text}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- 弹层
export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
  actions,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  actions?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <div className="row">
            {actions}
            <Button variant="ghost" square size="sm" onClick={onClose} aria-label="关闭" icon={<X />} />
          </div>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, title, onClose, children, actions }: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <div className="row">
            {actions}
            <Button variant="ghost" square size="sm" onClick={onClose} aria-label="关闭" icon={<X />} />
          </div>
        </div>
        <div className="modal-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode; icon?: ReactNode; count?: number }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} className={`tab ${t.value === value ? "on" : ""}`} onClick={() => onChange(t.value)}>
          {t.icon}
          {t.label}
          {t.count !== undefined && <span className="count num">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 状态
export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {children && <div className="small">{children}</div>}
      {action}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="加载中" />;
}

export function Skeleton({ h = 16, w = "100%", r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}

export function Progress({ value, indeterminate }: { value: number; indeterminate?: boolean }) {
  return (
    <div className={`progress ${indeterminate ? "indeterminate" : ""}`}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

/** 数字滚动：值变化时平滑过渡。 */
export function Num({ value, format }: { value: number; format: (v: number) => string }) {
  const v = useTween(value);
  return <span className="num">{format(v)}</span>;
}

export function Stat({
  label,
  icon,
  value,
  unit,
  foot,
  accent,
  children,
}: {
  label: ReactNode;
  icon?: ReactNode;
  value: ReactNode;
  unit?: string;
  foot?: ReactNode;
  accent?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`stat ${accent ? "stat-accent" : ""}`}>
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {foot && <div className="stat-foot">{foot}</div>}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- 代码
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      className="copy"
      icon={done ? <Check /> : <Copy />}
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => undefined);
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
    >
      {label ?? (done ? "已复制" : "复制")}
    </Button>
  );
}

function highlightJson(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    if (m[1]) {
      out.push(
        <span key={i++} className={m[2] ? "tok-key" : "tok-str"}>
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3]) out.push(<span key={i++} className="tok-bool">{m[3]}</span>);
    else if (m[4]) out.push(<span key={i++} className="tok-num">{m[4]}</span>);
    last = re.lastIndex;
  }
  out.push(src.slice(last));
  return out;
}

export function CodeBlock({ code, lang = "text", maxHeight }: { code: string; lang?: "json" | "text"; maxHeight?: number }) {
  return (
    <div className="code">
      <CopyButton text={code} />
      <pre style={maxHeight ? { maxHeight } : undefined}>{lang === "json" ? highlightJson(code) : code}</pre>
    </div>
  );
}

// ---------------------------------------------------------------- 品牌
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset=".5" stopColor="#6366f1" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect x="3" y="12" width="4.2" height="8" rx="1.4" fill="currentColor" opacity=".28" />
      <rect x="9.9" y="3.5" width="4.2" height="16.5" rx="1.4" fill="url(#logo-g)" />
      <rect x="16.8" y="9" width="4.2" height="11" rx="1.4" fill="currentColor" opacity=".28" />
    </svg>
  );
}
