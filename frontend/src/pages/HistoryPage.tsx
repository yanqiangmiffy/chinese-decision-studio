import { FlaskConical, FolderInput, History, Search, Tag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { AnswerView } from "../components/decision";
import { Badge, Button, Drawer, Empty, KindBadge, PageHead, Card } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { useAsync } from "../hooks/useAsync";
import { optionsOf, ranked } from "../lib/decision";
import { dateTime, ms, pct, stateText, timeAgo } from "../lib/format";
import { handoff } from "../lib/presets";
import { navigate, useTitle } from "../router";
import type { HistoryItem } from "../types";

const SOURCE_LABEL: Record<string, string> = {
  playground: "实验台",
  lab: "实验室",
  "scenario:triage": "工单分诊",
  "scenario:agent": "智能体路由",
  "scenario:rag": "RAG 核查",
};

function Detail({ item, onChanged, onClose }: { item: HistoryItem; onChanged: () => void; onClose: () => void }) {
  const { toast } = useApp();
  const suites = useAsync(() => api.suites(), []);
  const [labels, setLabels] = useState<Record<string, unknown>>(item.labels ?? {});
  const [note, setNote] = useState(item.note ?? "");
  const [suiteId, setSuiteId] = useState<string>("");
  useEffect(() => {
    setLabels(item.labels ?? {});
    setNote(item.note ?? "");
  }, [item]);

  const save = async (next = labels) => {
    try {
      await api.labelHistory(item.id, { labels: next, note });
      toast("已保存", "ok");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="src-tag">{SOURCE_LABEL[item.source] ?? item.source}</span>
        <Badge>step {item.model_step ?? "—"}</Badge>
        <Badge>{ms(item.latency_ms)}</Badge>
        <Badge>{item.input_tokens} tokens</Badge>
        <span className="faint tiny">{dateTime(item.created_at)}</span>
      </div>
      <div className="inset" style={{ padding: 14, whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.75, maxHeight: 220, overflow: "auto" }}>
        {typeof item.state === "string" ? item.state : JSON.stringify(item.state, null, 2)}
      </div>
      {Object.entries(item.answers).map(([name, answer]) => {
        const q = item.questions[name];
        if (!q) return null;
        return (
          <div key={name} className="inset" style={{ padding: 16 }}>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <span className="mono small">{name}</span>
              <KindBadge kind={q.type} />
              <b className="small">{q.instructions}</b>
            </div>
            <AnswerView answer={answer} question={q} compact />
            <div className="label-row">
              <Tag size={14} />
              <span className="tiny">正确答案</span>
              {optionsOf(q).map(([k, v]) => (
                <button
                  key={k}
                  className={`chip ${String(labels[name]) === k ? "on" : ""}`}
                  title={v}
                  onClick={() => {
                    const next = { ...labels, [name]: String(labels[name]) === k ? null : k };
                    setLabels(next);
                    save(Object.fromEntries(Object.entries(next).filter(([, x]) => x !== null)));
                  }}
                >
                  {q.type === "score" ? v : q.type === "noul" ? (k === "true" ? "是" : "否") : k}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="field">
        <label className="label">备注</label>
        <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== item.note && save()} />
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Button
          icon={<FlaskConical />}
          onClick={() => {
            handoff({ state: item.state, questions: item.questions });
            navigate("/playground");
          }}
        >
          在实验台打开
        </Button>
        <span className="grow" />
        <select className="select" style={{ width: 200 }} value={suiteId} onChange={(e) => setSuiteId(e.target.value)}>
          <option value="">选择评测集…</option>
          {suites.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          icon={<FolderInput />}
          disabled={!suiteId || !Object.keys(labels).filter((k) => labels[k] !== null).length}
          onClick={async () => {
            try {
              await api.historyToSuite(item.id, Number(suiteId));
              toast("已加入评测集", "ok");
            } catch (e) {
              toast((e as Error).message, "bad");
            }
          }}
        >
          加入评测集
        </Button>
        <Button
          variant="ghost"
          className="danger"
          square
          icon={<Trash2 />}
          title="删除"
          onClick={async () => {
            await api.deleteHistory(item.id);
            onChanged();
            onClose();
          }}
        />
      </div>
    </div>
  );
}

export default function HistoryPage() {
  useTitle("历史记录");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<HistoryItem | null>(null);
  const data = useAsync(() => api.history({ q: query, source, page, size: 20 }), [query, source, page]);

  return (
    <div className="page">
      <PageHead
        eyebrow="HISTORY · 历史记录"
        icon={<History />}
        title="每一次决策都留了底"
        desc="实验台和场景里的调用都会记录下来：原始请求、概率、延迟、检查点。标注正确答案之后，可以一键加入评测集——线上遇到的难例，就是最好的评测数据。"
      />
      <Card>
        <div className="row wrap" style={{ gap: 10, marginBottom: 14 }}>
          <div className="row" style={{ gap: 8, flex: "1 1 320px" }}>
            <Search size={16} className="faint" />
            <input
              className="input"
              placeholder="搜索上下文或标题，回车确认"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setQuery(q);
                  setPage(1);
                }
              }}
            />
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className={`chip ${source === "" ? "on" : ""}`} onClick={() => setSource("")}>
              全部
            </button>
            {data.data?.sources.map((s) => (
              <button key={s.source} className={`chip ${source === s.source ? "on" : ""}`} onClick={() => setSource(s.source)}>
                {SOURCE_LABEL[s.source] ?? s.source} <span className="faint num">{s.n}</span>
              </button>
            ))}
          </div>
        </div>
        {data.data && data.data.items.length === 0 ? (
          <Empty icon={<History />} title="没有记录">
            去实验台运行一次决策，这里就会出现。
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>来源</th>
                  <th>上下文</th>
                  <th>结论</th>
                  <th className="r">延迟</th>
                  <th>标注</th>
                </tr>
              </thead>
              <tbody>
                {data.data?.items.map((it) => (
                  <tr key={it.id} className="click" onClick={() => api.historyItem(it.id).then(setOpen)}>
                    <td className="faint tiny" style={{ whiteSpace: "nowrap" }}>
                      {timeAgo(it.created_at)}
                    </td>
                    <td>
                      <span className="src-tag">{SOURCE_LABEL[it.source] ?? it.source}</span>
                    </td>
                    <td>
                      <div className="result-state" style={{ maxWidth: 460 }}>
                        {stateText(it.state, 140)}
                      </div>
                    </td>
                    <td>
                      <div className="ans-chips">
                        {Object.entries(it.answers)
                          .slice(0, 4)
                          .map(([name, a]) => {
                            const [k, p] = ranked(a)[0];
                            const label = a.type === "noul" ? ((a.noul ?? 0) >= 0.5 ? "是" : "否") : a.type === "score" ? (a.score ?? 0).toFixed(2) : k;
                            return (
                              <span key={name} className="ans-chip" title={name}>
                                <span className="faint">{name}</span>
                                <b>{label}</b>
                                <span className="faint">{pct(a.type === "noul" ? Math.max(a.noul ?? 0, 1 - (a.noul ?? 0)) : p, 0)}</span>
                              </span>
                            );
                          })}
                        {Object.keys(it.answers).length > 4 && <span className="faint tiny">+{Object.keys(it.answers).length - 4}</span>}
                      </div>
                    </td>
                    <td className="r mono tiny">{ms(it.latency_ms)}</td>
                    <td>{Object.keys(it.labels).length ? <Badge kind="ok">已标注 {Object.keys(it.labels).length}</Badge> : <span className="faint tiny">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.data && data.data.total > 20 && (
          <div className="pager">
            <span className="num">
              {data.data.total} 条 · 第 {page} / {Math.ceil(data.data.total / 20)} 页
            </span>
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <Button size="sm" disabled={page * 20 >= data.data.total} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        )}
      </Card>
      <Drawer open={!!open} title={open ? open.title || `决策 #${open.id}` : ""} onClose={() => setOpen(null)}>
        {open && <Detail item={open} onClose={() => setOpen(null)} onChanged={() => data.reload()} />}
      </Drawer>
    </div>
  );
}
