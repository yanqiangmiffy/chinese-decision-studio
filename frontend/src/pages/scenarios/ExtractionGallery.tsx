import { ExternalLink, FlaskConical, ListChecks, Scale, ScanText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { DomainPicker, EntityList, EntityText, ExtractionOffline, TypeLegend, typeColors, typesPayload, useExtractionStatus } from "../../components/extraction";
import { Badge, Button, Card, Toggle } from "../../components/ui";
import { useApp } from "../../hooks/useApp";
import { CASES, checkAgainstReference, DOMAINS, handoffExtract, typesOf, type ExtractCase } from "../../lib/extractionCases";
import { navigate } from "../../router";
import type { ExtractResult } from "../../types";
import { LatChip } from "./shared";

// 案例馆：10 个领域 39 条案例，每条都用该领域训练时的类型写法（TYPE_SETS）调用抽取。
// 同一条案例还会再用“只给类型名、不给说明”问一遍，对比两种写法的召回——这是用法上最重要的一条经验。

interface Outcome {
  trained: ExtractResult;
  bare: ExtractResult | null;
}

export default function ExtractionGallery() {
  const { toast } = useApp();
  const status = useExtractionStatus();
  const [domain, setDomain] = useState<string>(DOMAINS[0].id);
  const [current, setCurrent] = useState<ExtractCase>(CASES[0]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [running, setRunning] = useState(false);
  const [showRef, setShowRef] = useState(true);
  const seq = useRef(0);

  const types = useMemo(() => typesOf(current), [current]);
  const order = types.map((t) => t.name);
  const colors = typeColors(order);

  const run = async (c: ExtractCase) => {
    const id = ++seq.current;
    setRunning(true);
    const full = typesPayload(typesOf(c));
    const bare = Object.fromEntries(Object.keys(full).map((n) => [n, ""]));
    try {
      const [trained, plain] = await Promise.all([
        api.extract({ text: c.text, types: full }),
        c.set ? api.extract({ text: c.text, types: bare }) : Promise.resolve(null),
      ]);
      if (id === seq.current) setOutcome({ trained, bare: plain });
    } catch (e) {
      if (id === seq.current) toast((e as Error).message, "bad");
    } finally {
      if (id === seq.current) setRunning(false);
    }
  };

  const pick = (c: ExtractCase) => {
    setCurrent(c);
    setOutcome(null);
    run(c);
  };

  const started = useRef(false);
  useEffect(() => {
    if (!status.ready || started.current) return; // 开发模式下 StrictMode 会执行两次
    started.current = true;
    run(CASES[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.ready]);

  const check = useMemo(
    () => (outcome && current.expect ? checkAgainstReference(outcome.trained.entities, current.expect) : null),
    [outcome, current],
  );
  const bareCheck = useMemo(
    () => (outcome?.bare && current.expect ? checkAgainstReference(outcome.bare.entities, current.expect) : null),
    [outcome, current],
  );
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    outcome?.trained.entities.forEach((e) => (out[e.label] = (out[e.label] ?? 0) + 1));
    return out;
  }, [outcome]);

  if (!status.ready) return <ExtractionOffline />;

  const list = CASES.filter((c) => c.domain === domain);
  const info = DOMAINS.find((d) => d.id === domain);

  return (
    <div className="ex-gal">
      <div className="col" style={{ gap: 18 }}>
        <Card title="案例" icon={<ListChecks />} sub={`${CASES.length} 条案例 · ${DOMAINS.length} 个领域`}>
          <DomainPicker value={domain} onChange={setDomain} />
          <p className="faint small" style={{ margin: "10px 0 12px" }}>
            {info?.desc}
          </p>
          <div className="ex-library one">
            {list.map((c) => (
              <button key={c.id} className={`ex-case ${c.id === current.id ? "on" : ""}`} onClick={() => pick(c)}>
                <div className="row between">
                  <b>{c.title}</b>
                  <span className="faint tiny">{typesOf(c).length} 个类型</span>
                </div>
                <div className="ex-case-text">{c.text}</div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="col" style={{ gap: 18 }}>
        <Card
          title={current.title}
          icon={<ScanText />}
          sub={current.set ? `类型取自 ${"训练语料"}的标准说明` : "自定义类型：训练里没有这些类型"}
          actions={
            <>
              {outcome && <LatChip value={outcome.trained.latency_ms} />}
              <Button
                size="sm"
                icon={<ExternalLink />}
                onClick={() => {
                  handoffExtract({ text: current.text, types: types.map((t) => ({ ...t })) });
                  navigate("/playground");
                }}
              >
                在实验台打开
              </Button>
            </>
          }
        >
          <EntityText text={current.text} entities={outcome?.trained.entities ?? []} colors={colors} className={running ? "ex-busy" : ""} />
          <div style={{ marginTop: 14 }}>
            <TypeLegend names={order} colors={colors} counts={outcome ? counts : undefined} />
          </div>
          {current.note && <div className="ex-note">{current.note}</div>}
        </Card>

        {outcome && (
          <Card title="按类型汇总" sub={`${outcome.trained.entities.length} 个实体`}>
            <EntityList entities={outcome.trained.entities} order={order} colors={colors} />
          </Card>
        )}

        {current.expect && (
          <Card
            title="对照参考答案"
            icon={<ListChecks />}
            sub="参考答案是人工写的，只用来看模型漏了什么、多抽了什么，不是评分"
            actions={<Toggle on={showRef} onChange={setShowRef} />}
          >
            {showRef && check && (
              <div className="col" style={{ gap: 12 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <Badge kind="ok">命中 {check.hit.length} / {current.expect.length}</Badge>
                  {check.near.length > 0 && <Badge kind="info">边界不同 {check.near.length}</Badge>}
                  {check.missed.length > 0 && <Badge kind="bad">漏抽 {check.missed.length}</Badge>}
                  {check.extra.length > 0 && <Badge kind="warn">多抽 {check.extra.length}</Badge>}
                </div>
                {([
                  ["漏抽", check.missed, "bad"],
                  ["多抽", check.extra, "warn"],
                  ["边界不同", check.near, "info"],
                ] as const).map(
                  ([label, items, kind]) =>
                    items.length > 0 && (
                      <div key={label} className="row wrap" style={{ gap: 6 }}>
                        <span className="faint tiny" style={{ width: 54 }}>
                          {label}
                        </span>
                        {items.map(([type, text], i) => (
                          <span key={i} className={`ex-diff ${kind}`}>
                            {text}
                            <em>{type}</em>
                          </span>
                        ))}
                      </div>
                    ),
                )}
              </div>
            )}
          </Card>
        )}

        {outcome?.bare && (
          <Card title="类型写法对比" icon={<Scale />} sub="同一段文本，同一组类型：给训练时的说明，还是只给类型名">
            <div className="ex-compare">
              {(
                [
                  ["训练原文说明", outcome.trained, check],
                  ["只给类型名", outcome.bare, bareCheck],
                ] as const
              ).map(([label, res, chk]) => (
                <div key={label} className="ex-compare-col">
                  <div className="row between">
                    <b>{label}</b>
                    <span className="mono small">
                      {res.entities.length} 个实体{chk && current.expect ? ` · 命中 ${chk.hit.length}/${current.expect.length}` : ""}
                    </span>
                  </div>
                  <EntityText text={res.text} entities={res.entities} colors={colors} />
                </div>
              ))}
            </div>
            <div className="faint tiny" style={{ marginTop: 10 }}>
              说明里写着类型的定义和边界（包括什么不算），模型训练时见过这些写法。没有说明时，类型名字面意思不足以区分相近的类型。
            </div>
          </Card>
        )}

        <Card title="这组类型" icon={<FlaskConical />} sub="名称 + 说明，原样发给模型">
          <div className="ex-typedoc">
            {types.map((t) => (
              <div key={t.name} className="ex-typedoc-row" style={{ ["--c" as string]: colors[t.name] }}>
                <b>
                  <i />
                  {t.name}
                </b>
                <span>{t.desc || <em className="faint">（无说明）</em>}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
