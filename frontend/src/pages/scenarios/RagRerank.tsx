import { ArrowDown, ArrowUp, Ban, CheckCircle2, FileSearch, Minus, Play, Quote, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { Badge, Button, Card, Segmented, Spinner } from "../../components/ui";
import { useApp } from "../../hooks/useApp";
import { pct } from "../../lib/format";
import type { Answer, Question } from "../../types";
import { LatChip } from "./shared";

const RELEVANT: Question = { type: "noul", instructions: "这段材料是否包含回答该问题所需的关键信息？" };
const CITE: Question = {
  type: "choice",
  instructions: "引用的段落与结论是什么关系？",
  criteria: { support: "段落支持该结论", contradict: "段落与该结论矛盾", insufficient: "段落不足以判断该结论" },
};

interface Query {
  q: string;
  passages: { text: string; bm25: number }[];
  claims: { claim: string; passage: number; gold: "support" | "contradict" | "insufficient"; note?: string }[];
}

const QUERIES: Query[] = [
  {
    q: "入职满两年的员工有几天年假？",
    passages: [
      { text: "年假是员工的法定权利，公司鼓励员工合理安排休假，劳逸结合。", bm25: 12.4 },
      { text: "员工请年假需提前 3 个工作日在 OA 系统提交申请，经直属上级审批后生效。", bm25: 11.9 },
      { text: "未休完的年假可顺延至次年第一季度使用，逾期作废。", bm25: 10.7 },
      { text: "职工累计工作已满 1 年不满 10 年的，年休假 5 天；已满 10 年不满 20 年的，年休假 10 天；已满 20 年的，年休假 15 天。", bm25: 9.8 },
      { text: "试用期员工不享受带薪年假，转正后按入职时间折算。", bm25: 9.1 },
      { text: "公司每年组织一次团建活动，时间一般安排在第三季度。", bm25: 4.2 },
    ],
    claims: [
      { claim: "入职满两年的员工每年有 5 天年假。", passage: 3, gold: "support" },
      { claim: "入职满两年的员工每年有 10 天年假。", passage: 3, gold: "contradict", note: "数字陷阱：只把 5 天改成了 10 天。决策模型不擅长数值比较，这类核对应该交给代码。" },
      { claim: "未休完的年假可以折算成工资发放。", passage: 2, gold: "contradict" },
    ],
  },
  {
    q: "高血压患者每天吃多少盐合适？",
    passages: [
      { text: "高血压是指在未使用降压药物的情况下，收缩压≥140mmHg 和/或舒张压≥90mmHg。", bm25: 13.2 },
      { text: "长期高盐饮食会导致血压升高，是高血压的重要危险因素之一。", bm25: 12.8 },
      { text: "高血压患者应定期监测血压，按医嘱规律服药，不可自行停药。", bm25: 11.0 },
      { text: "《中国高血压防治指南》建议，高血压患者每日食盐摄入量应逐步减少至 5 克以下。", bm25: 10.6 },
      { text: "适量运动，如快走、游泳，每周 5 次、每次 30 分钟，有助于控制血压。", bm25: 7.5 },
      { text: "酱油、咸菜、加工肉制品等含有大量“隐形盐”，需要一并计算。", bm25: 7.1 },
    ],
    claims: [
      { claim: "指南建议高血压患者每天食盐不超过 5 克。", passage: 3, gold: "support" },
      { claim: "高血压患者只要按时吃药，就不需要控制盐的摄入。", passage: 1, gold: "contradict" },
      { claim: "每天游泳 30 分钟可以治愈高血压。", passage: 4, gold: "insufficient", note: "段落只说运动“有助于控制”，没说能“治愈”：考验模型能否区分“不支持”和“矛盾”。" },
    ],
  },
  {
    q: "因为质量问题退货，运费谁出？",
    passages: [
      { text: "商品签收后 7 天内，在不影响二次销售的情况下支持无理由退货。", bm25: 14.1 },
      { text: "退款将在商家确认收到退货后 1–3 个工作日内原路退回。", bm25: 12.6 },
      { text: "部分商品（如生鲜、定制类）不支持无理由退货，详见商品详情页说明。", bm25: 11.3 },
      { text: "退货时请保持商品完好，并附上发票及全部配件。", bm25: 10.9 },
      { text: "因商品质量问题产生的退货，运费由商家承担；因个人原因退货的，运费由买家自行承担。", bm25: 9.4 },
      { text: "会员用户每月可享受 3 次免费退货上门取件服务。", bm25: 8.8 },
    ],
    claims: [
      { claim: "质量问题导致的退货，运费由商家承担。", passage: 4, gold: "support" },
      { claim: "所有退货的运费都由买家承担。", passage: 4, gold: "contradict", note: "量词陷阱：“所有”与段落里的条件分情况相矛盾。" },
      { claim: "退款会在 24 小时内到账。", passage: 1, gold: "contradict", note: "数字陷阱：段落写的是 1–3 个工作日。" },
    ],
  },
];

export default function RagRerank() {
  const { toast } = useApp();
  const [qi, setQi] = useState(0);
  const [scores, setScores] = useState<number[] | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [ci, setCi] = useState(0);
  const [cite, setCite] = useState<Answer | null>(null);
  const [citeLoading, setCiteLoading] = useState(false);
  const query = QUERIES[qi];

  const run = async (index = qi) => {
    setLoading(true);
    setScores(null);
    try {
      const q = QUERIES[index];
      const r = await api.batch(q.passages.map((p) => ({ state: { 问题: q.q, 段落: p.text }, questions: { relevant: RELEVANT } })));
      setScores(r.results.map((x) => ("answers" in x ? (x.answers.relevant.noul ?? 0) : 0)));
      setLatency(r.latency_ms);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setLoading(false);
    }
  };

  const check = async (index = ci, q = query) => {
    setCiteLoading(true);
    try {
      const c = q.claims[index];
      const r = await api.decide({ state: { 结论: c.claim, 引用段落: q.passages[c.passage].text }, questions: { cite: CITE }, source: "scenario:rag" });
      setCite(r.response.answers.cite);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setCiteLoading(false);
    }
  };

  useEffect(() => {
    run(0);
    check(0, QUERIES[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const order = query.passages.map((_, i) => i);
  const reranked = scores ? [...order].sort((a, b) => scores[b] - scores[a]) : order;
  const best = scores ? Math.max(...scores) : null;
  const answerable = best !== null && best >= 0.5;

  return (
    <div className="col" style={{ gap: 18 }}>
      <Card
        title="问题"
        icon={<Search />}
        actions={
          <>
            {latency && <LatChip value={latency} label={`${query.passages.length} 段`} />}
            <Button icon={<Play />} loading={loading} onClick={() => run()}>
              重排
            </Button>
          </>
        }
      >
        <div className="row wrap" style={{ gap: 8 }}>
          {QUERIES.map((q, i) => (
            <button
              key={q.q}
              className={`chip ${qi === i ? "on" : ""}`}
              onClick={() => {
                setQi(i);
                setCi(0);
                setCite(null);
                run(i);
                check(0, QUERIES[i]);
              }}
            >
              {q.q}
            </button>
          ))}
        </div>
        {scores && (
          <div className={`verdict-banner ${answerable ? "pass" : "block"}`} style={{ marginTop: 16 }}>
            {answerable ? <CheckCircle2 /> : <Ban />}
            <div>
              <b>{answerable ? "证据充足，交给大模型生成" : "证据不足，拒答或继续检索"}</b>
              <div>
                <span>
                  最相关段落的概率为 {pct(best)}；闸门阈值 50%。{answerable ? "只把概率 ≥ 50% 的段落放进上下文。" : "宁可不答，也不让大模型基于无关材料硬编。"}
                </span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <div className="rag-cols">
        <Card title="BM25 原始排序" icon={<FileSearch />} sub="字面匹配：同主题的段落都排在前面">
          <div className="col" style={{ gap: 8 }}>
            {order.map((i) => (
              <div key={i} className={`passage ${scores && scores[i] >= 0.5 ? "good" : ""}`}>
                <span className="passage-rank">{i + 1}</span>
                <div>
                  {query.passages[i].text}
                  <div className="passage-meta">
                    <span className="mono">BM25 {query.passages[i].bm25.toFixed(1)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="决策模型重排" icon={<FileSearch />} sub="按“能否回答”的概率排序：相关 ≠ 能回答">
          {!scores ? (
            <div className="row" style={{ justifyContent: "center", padding: 60 }}>
              <Spinner />
            </div>
          ) : (
            <div className="col stagger" style={{ gap: 8 }}>
              {reranked.map((i, rank) => {
                const delta = i - rank;
                return (
                  <div key={i} className={`passage ${scores[i] >= 0.5 ? "good" : ""}`}>
                    <span className="passage-rank">{rank + 1}</span>
                    <div>
                      {query.passages[i].text}
                      <div className="passage-meta">
                        <div className="mini-prob" style={{ width: 160 }}>
                          <span>P(能回答)</span>
                          <span className="mono num">{pct(scores[i], 1)}</span>
                          <div className="bar">
                            <i style={{ width: `${scores[i] * 100}%` }} />
                          </div>
                        </div>
                        {delta > 0 ? (
                          <span className="delta-up">
                            <ArrowUp size={12} />
                            {delta}
                          </span>
                        ) : delta < 0 ? (
                          <span className="delta-down">
                            <ArrowDown size={12} />
                            {-delta}
                          </span>
                        ) : (
                          <Minus size={12} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card title="引用核查" icon={<Quote />} sub="大模型写出的结论，真的被它引用的段落支持吗？一个三选一问题就能查出幻觉引用">
        <div className="col" style={{ gap: 12 }}>
          <Segmented
            value={String(ci)}
            onChange={(v) => {
              setCi(Number(v));
              check(Number(v));
            }}
            options={query.claims.map((_, i) => ({ value: String(i), label: `结论 ${i + 1}` }))}
          />
          <div className="grid g2">
            <div className="inset" style={{ padding: 14 }}>
              <div className="faint tiny">大模型的结论</div>
              <div style={{ fontWeight: 600, marginTop: 4 }}>{query.claims[ci].claim}</div>
            </div>
            <div className="inset" style={{ padding: 14 }}>
              <div className="faint tiny">它引用的段落</div>
              <div className="small" style={{ marginTop: 4 }}>
                {query.passages[query.claims[ci].passage].text}
              </div>
            </div>
          </div>
          {cite && !citeLoading && (
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="small">
                标准答案：<b>{(CITE.criteria as Record<string, string>)[query.claims[ci].gold]}</b>
              </span>
              {cite.choice === query.claims[ci].gold ? <Badge kind="ok">模型判对</Badge> : <Badge kind="bad">模型判错</Badge>}
              {query.claims[ci].note && <span className="faint tiny">{query.claims[ci].note}</span>}
            </div>
          )}
          {citeLoading ? (
            <Spinner />
          ) : (
            cite && (
              <div className="row wrap" style={{ gap: 10 }}>
                {Object.entries(CITE.criteria as Record<string, string>).map(([k, v]) => {
                  const p = cite.probabilities[k];
                  const win = cite.choice === k;
                  return (
                    <div key={k} className="tile" style={{ flex: "1 1 200px", borderColor: win ? (k === "support" ? "rgba(52,211,153,.5)" : "rgba(251,113,133,.5)") : undefined }}>
                      <div className="row between">
                        <span className="small">{v}</span>
                        {win && <Badge kind={k === "support" ? "ok" : "bad"}>判定</Badge>}
                      </div>
                      <div className="mini-prob">
                        <span />
                        <span className="mono num">{pct(p, 1)}</span>
                        <div className="bar">
                          <i style={{ width: `${p * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </Card>
    </div>
  );
}
