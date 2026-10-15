import {
  Bot,
  Brain,
  FileUp,
  FolderPlus,
  Headset,
  Layers,
  Play,
  Shield,
  Stethoscope,
  Target,
  Trophy,
  Upload,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { Badge, Button, Card, CodeBlock, Empty, Modal, PageHead, Progress, Skeleton, Slider, Toggle } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { useAsync, useInterval } from "../hooks/useAsync";
import { ms, pct, timeAgo } from "../lib/format";
import { navigate, useTitle } from "../router";
import type { RunSummary, Suite } from "../types";

export const CATEGORY: Record<string, { icon: ReactNode; color: string; label: string }> = {
  operations: { icon: <Headset />, color: "linear-gradient(135deg,#8b5cf6,#6366f1)", label: "客服运营" },
  agent: { icon: <Bot />, color: "linear-gradient(135deg,#10b981,#22d3ee)", label: "智能体" },
  safety: { icon: <Shield />, color: "linear-gradient(135deg,#ef4444,#f97316)", label: "安全" },
  reasoning: { icon: <Brain />, color: "linear-gradient(135deg,#ec4899,#8b5cf6)", label: "推理陷阱" },
  domain: { icon: <Stethoscope />, color: "linear-gradient(135deg,#f59e0b,#ef4444)", label: "专业领域" },
  benchmark: { icon: <Trophy />, color: "linear-gradient(135deg,#fbbf24,#f59e0b)", label: "基准" },
  custom: { icon: <Layers />, color: "linear-gradient(135deg,#64748b,#475569)", label: "自定义" },
};

export function StatusBadge({ run }: { run: Pick<RunSummary, "status" | "done" | "total"> }) {
  if (run.status === "completed") return <Badge kind="ok">已完成</Badge>;
  if (run.status === "running" || run.status === "queued")
    return (
      <Badge kind="info">
        运行中 {run.total ? pct((run.done ?? 0) / run.total, 0) : ""}
      </Badge>
    );
  if (run.status === "cancelled") return <Badge>已取消</Badge>;
  return <Badge kind="bad">失败</Badge>;
}

export function RunDialog({ suite, onClose }: { suite: Suite | null; onClose: () => void }) {
  const { health, toast } = useApp();
  const [temperature, setTemperature] = useState(1);
  const [compare, setCompare] = useState(false);
  const [limit, setLimit] = useState<string>("");
  const [busy, setBusy] = useState(false);
  if (!suite) return null;
  const start = async () => {
    setBusy(true);
    try {
      const run = await api.createRun({ suite_id: suite.id, temperature, compare_llm: compare, limit: limit ? Number(limit) : null });
      navigate(`/eval/runs/${run.id}`);
    } catch (e) {
      toast((e as Error).message, "bad");
      setBusy(false);
    }
  };
  return (
    <Modal open title={`运行评测 · ${suite.name}`} onClose={onClose}>
      <div className="col" style={{ gap: 18 }}>
        <div className="faint small">
          {suite.case_count} 条用例 · {Object.values(suite.kinds ?? {}).reduce((a, b) => a + (b ?? 0), 0)} 个决策。用例会以 64 条为一批提交到批量接口，结果逐批写入。
        </div>
        <div className="field">
          <div className="row between">
            <label className="label">温度 T</label>
            <b className="mono">{temperature.toFixed(2)}</b>
          </div>
          <Slider value={Math.log2(temperature)} min={-2} max={2} step={0.05} onChange={(v) => setTemperature(Math.pow(2, v))} />
          <div className="faint tiny">用 softmax(logits / T) 计算概率。报告里会同时给出在本次结果上拟合的最优温度。</div>
        </div>
        <div className="field">
          <label className="label">只跑前 N 条（可选）</label>
          <input className="input" type="number" min={1} placeholder={`全部 ${suite.case_count} 条`} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <div className="field">
          <Toggle
            on={compare}
            onChange={setCompare}
            label={
              <span>
                同时用对照大模型回答（{health?.llm.configured ? health.llm.model : "未配置"}），最多 200 条，用于比较准确率、校准和延迟
              </span>
            }
          />
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" icon={<Play />} loading={busy} onClick={start}>
            开始评测
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const FORMAT_EXAMPLE = `// JSONL：每行一个用例（与 CJ-Bench 格式一致，一个用例可以有多个问题）
{"state": "付款后没收到发票", "questions": {"dept": {"type": "choice", "instructions": "哪个部门？", "criteria": {"billing": "账单", "tech": "技术"}}}, "gold": {"dept": "billing"}, "meta": {"tag": "账单"}}

// 也可以用单问题的简写
{"state": "这家店太难吃了", "type": "score", "instructions": "情感？", "criteria": ["负面", "中性", "正面"], "answer": 0, "tag": "评论"}

// CSV 列：state,type,instructions,criteria,answer,tag
// criteria：choice 写 billing:账单|tech:技术，score 写 负面|中性|正面，noul 留空`;

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: number) => void }) {
  const { toast } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ imported: number; skipped: number; errors: string[]; suite_id: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    form.append("name", name || file.name.replace(/\.[^.]+$/, ""));
    try {
      const r = await api.importSuite(form);
      setReport(r);
      toast(`导入 ${r.imported} 条用例`, "ok");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} title="导入评测集" onClose={onClose} wide>
      <div className="grid g2" style={{ alignItems: "start" }}>
        <div className="col" style={{ gap: 14 }}>
          <div
            className={`dropzone ${over ? "over" : ""}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
          >
            <Upload />
            <b>{file ? file.name : "拖入文件，或点击选择"}</b>
            <span className="tiny">支持 .jsonl / .json / .csv，单次最多 20,000 条</span>
            <input ref={input} type="file" accept=".jsonl,.json,.csv,.txt" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="field">
            <label className="label">评测集名称</label>
            <input className="input" placeholder={file?.name.replace(/\.[^.]+$/, "") ?? "例如：线上工单抽样 10 月"} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {report ? (
            <div className="inset" style={{ padding: 14 }}>
              <div className="row" style={{ gap: 8 }}>
                <Badge kind="ok">导入 {report.imported}</Badge>
                {report.skipped > 0 && <Badge kind="warn">跳过 {report.skipped}</Badge>}
              </div>
              {report.errors.length > 0 && (
                <ul className="tiny faint" style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                  {report.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              <Button variant="primary" style={{ marginTop: 12 }} onClick={() => onDone(report.suite_id)}>
                查看评测集
              </Button>
            </div>
          ) : (
            <Button variant="primary" icon={<FileUp />} loading={busy} disabled={!file} onClick={submit}>
              导入
            </Button>
          )}
        </div>
        <div>
          <div className="label" style={{ marginBottom: 8 }}>
            文件格式
          </div>
          <CodeBlock code={FORMAT_EXAMPLE} />
        </div>
      </div>
    </Modal>
  );
}

export default function Eval() {
  useTitle("评测中心");
  const { toast } = useApp();
  const suites = useAsync(() => api.suites(), []);
  const runs = useAsync(() => api.runs(), []);
  const [runFor, setRunFor] = useState<Suite | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const active = runs.data?.some((r) => r.status === "running" || r.status === "queued");
  useInterval(runs.reload, active ? 2000 : null);

  const createEmpty = async () => {
    const name = window.prompt("新评测集的名称");
    if (!name) return;
    try {
      const s = await api.createSuite({ name });
      navigate(`/eval/suites/${s.id}`);
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  return (
    <div className="page">
      <PageHead
        eyebrow="EVALUATION · 评测中心"
        icon={<Target />}
        title={
          <>
            不只看准确率，还要看<span className="grad-text">概率可不可信</span>
          </>
        }
        desc="评测报告与 CJ-Bench 口径一致：ACC / ECE 只统计硬标签，ECE 用 15 个分箱。此外还会给出可靠性图、温度校准、选择性预测（复核预算）和混淆矩阵，可选与生成式大模型对照。"
        actions={
          <>
            <Button icon={<FolderPlus />} onClick={createEmpty}>
              新建空评测集
            </Button>
            <Button variant="primary" icon={<Upload />} onClick={() => setImportOpen(true)}>
              导入评测集
            </Button>
          </>
        }
      />

      {suites.loading && !suites.data ? (
        <div className="suite-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} h={190} r={20} />
          ))}
        </div>
      ) : (
        <div className="suite-grid stagger">
          {suites.data?.map((s) => {
            const cat = CATEGORY[s.category] ?? CATEGORY.custom;
            const total = Object.values(s.kinds ?? {}).reduce((a, b) => a + (b ?? 0), 0) || 1;
            return (
              <div key={s.id} className="card interactive suite-card" onClick={() => navigate(`/eval/suites/${s.id}`)}>
                <div className="row between">
                  <span className="suite-cat" style={{ background: cat.color }}>
                    {cat.icon}
                  </span>
                  <div className="row" style={{ gap: 4 }}>
                    {s.builtin && <Badge kind="brand">内置</Badge>}
                    <Badge>{cat.label}</Badge>
                  </div>
                </div>
                <h3>{s.name}</h3>
                <p>{s.description || "（无描述）"}</p>
                <div className="kindbar" title="题型占比：是/否 · 单选 · 评分">
                  <i style={{ width: `${((s.kinds?.noul ?? 0) / total) * 100}%` }} />
                  <i style={{ width: `${((s.kinds?.choice ?? 0) / total) * 100}%` }} />
                  <i style={{ width: `${((s.kinds?.score ?? 0) / total) * 100}%` }} />
                </div>
                <div className="suite-foot">
                  <span className="num">{s.case_count} 条用例</span>
                  <span>·</span>
                  <span className="num">{total} 个决策</span>
                  {s.last_run ? (
                    <span className="suite-acc" title={`最近一次：ECE ${pct(s.last_run.ece)}`}>
                      {pct(s.last_run.accuracy)}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Play />}
                      style={{ marginLeft: "auto" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRunFor(s);
                      }}
                    >
                      运行
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ height: 20 }} />
      <Card title="评测运行" icon={<Layers />} sub="点击查看完整报告">
        {runs.data && runs.data.length === 0 ? (
          <Empty icon={<Target />} title="还没有评测">
            点任意一个评测集右下角的「运行」开始。
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>运行</th>
                  <th>状态</th>
                  <th className="r">准确率</th>
                  <th className="r">ECE</th>
                  <th className="r">NLL</th>
                  <th className="r">决策数</th>
                  <th className="r">用时</th>
                  <th>检查点</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {runs.data?.map((r) => (
                  <tr key={r.id} className="click" onClick={() => navigate(`/eval/runs/${r.id}`)}>
                    <td>
                      <div style={{ fontWeight: 560 }}>{r.suite_name}</div>
                      <div className="faint tiny">
                        #{r.id} · T={r.config?.temperature?.toFixed(2)}
                        {r.config?.compare_llm ? " · 含大模型对照" : ""}
                      </div>
                    </td>
                    <td style={{ minWidth: 130 }}>
                      <StatusBadge run={r} />
                      {(r.status === "running" || r.status === "queued") && (
                        <div style={{ marginTop: 6 }}>
                          <Progress value={r.total ? (r.done ?? 0) / r.total : 0} />
                        </div>
                      )}
                    </td>
                    <td className="r mono">{pct(r.accuracy)}</td>
                    <td className="r mono">{pct(r.ece, 2)}</td>
                    <td className="r mono">{r.nll?.toFixed(3) ?? "—"}</td>
                    <td className="r mono">{r.total}</td>
                    <td className="r mono">{r.duration_ms ? ms(r.duration_ms) : "—"}</td>
                    <td className="mono tiny">step {r.model?.step ?? "—"}</td>
                    <td className="faint tiny">{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RunDialog suite={runFor} onClose={() => setRunFor(null)} />
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={(id) => {
          setImportOpen(false);
          navigate(`/eval/suites/${id}`);
        }}
      />
    </div>
  );
}
