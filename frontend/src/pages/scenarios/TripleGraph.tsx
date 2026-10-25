import { Braces, Plus, Share2, Trash2, Waypoints } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { ExtractionOffline, typeColors, useExtractionStatus } from "../../components/extraction";
import { Badge, Button, Card, CodeBlock } from "../../components/ui";
import { useApp } from "../../hooks/useApp";
import { RELATION_SCHEMA, relationTypeName, TRIPLE_CASES, type TripleCase } from "../../lib/extractionPipelines";
import { pct } from "../../lib/format";
import { LatChip } from "./shared";

// 三元组抽取：模型把“关系抽取”训练成“主体固定、类型名是 {主体}的{关系}、说明写客体类型、跨度就是客体”。
// 所以只要给出主体，一次请求就能问出它的全部关系。主体从哪来由你决定（词典、NER、上一步的结果）。

interface Subject {
  name: string;
  kind: string;
}
interface Triple {
  s: string;
  p: string;
  o: string;
  score: number;
}

const KINDS = Object.keys(RELATION_SCHEMA);

export default function TripleGraph() {
  const { toast } = useApp();
  const status = useExtractionStatus();
  const [caseId, setCaseId] = useState(TRIPLE_CASES[0].id);
  const [text, setText] = useState(TRIPLE_CASES[0].text);
  const [subjects, setSubjects] = useState<Subject[]>(TRIPLE_CASES[0].subjects);
  const [triples, setTriples] = useState<Triple[] | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const run = async (t: string, subs: Subject[]) => {
    const valid = subs.filter((s) => s.name.trim());
    if (!t.trim() || !valid.length) return;
    const id = ++seq.current;
    setBusy(true);
    const started = performance.now();
    try {
      const results = await Promise.all(
        valid.map(async (sub) => {
          // 类型名 → 关系：同一个主体的所有关系放进一次请求
          const lookup = new Map<string, string>();
          const types: Record<string, string> = {};
          for (const [relation, objectType] of RELATION_SCHEMA[sub.kind] ?? []) {
            const name = relationTypeName(sub.name.trim(), relation);
            lookup.set(name, relation);
            types[name] = objectType;
          }
          const res = await api.extract({ text: t, types });
          return res.entities.map((e): Triple => ({ s: sub.name.trim(), p: lookup.get(e.label) ?? e.label, o: e.text, score: e.score }));
        }),
      );
      if (id !== seq.current) return;
      const seen = new Set<string>();
      setTriples(
        results
          .flat()
          .filter((x) => !seen.has(`${x.s}|${x.p}|${x.o}`) && seen.add(`${x.s}|${x.p}|${x.o}`))
          .sort((a, b) => b.score - a.score),
      );
      setLatency(performance.now() - started);
    } catch (e) {
      if (id === seq.current) toast((e as Error).message, "bad");
    } finally {
      if (id === seq.current) setBusy(false);
    }
  };

  const started = useRef(false);
  useEffect(() => {
    if (!status.ready || started.current) return; // 开发模式下 StrictMode 会执行两次
    started.current = true;
    run(text, subjects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.ready]);

  const pick = (c: TripleCase) => {
    setCaseId(c.id);
    setText(c.text);
    setSubjects(c.subjects.map((s) => ({ ...s })));
    setTriples(null);
    run(c.text, c.subjects);
  };

  const relationNames = useMemo(() => [...new Set((triples ?? []).map((t) => t.p))], [triples]);
  const colors = typeColors(relationNames);
  const patch = (i: number, p: Partial<Subject>) => setSubjects((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));

  if (!status.ready) return <ExtractionOffline />;

  return (
    <div className="tg">
      <div className="col" style={{ gap: 18 }}>
        <Card title="文本" icon={<Braces />} sub={`${TRIPLE_CASES.length} 个样例：影视、图书、歌曲、综艺、学校、企业、行政区、国家、人物`}>
          <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
            {TRIPLE_CASES.map((c) => (
              <button key={c.id} className={`chip ${c.id === caseId ? "on" : ""}`} onClick={() => pick(c)}>
                {c.title}
              </button>
            ))}
          </div>
        </Card>

        <Card title="主体" icon={<Waypoints />} sub="告诉模型“问谁”：主体名称 + 主体类型（决定问哪些关系）">
          <div className="col" style={{ gap: 8 }}>
            {subjects.map((s, i) => (
              <div key={i} className="col" style={{ gap: 6 }}>
                <div className="tg-subject">
                  <input className="input sm" placeholder="主体名称" value={s.name} onChange={(e) => patch(i, { name: e.target.value })} />
                  <select className="select" style={{ height: 30, fontSize: 13 }} value={s.kind} onChange={(e) => patch(i, { kind: e.target.value })}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <Button variant="ghost" size="sm" square aria-label="删除主体" icon={<Trash2 />} onClick={() => setSubjects((xs) => xs.filter((_, j) => j !== i))} />
                </div>
                <div className="tg-rel">
                  {(RELATION_SCHEMA[s.kind] ?? []).map(([relation, objectType]) => (
                    <span key={relation} className="chip" title={`问“${relationTypeName(s.name || "主体", relation)}”，说明写“${objectType}”`}>
                      {relation}
                      <span className="faint">{objectType}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <div className="row" style={{ gap: 8 }}>
              <Button size="sm" icon={<Plus />} disabled={subjects.length >= 4} onClick={() => setSubjects((xs) => [...xs, { name: "", kind: "人物" }])}>
                添加主体
              </Button>
              <span className="grow" />
              <Button variant="primary" icon={<Share2 />} loading={busy} disabled={!text.trim() || !subjects.some((s) => s.name.trim())} onClick={() => run(text, subjects)}>
                抽取三元组
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="col" style={{ gap: 18 }}>
        <Card
          title="三元组"
          icon={<Share2 />}
          sub={triples ? `${triples.length} 条 · 每个主体一次请求` : "抽取中…"}
          actions={latency !== null && <LatChip value={latency} label="共" />}
        >
          {triples && triples.length === 0 && <div className="faint small">没有抽到关系：这段文本里没有该主体的这些关系，或者属于模型漏抽的关系（作词 / 作曲、祖籍、官方语言、饰演）。</div>}
          {triples && triples.length > 0 && (
            <>
              <div className="tg-list">
                {triples.map((t) => (
                  <div key={`${t.s}|${t.p}|${t.o}`} className="tg-triple">
                    <span className="tg-s">{t.s}</span>
                    <span className="tg-p" style={{ borderColor: `color-mix(in srgb, ${colors[t.p]} 55%, transparent)`, color: colors[t.p] }}>
                      {t.p} →
                    </span>
                    <span className="tg-o">
                      {t.o}
                      <em className="mono">{pct(t.score, 0)}</em>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {triples && triples.length > 0 && (
          <Card title="关系图" icon={<Waypoints />} sub="左边是主体，右边是客体，连线是关系" actions={<Badge kind="info">{triples.length} 条边</Badge>}>
            <Graph triples={triples} colors={colors} />
          </Card>
        )}

        {triples && triples.length > 0 && (
          <Card title="JSON" sub="可直接写入图数据库或知识库">
            <CodeBlock code={JSON.stringify(triples.map((t) => ({ subject: t.s, predicate: t.p, object: t.o, score: Number(t.score.toFixed(3)) })), null, 2)} lang="json" maxHeight={280} />
          </Card>
        )}
      </div>
    </div>
  );
}

// 二分图：主体在左、客体在右（相同文字的客体合并成一个节点）
function Graph({ triples, colors }: { triples: Triple[]; colors: Record<string, string> }) {
  const subjects = [...new Set(triples.map((t) => t.s))];
  const objects = [...new Set(triples.map((t) => t.o))];
  const W = 640;
  const row = 46;
  const H = Math.max(subjects.length, objects.length) * row + 24;
  const node = 168;
  const left = 16;
  const right = W - 16 - node;
  const yOf = (i: number, n: number) => (H - n * row) / 2 + i * row + row / 2;
  const clip = (s: string) => (s.length > 11 ? `${s.slice(0, 10)}…` : s);

  return (
    <svg className="tg-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="三元组关系图">
      {triples.map((t) => {
        const y1 = yOf(subjects.indexOf(t.s), subjects.length);
        const y2 = yOf(objects.indexOf(t.o), objects.length);
        const x1 = left + node;
        const x2 = right;
        const mx = (x1 + x2) / 2;
        return (
          <g key={`${t.s}|${t.p}|${t.o}`}>
            <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={colors[t.p]} strokeWidth={1.6} opacity={0.75} />
            <text className="edge-label" x={mx} y={(y1 + y2) / 2 - 4} textAnchor="middle" style={{ stroke: "var(--panel-2)", strokeWidth: 4, paintOrder: "stroke" }}>
              {t.p}
            </text>
          </g>
        );
      })}
      {subjects.map((s, i) => (
        <g key={s}>
          <rect x={left} y={yOf(i, subjects.length) - 17} width={node} height={34} rx={9} fill="color-mix(in srgb, var(--violet) 22%, transparent)" stroke="var(--violet)" />
          <text x={left + node / 2} y={yOf(i, subjects.length) + 4.5} textAnchor="middle" fontSize={13} fontWeight={600}>
            {clip(s)}
          </text>
        </g>
      ))}
      {objects.map((o, i) => (
        <g key={o}>
          <rect x={right} y={yOf(i, objects.length) - 17} width={node} height={34} rx={9} fill="var(--panel-3)" stroke="var(--line-strong)" />
          <text x={right + node / 2} y={yOf(i, objects.length) + 4.5} textAnchor="middle" fontSize={13}>
            {clip(o)}
          </text>
        </g>
      ))}
    </svg>
  );
}
