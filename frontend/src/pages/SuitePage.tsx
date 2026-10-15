import { ArrowLeft, Download, FlaskConical, ListChecks, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Sparkline } from "../components/charts";
import { Badge, Button, Card, CodeBlock, Empty, KindBadge, Modal, Skeleton } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { useAsync } from "../hooks/useAsync";
import { optionsOf } from "../lib/decision";
import { pct, stateText, timeAgo } from "../lib/format";
import { handoff } from "../lib/presets";
import { Link, navigate, useTitle } from "../router";
import type { CaseItem, Question } from "../types";
import { CATEGORY, RunDialog, StatusBadge } from "./Eval";

function goldLabel(q: Question, gold: unknown): string {
  if (gold && typeof gold === "object" && "probabilities" in (gold as object)) {
    const p = (gold as { probabilities: Record<string, number> }).probabilities;
    const top = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
    const opts = Object.fromEntries(optionsOf(q));
    return top[1] >= 1 - 1e-6 ? opts[top[0]] ?? top[0] : `软标签（${opts[top[0]] ?? top[0]} ${pct(top[1], 0)}）`;
  }
  const key = typeof gold === "boolean" ? String(gold) : String(gold);
  const opts = Object.fromEntries(optionsOf(q));
  if (q.type === "noul") return { true: "是", false: "否", 是: "是", 否: "否" }[key] ?? key;
  return opts[key] ?? key;
}

const CASE_TEMPLATE = JSON.stringify(
  {
    state: "这里写上下文",
    questions: { q: { type: "choice", instructions: "这里写问题", criteria: { a: "选项 A", b: "选项 B" } } },
    gold: { q: "a" },
    meta: { tag: "标签" },
  },
  null,
  2,
);

export default function SuitePage({ id }: { id: number }) {
  const { toast } = useApp();
  const suite = useAsync(() => api.suite(id), [id]);
  const runs = useAsync(() => api.runs(id), [id]);
  const [page, setPage] = useState(1);
  const cases = useAsync(() => api.cases(id, page, 20), [id, page]);
  const [runOpen, setRunOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState(CASE_TEMPLATE);
  useTitle(suite.data?.name ?? "评测集");

  if (suite.error) return <Empty icon={<ListChecks />} title="评测集不存在" />;
  const s = suite.data;
  const cat = CATEGORY[s?.category ?? "custom"] ?? CATEGORY.custom;
  const completed = (runs.data ?? []).filter((r) => r.status === "completed").reverse();

  const remove = async () => {
    if (!s || !window.confirm(`删除评测集「${s.name}」及其全部用例？评测运行记录会保留。`)) return;
    await api.deleteSuite(s.id);
    toast("已删除", "ok");
    navigate("/eval");
  };

  const addCase = async () => {
    try {
      const body = JSON.parse(draft);
      await api.addCase(id, { external_id: "", meta: {}, ...body });
      toast("已添加用例", "ok");
      setAddOpen(false);
      cases.reload();
      suite.reload();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  const openCase = (c: CaseItem) => {
    handoff({ state: c.state, questions: c.questions });
    navigate("/playground");
  };

  return (
    <div className="page">
      <div className="scn-head">
        <Link to="/eval" className="btn ghost sm">
          <ArrowLeft /> 评测中心
        </Link>
        {!s ? (
          <Skeleton h={60} />
        ) : (
          <div className="scn-head-main">
            <span className="suite-cat" style={{ background: cat.color, width: 52, height: 52, borderRadius: 16 }}>
              {cat.icon}
            </span>
            <div className="grow">
              <div className="row" style={{ gap: 10 }}>
                <h1 className="page-title">{s.name}</h1>
                {s.builtin && <Badge kind="brand">内置</Badge>}
                <Badge>{cat.label}</Badge>
              </div>
              <p className="page-desc">{s.description}</p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <a className="btn" href={`/api/suites/${s.id}/export`}>
                <Download /> 导出 JSONL
              </a>
              <Button variant="ghost" className="danger" icon={<Trash2 />} onClick={remove}>
                删除
              </Button>
              <Button variant="primary" icon={<Play />} onClick={() => setRunOpen(true)}>
                运行评测
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="grid g4 stagger" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="stat-label">用例</div>
          <div className="stat-value num">{s?.case_count ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">题型</div>
          <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
            {Object.entries(s?.kinds ?? {}).map(([k, n]) => (
              <span key={k} className="row" style={{ gap: 4 }}>
                <KindBadge kind={k as Question["type"]} />
                <span className="mono small">{n}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">最近一次准确率</div>
          <div className="stat-value num">{pct(s?.last_run?.accuracy)}</div>
          <div className="stat-foot">ECE {pct(s?.last_run?.ece, 2)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">历次准确率</div>
          {completed.length > 1 ? (
            <div style={{ marginTop: 6 }}>
              <Sparkline values={completed.map((r) => r.accuracy ?? 0)} height={46} />
            </div>
          ) : (
            <div className="stat-foot">运行两次以上后显示趋势</div>
          )}
        </div>
      </div>

      {runs.data && runs.data.length > 0 && (
        <Card title="评测运行" icon={<Play />} className="" bodyClass="card-body">
          <div className="col" style={{ gap: 4 }}>
            {runs.data.slice(0, 6).map((r) => (
              <Link key={r.id} to={`/eval/runs/${r.id}`} className="run-mini">
                <span className="mono tiny faint">#{r.id}</span>
                <div className="grow">
                  <div className="small">T={r.config?.temperature?.toFixed(2)} · step {r.model?.step ?? "—"}</div>
                  <div className="faint tiny">{timeAgo(r.created_at)}</div>
                </div>
                <StatusBadge run={r} />
                <span className="run-mini-acc num">{pct(r.accuracy)}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div style={{ height: 18 }} />
      <Card
        title="用例"
        icon={<ListChecks />}
        sub={cases.data ? `共 ${cases.data.total} 条` : undefined}
        actions={
          <Button size="sm" icon={<Plus />} onClick={() => setAddOpen(true)}>
            添加用例
          </Button>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th>上下文</th>
                <th>问题与标准答案</th>
                <th>标签</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cases.data?.items.map((c, i) => (
                <tr key={c.id}>
                  <td className="mono tiny faint">{(page - 1) * 20 + i + 1}</td>
                  <td>
                    <div className="result-state">{stateText(c.state, 220)}</div>
                  </td>
                  <td>
                    <div className="col" style={{ gap: 5 }}>
                      {Object.entries(c.questions).map(([name, q]) => (
                        <div key={name} className="row" style={{ gap: 6, alignItems: "flex-start" }}>
                          <KindBadge kind={q.type} />
                          <span className="small">
                            {q.instructions} → <b className="ok">{goldLabel(q, c.gold[name])}</b>
                          </span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>{c.meta?.tag ? <span className="src-tag">{String(c.meta.tag)}</span> : null}</td>
                  <td>
                    <div className="row" style={{ gap: 2 }}>
                      <Button size="sm" variant="ghost" square icon={<FlaskConical />} title="在实验台打开" onClick={() => openCase(c)} />
                      <Button
                        size="sm"
                        variant="ghost"
                        square
                        className="danger"
                        icon={<Trash2 />}
                        title="删除"
                        onClick={async () => {
                          await api.deleteCase(c.id);
                          cases.reload();
                          suite.reload();
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cases.data && cases.data.total > 20 && (
          <div className="pager">
            <span className="num">
              第 {page} / {Math.ceil(cases.data.total / 20)} 页
            </span>
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <Button size="sm" disabled={page * 20 >= cases.data.total} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        )}
      </Card>

      {runOpen && s && <RunDialog suite={s} onClose={() => setRunOpen(false)} />}
      <Modal open={addOpen} title="添加用例" onClose={() => setAddOpen(false)}>
        <div className="col" style={{ gap: 12 }}>
          <div className="faint small">格式与 CJ-Bench 一致。也可以在实验台运行后，到「历史记录」里标注并一键加入评测集。</div>
          <textarea className="textarea mono" rows={14} style={{ fontFamily: "var(--mono)", fontSize: 12.5 }} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="primary" icon={<Plus />} onClick={addCase}>
              添加
            </Button>
          </div>
          <CodeBlock lang="json" code={'{"gold": {"q": {"probabilities": {"a": 0.7, "b": 0.3}}}}  // 也支持软标签'} />
        </div>
      </Modal>
    </div>
  );
}
