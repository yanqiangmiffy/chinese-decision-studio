import { BarChart3, Headphones, LayoutGrid, Play, Quote, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../api";
import { Donut } from "../../components/charts";
import { Badge, Button, Card, Progress } from "../../components/ui";
import { useApp } from "../../hooks/useApp";
import { ms } from "../../lib/format";
import type { Answer, Question } from "../../types";

const PRODUCT = "声澜 X1 头戴式降噪耳机";

const ASPECTS: { key: string; label: string }[] = [
  { key: "sound", label: "音质" },
  { key: "anc", label: "降噪" },
  { key: "battery", label: "续航" },
  { key: "comfort", label: "佩戴舒适" },
  { key: "price", label: "价格" },
  { key: "logistics", label: "物流包装" },
  { key: "service", label: "客服售后" },
];

const QUESTIONS: Record<string, Question> = {
  sentiment: { type: "score", instructions: "这条评论的整体情感？", criteria: ["负面", "中性或褒贬参半", "正面"] },
  ...Object.fromEntries(
    ASPECTS.map((a) => [
      a.key,
      { type: "choice", instructions: `评论对“${a.label}”的评价是？`, criteria: { none: "没有提到", neg: "负面评价", pos: "正面评价" } } as Question,
    ]),
  ),
};

const REVIEWS = [
  "降噪效果真的惊艳，地铁上基本听不到报站，音质也很通透。",
  "戴了两个小时耳朵就压得疼，头围大的慎买。",
  "续航很顶，一周充一次电，通勤党狂喜。",
  "这个价位能有这样的降噪，性价比很高了。",
  "快递隔天就到，包装很精致，送人很有面子。",
  "低音有点糊，人声也不够清晰，对不起这个价格。",
  "降噪开了之后有轻微的耳压感，不过效果确实好。",
  "客服态度很好，耳机连接有问题帮我远程解决了。",
  "用了一个月右耳没声音了，售后让我寄回去等两周，体验很差。",
  "音质中规中矩吧，主要是买来降噪的，这方面没让我失望。",
  "盒子被压坏了，好在耳机没事。",
  "头梁有点紧，夏天戴着闷热出汗。",
  "1999 买的，第二天降价 300，客服说不能保价，无语。",
  "通透模式很自然，开会的时候很方便。",
  "续航没有宣传的 40 小时，开降噪大概 25 个小时左右。",
  "做工扎实，耳罩是蛋白皮的，很软很舒服。",
  "和朋友的某大牌对比了一下，降噪不相上下，价格便宜一半。",
  "蓝牙偶尔断连，不知道是不是我手机的问题。",
  "音质很棒，听古典乐层次感很好，解析力不错。",
  "物流太慢了，等了一个星期才到。",
  "颜值很高，银色款很有质感。",
  "戴久了有点压头顶，其他都还好。",
  "降噪在飞机上效果一般，发动机的低频还是能听到不少。",
  "售后换新很快，三天就收到了新的，点赞。",
  "充电 10 分钟能听 3 小时，快充很实用。",
  "价格偏贵，等活动再入会更划算。",
  "音质偏暖，长时间听不累耳朵，很喜欢。",
  "客服回复很慢，问个问题等了半天。",
  "整体满意，降噪、音质、续航都在线。",
  "佩戴很舒适，戴一整天也不难受，眼镜党友好。",
  "包装里没有收纳包，这个价位有点说不过去。",
  "风噪处理得不好，骑车的时候风声很大。",
  "听歌很舒服，就是有点重，脖子挂着不太方便。",
  "618 入手价格很香，比实体店便宜不少。",
  "降噪太强了，在家里戴着都听不到敲门声，哈哈。",
  "用了三个月耳罩开始掉皮，质量堪忧。",
];

interface Row {
  sentiment: number;
  aspects: Record<string, "none" | "neg" | "pos">;
}

export default function ReviewInsights() {
  const { toast } = useApp();
  const [rows, setRows] = useState<(Row | null)[]>(Array(REVIEWS.length).fill(null));
  const [revealed, setRevealed] = useState(0);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<{ ms: number; decisions: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setRows(Array(REVIEWS.length).fill(null));
    setRevealed(0);
    try {
      const r = await api.batch(REVIEWS.map((text) => ({ state: { 商品: PRODUCT, 评论: text }, questions: QUESTIONS })));
      const parsed = r.results.map((res) => {
        if (!("answers" in res)) return null;
        const a = res.answers as Record<string, Answer>;
        return {
          sentiment: a.sentiment.score ?? 1,
          aspects: Object.fromEntries(ASPECTS.map((x) => [x.key, (a[x.key].choice ?? "none") as "none" | "neg" | "pos"])),
        } as Row;
      });
      setRows(parsed);
      setStats({ ms: r.latency_ms, decisions: r.decisions });
      // 逐个点亮，让"批量处理"看得见
      let k = 0;
      const t = window.setInterval(() => {
        k += 2;
        setRevealed(k);
        if (k >= REVIEWS.length) window.clearInterval(t);
      }, 35);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setRunning(false);
    }
  };

  const done = rows.filter(Boolean) as Row[];
  const agg = useMemo(
    () =>
      ASPECTS.map((a) => ({
        ...a,
        pos: done.filter((r) => r.aspects[a.key] === "pos").length,
        neg: done.filter((r) => r.aspects[a.key] === "neg").length,
      })),
    [done],
  );
  const maxCount = Math.max(1, ...agg.map((a) => Math.max(a.pos, a.neg)));
  const pos = done.filter((r) => r.sentiment > 1.4).length;
  const neg = done.filter((r) => r.sentiment < 0.6).length;
  const mid = done.length - pos - neg;
  const cls = (r: Row | null) => (!r ? "" : r.sentiment > 1.4 ? "pos" : r.sentiment < 0.6 ? "neg" : "mid");
  const quotes = focus
    ? REVIEWS.map((t, i) => ({ t, r: rows[i] })).filter((x) => x.r && x.r.aspects[focus] !== "none")
    : [];

  return (
    <div className="col" style={{ gap: 18 }}>
      <Card
        title={PRODUCT}
        icon={<Headphones />}
        sub={`${REVIEWS.length} 条评论 × ${Object.keys(QUESTIONS).length} 个问题（整体情感 + 7 个方面）`}
        actions={
          <Button variant="primary" icon={<Play />} loading={running} onClick={run}>
            {stats ? "重新分析" : "分析全部评论"}
          </Button>
        }
      >
        {stats ? (
          <div className="row wrap" style={{ gap: 18 }}>
            <div className="row" style={{ gap: 8 }}>
              <Zap size={16} color="var(--warn)" />
              <b className="num">{stats.decisions}</b> 次决策
            </div>
            <div>
              用时 <b className="num">{ms(stats.ms)}</b>
            </div>
            <div>
              吞吐 <b className="num">{Math.round(stats.decisions / (stats.ms / 1000))}</b> 决策/秒
            </div>
            <span className="faint small">一次批量请求，服务端自动按 token 预算拼 batch；生成式大模型逐条处理同样的量通常需要几分钟。</span>
          </div>
        ) : (
          <div className="faint small">点击右上角按钮，用一次批量请求把所有评论交给决策模型。</div>
        )}
        {running && (
          <div style={{ marginTop: 12 }}>
            <Progress value={0} indeterminate />
          </div>
        )}
      </Card>

      {done.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)" }}>
          <Card title="整体情感" icon={<BarChart3 />}>
            <div className="row" style={{ gap: 26, justifyContent: "center" }}>
              <Donut
                size={170}
                parts={[
                  { label: "正面", value: pos, color: "#34d399" },
                  { label: "中性", value: mid, color: "#fbbf24" },
                  { label: "负面", value: neg, color: "#fb7185" },
                ]}
              >
                <div>
                  <div style={{ fontSize: 28, fontWeight: 760 }} className="num">
                    {Math.round((pos / done.length) * 100)}%
                  </div>
                  <div className="faint tiny">好评率</div>
                </div>
              </Donut>
              <div className="col" style={{ gap: 10 }}>
                <Badge kind="ok">正面 {pos}</Badge>
                <Badge kind="warn">中性 / 褒贬参半 {mid}</Badge>
                <Badge kind="bad">负面 {neg}</Badge>
              </div>
            </div>
          </Card>
          <Card title="方面 × 情感" icon={<LayoutGrid />} sub="点击一个方面，筛出相关评论">
            <div className="diverge">
              <div className="diverge-row" style={{ cursor: "default" }}>
                <span className="faint tiny" style={{ textAlign: "right" }}>
                  负面
                </span>
                <span />
                <span className="faint tiny">正面</span>
              </div>
              {agg.map((a) => (
                <div key={a.key} className={`diverge-row ${focus === a.key ? "on" : ""}`} onClick={() => setFocus(focus === a.key ? null : a.key)}>
                  <div className="diverge-neg">
                    {a.neg > 0 && a.neg}
                    <i style={{ width: `${(a.neg / maxCount) * 100}%` }} />
                  </div>
                  <span className="lbl">{a.label}</span>
                  <div className="diverge-pos">
                    <i style={{ width: `${(a.pos / maxCount) * 100}%` }} />
                    {a.pos > 0 && a.pos}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {focus && (
        <Card title={`关于“${ASPECTS.find((a) => a.key === focus)?.label}”的评论`} icon={<Quote />}>
          <div className="col" style={{ gap: 6 }}>
            {quotes.map(({ t, r }) => (
              <div key={t} className="row small" style={{ gap: 8 }}>
                <span className={`aspect-tag ${r!.aspects[focus]}`}>{r!.aspects[focus] === "pos" ? "好评" : "差评"}</span>
                {t}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="rv-grid">
        {REVIEWS.map((text, i) => {
          const r = i < revealed ? rows[i] : null;
          const dim = focus && r && r.aspects[focus] === "none";
          return (
            <div key={i} className={`rv ${cls(r)} ${running ? "pending" : ""} ${dim ? "dim" : ""}`}>
              {text}
              {r && (
                <div className="rv-tags">
                  {ASPECTS.filter((a) => r.aspects[a.key] !== "none").map((a) => (
                    <span key={a.key} className={`aspect-tag ${r.aspects[a.key]}`}>
                      {a.label}
                      {r.aspects[a.key] === "pos" ? "+" : "−"}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
