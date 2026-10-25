import { Plus, ScanText, Trash2 } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useApp } from "../hooks/useApp";
import { pct } from "../lib/format";
import { CASES, DOMAINS } from "../lib/extractionCases";
import type { TypeSpec } from "../lib/extractionTypes";
import type { Entity } from "../types";
import { Button, Empty } from "./ui";

// 每个类型一种颜色：按类型在列表里的顺序取色，同一份列表在文本、图例和表格里颜色一致
const PALETTE = ["#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#3b82f6", "#ef4444", "#14b8a6", "#a3a847", "#f97316", "#06b6d4", "#d946ef", "#84cc16"];

export function typeColors(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((n, i) => [n, PALETTE[i % PALETTE.length]]));
}

/** 抽取服务的状态：后端是否配置了统一模型服务、它是否在线。 */
export function useExtractionStatus() {
  const { health } = useApp();
  const e = health?.extraction;
  return {
    loading: health === null,
    configured: !!e?.configured,
    online: !!e?.online,
    ready: !!e?.configured && !!e?.online,
    baseUrl: e?.base_url ?? null,
    model: e?.model ?? null,
  };
}

/** 服务没配置或连不上时，替代整个功能区的提示（决策功能不受影响）。 */
export function ExtractionOffline({ children }: { children?: ReactNode }) {
  const s = useExtractionStatus();
  if (s.loading) return null;
  return (
    <div className="card card-pad">
      <Empty icon={<ScanText />} title={s.configured ? "抽取服务连不上" : "还没有配置抽取服务"}>
        {s.configured ? (
          <>
            平台配置的统一模型服务 <code className="mono">{s.baseUrl}</code> 当前不可达，请检查服务状态。决策功能不受影响。
          </>
        ) : (
          <>
            抽取需要统一模型服务（chinese-decision 仓库的 <code className="mono">scripts/serve_unified.py</code>）：同一份权重既做分类也做抽取。
            部署后在平台的环境变量里设置 <code className="mono">EXTRACTION_BASE_URL</code> 即可。
          </>
        )}
        {children}
      </Empty>
    </div>
  );
}

// ---------------------------------------------------------------- 把实体标在原文上
export function EntityText({ text, entities, colors, className = "" }: { text: string; entities: Entity[]; colors: Record<string, string>; className?: string }) {
  const sorted = [...entities].sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: ReactNode[] = [];
  let at = 0;
  sorted.forEach((e, i) => {
    if (e.start < at) return; // 服务端已经去掉了重叠；这里只防御
    if (e.start > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, e.start)}</Fragment>);
    parts.push(
      <mark key={`e${i}`} className="ex-mark" style={{ ["--c" as string]: colors[e.label] ?? "#8b5cf6" }} title={`${e.label} · ${pct(e.score, 0)}`}>
        {text.slice(e.start, e.end)}
        <sup>{e.label}</sup>
      </mark>,
    );
    at = e.end;
  });
  if (at < text.length) parts.push(<Fragment key="tail">{text.slice(at)}</Fragment>);
  return <div className={`ex-text ${className}`}>{parts}</div>;
}

/** 类型图例：颜色 + 名称 + 命中数。 */
export function TypeLegend({ names, colors, counts }: { names: string[]; colors: Record<string, string>; counts?: Record<string, number> }) {
  return (
    <div className="ex-legend">
      {names.map((n) => (
        <span key={n} className={`ex-legend-item ${counts && !counts[n] ? "idle" : ""}`} style={{ ["--c" as string]: colors[n] }}>
          <i />
          {n}
          {counts && <b className="mono">{counts[n] ?? 0}</b>}
        </span>
      ))}
    </div>
  );
}

/** 抽取结果表：按类型分组，列出每个实体和概率。 */
export function EntityList({ entities, order, colors }: { entities: Entity[]; order: string[]; colors: Record<string, string> }) {
  const groups = order.map((name) => [name, entities.filter((e) => e.label === name)] as const).filter(([, list]) => list.length);
  if (!groups.length) return <div className="faint small">没有抽到任何实体。</div>;
  return (
    <div className="ex-list">
      {groups.map(([name, list]) => (
        <div key={name} className="ex-group" style={{ ["--c" as string]: colors[name] }}>
          <div className="ex-group-name">
            <i />
            {name}
            <b className="mono">{list.length}</b>
          </div>
          <div className="ex-group-items">
            {list.map((e) => (
              <span key={`${e.start}-${e.end}`} className="ex-ent" title={`位置 ${e.start}–${e.end}`}>
                {e.text}
                <em className="mono">{pct(e.score, 0)}</em>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 编辑类型：名称 + 说明
export function TypeEditor({ types, onChange }: { types: TypeSpec[]; onChange: (types: TypeSpec[]) => void }) {
  const colors = typeColors(types.map((t) => t.name));
  const set = (i: number, patch: Partial<TypeSpec>) => onChange(types.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div className="ex-types">
      {types.map((t, i) => (
        <div key={i} className="ex-type" style={{ ["--c" as string]: colors[t.name] }}>
          <i className="ex-type-dot" />
          <input className="input sm" placeholder="类型名" value={t.name} onChange={(e) => set(i, { name: e.target.value })} />
          <textarea
            className="textarea ex-type-desc"
            rows={2}
            placeholder="说明（越接近训练写法越稳；可以留空）"
            value={t.desc}
            onChange={(e) => set(i, { desc: e.target.value })}
          />
          <Button variant="ghost" size="sm" square aria-label="删除类型" icon={<Trash2 />} onClick={() => onChange(types.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button size="sm" icon={<Plus />} onClick={() => onChange([...types, { name: "", desc: "" }])} disabled={types.length >= 40}>
        添加类型
      </Button>
    </div>
  );
}

/** 类型列表 → 请求里的 {名称: 说明}；空名称丢掉，重名后者覆盖前者。 */
export function typesPayload(types: TypeSpec[]): Record<string, string> {
  return Object.fromEntries(types.filter((t) => t.name.trim()).map((t) => [t.name.trim(), t.desc]));
}

/** 领域选择：十个领域在窄栏里放不下一行 Tabs，用会换行的小标签。 */
export function DomainPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {DOMAINS.map((d) => (
        <button key={d.id} className={`chip ${d.id === value ? "on" : ""}`} onClick={() => onChange(d.id)}>
          {d.label}
          <span className="faint">{CASES.filter((c) => c.domain === d.id).length}</span>
        </button>
      ))}
    </div>
  );
}
