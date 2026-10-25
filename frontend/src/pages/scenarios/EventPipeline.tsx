import { Braces, Gauge, ListTree, Play, Tags } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { EntityText, ExtractionOffline, typeColors, typesPayload, useExtractionStatus } from "../../components/extraction";
import { Badge, Button, Card, CodeBlock, Segmented, Slider } from "../../components/ui";
import { useApp } from "../../hooks/useApp";
import { EVENT_SETS, type EventSet } from "../../lib/extractionPipelines";
import { pct } from "../../lib/format";
import type { ExtractResult, Question } from "../../types";
import { LatChip, MiniProb } from "./shared";

// 事件抽取 = 两步：先判断“这句话讲了哪些事件”（每个事件类型一个是/否问题，一次请求并行），
// 再对判断为“是”的事件，用“触发词 + 论元角色”作为类型抽取。两步用的是同一份权重。
// 问法和训练时一致：第一步的问题带事件定义，第二步的角色说明带事件名（“XX”事件中，……）。

const askOf = (name: string, desc: string): Question => ({
  type: "noul",
  instructions: `这句话是否描述了“${name}”事件（${desc}）？`,
});

interface Detect {
  text: string;
  setId: EventSet["id"];
  probs: Record<string, number>;
  latency: number;
}

const unique = (xs: string[]) => [...new Set(xs)];

export default function EventPipeline() {
  const { toast } = useApp();
  const status = useExtractionStatus();
  const [setId, setSetId] = useState<EventSet["id"]>("finance");
  const [text, setText] = useState(EVENT_SETS[0].samples[0].text);
  const [threshold, setThreshold] = useState(0.4);
  const [detect, setDetect] = useState<Detect | null>(null);
  const [args, setArgs] = useState<Record<string, ExtractResult>>({});
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const asked = useRef(new Set<string>());

  const set = EVENT_SETS.find((s) => s.id === setId)!;
  const shown = EVENT_SETS.find((s) => s.id === detect?.setId) ?? set;

  const run = async (t: string, s: EventSet) => {
    if (!t.trim()) return;
    const id = ++seq.current;
    setBusy(true);
    setDetect(null);
    setArgs({});
    asked.current = new Set();
    const questions = Object.fromEntries(s.events.map((e) => [e.name, askOf(e.name, e.desc)]));
    try {
      const res = await api.extractDecide({ state: t, questions });
      if (id !== seq.current) return;
      const probs = Object.fromEntries(Object.entries(res.answers).map(([k, a]) => [k, a.noul ?? a.probabilities.true ?? 0]));
      setDetect({ text: t, setId: s.id, probs, latency: res.latency_ms });
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
    run(text, set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.ready]);

  const switchSet = (id: EventSet["id"]) => {
    const next = EVENT_SETS.find((s) => s.id === id)!;
    setSetId(id);
    setText(next.samples[0].text);
    run(next.samples[0].text, next);
  };

  const ranked = useMemo(
    () => (detect ? [...shown.events].sort((a, b) => (detect.probs[b.name] ?? 0) - (detect.probs[a.name] ?? 0)) : []),
    [detect, shown],
  );
  const hits = ranked.filter((e) => (detect?.probs[e.name] ?? 0) >= threshold);
  const hitKey = hits.map((e) => e.name).join("|");

  // 第二步：只对过了门槛的事件抽取论元；调低门槛时补抽新增的事件，已抽过的不重复请求
  useEffect(() => {
    if (!detect) return;
    const current = seq.current;
    for (const ev of hits) {
      if (asked.current.has(ev.name)) continue;
      asked.current.add(ev.name);
      api
        .extract({ text: detect.text, types: typesPayload([ev.trigger, ...ev.roles]) })
        .then((res) => current === seq.current && setArgs((a) => ({ ...a, [ev.name]: res })))
        .catch((e) => {
          asked.current.delete(ev.name);
          if (current === seq.current) toast((e as Error).message, "bad");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detect, hitKey]);

  const output = hits.map((ev) => {
    const res = args[ev.name];
    const values = (name: string) => unique((res?.entities ?? []).filter((e) => e.label === name).map((e) => e.text));
    return {
      event: ev.name,
      probability: Number((detect?.probs[ev.name] ?? 0).toFixed(3)),
      trigger: res ? values(ev.trigger.name) : "…",
      arguments: res ? Object.fromEntries(ev.roles.map((r) => [r.name, values(r.name)]).filter(([, v]) => v.length)) : "…",
    };
  });

  if (!status.ready) return <ExtractionOffline />;

  const cut = ranked.findIndex((e) => (detect?.probs[e.name] ?? 0) < threshold);

  return (
    <div className="ev">
      <div className="col" style={{ gap: 18 }}>
        <Card
          title="输入"
          icon={<Braces />}
          sub={set.desc}
          actions={<Segmented size="sm" value={setId} onChange={switchSet} options={EVENT_SETS.map((s) => ({ value: s.id, label: s.title }))} />}
        >
          <textarea className="textarea" rows={3} value={text} placeholder="粘贴一句公告或新闻…" onChange={(e) => setText(e.target.value)} />
          <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
            {set.samples.map((s) => (
              <button
                key={s.title}
                className={`chip ${text === s.text ? "on" : ""}`}
                onClick={() => {
                  setText(s.text);
                  run(s.text, set);
                }}
              >
                {s.title}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14, gap: 12 }}>
            <div className="col grow" style={{ gap: 6 }}>
              <div className="row between small">
                <span>事件门槛</span>
                <b className="mono">{pct(threshold, 0)}</b>
              </div>
              <Slider value={threshold} min={0.1} max={0.9} step={0.05} onChange={setThreshold} />
            </div>
            <Button variant="primary" icon={<Play />} loading={busy} disabled={!text.trim()} onClick={() => run(text, set)}>
              识别事件
            </Button>
          </div>
        </Card>

        <Card
          title="第一步 · 这句话讲了哪些事件"
          icon={<Gauge />}
          sub={detect ? `${shown.events.length} 个事件类型并行判断 · 过门槛 ${hits.length} 个` : "判断中…"}
          actions={detect && <LatChip value={detect.latency} />}
        >
          <div className="ev-probs">
            {ranked.map((ev, i) => (
              <div key={ev.name}>
                {i === cut && cut > 0 && <div className="ev-cut">门槛 {pct(threshold, 0)}</div>}
                <div className={`ev-prob ${i < (cut < 0 ? ranked.length : cut) ? "hit" : ""}`}>
                  <MiniProb label={ev.name} p={detect?.probs[ev.name] ?? 0} />
                </div>
              </div>
            ))}
          </div>
          {detect && hits.length === 0 && <div className="faint small" style={{ marginTop: 10 }}>没有事件过门槛：这句话没有描述该类别里的事件。</div>}
        </Card>
      </div>

      <div className="col" style={{ gap: 18 }}>
        <Card title="第二步 · 触发词与论元" icon={<Tags />} sub="对过门槛的事件，用“触发词 + 角色”抽取" actions={hits.length > 0 && <Badge kind="info">{hits.length} 个事件</Badge>}>
          {hits.length === 0 && <div className="faint small">{detect ? "没有需要抽取的事件。" : "等待第一步。"}</div>}
          {hits.map((ev) => {
            const res = args[ev.name];
            const order = [ev.trigger.name, ...ev.roles.map((r) => r.name)];
            const colors = typeColors(order);
            return (
              <div key={ev.name} className="ev-card">
                <div className="ev-card-head">
                  <b>{ev.name}</b>
                  <Badge kind="brand">{pct(detect?.probs[ev.name] ?? 0, 0)}</Badge>
                  <span className="faint tiny ellipsis">{"category" in ev ? `${ev.category} · ` : ""}{ev.desc}</span>
                </div>
                {res ? (
                  <>
                    <EntityText text={res.text} entities={res.entities} colors={colors} />
                    <div className="ev-roles">
                      {order.map((name) => {
                        const vals = res.entities.filter((e) => e.label === name);
                        return (
                          <Fragment key={name}>
                            <div className="ev-role-name" style={{ ["--c" as string]: colors[name] }}>
                              <i />
                              {name}
                            </div>
                            <div className="ev-role-vals" style={{ ["--c" as string]: colors[name] }}>
                              {vals.length ? (
                                vals.map((e) => (
                                  <span key={`${e.start}-${e.end}`} className="ex-ent">
                                    {e.text}
                                    <em className="mono">{pct(e.score, 0)}</em>
                                  </span>
                                ))
                              ) : (
                                <span className="ev-empty">—</span>
                              )}
                            </div>
                          </Fragment>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="faint small">抽取中…</div>
                )}
              </div>
            );
          })}
          {hits.length > 0 && (
            <div className="ex-note">
              触发词和公司、日期、金额这类论元比较稳；“谁是发起方 / 被收购方”这类带方向的角色会串（例如收购方和被收购方互换），需要用规则或人工复核。
            </div>
          )}
        </Card>

        <Card title="结构化输出" icon={<ListTree />} sub="两步合并后的结果，可直接入库">
          <CodeBlock code={JSON.stringify(output, null, 2)} lang="json" maxHeight={340} />
        </Card>
      </div>
    </div>
  );
}
