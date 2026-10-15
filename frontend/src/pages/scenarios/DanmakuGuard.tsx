import { Eye, EyeOff, HelpCircle, MessageSquareWarning, Pause, Play, Send, ShieldBan, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Badge, Button, Card, Slider } from "../../components/ui";
import { useInterval } from "../../hooks/useAsync";
import { ms, pct } from "../../lib/format";
import { Link } from "../../router";
import type { Question } from "../../types";

const SHOW = "《星海远航》第 12 集 · 首播";

// 问法是在真实模型上调出来的（见设计思路）：多分类的 choice 比四个独立的是/否问题更稳；
// 给“是否提问”的 noul 写上 false / true 的含义，比只写一句问题更准。
const QUESTIONS: Record<string, Question> = {
  kind: {
    type: "choice",
    instructions: "这条直播弹幕属于哪一类？",
    criteria: {
      normal: "正常互动：感叹、夸奖、吐槽、猜测、玩梗、提问",
      spoiler: "剧透：说出了后续剧集里会发生的具体情节",
      ad: "广告引流：推广、留联系方式、引导私信或点链接",
      abuse: "辱骂攻击：侮辱、人身攻击、让别人滚",
    },
  },
  question: {
    type: "noul",
    instructions: "这条弹幕是否提出了一个需要别人回答的问题？",
    criteria: { false: "陈述、感叹、吐槽或评论", true: "提出了需要别人回答的问题" },
  },
};

const STREAM = [
  "前排！！！终于等到更新了",
  "舰长这一段太燃了吧",
  "这集 BGM 是谁写的，太好听了",
  "第 13 集里林舰长会为了救大家牺牲，提前哭了",
  "加 V：xm8899 免费领取全年会员，名额有限",
  "主播什么时候讲一下这个世界观？",
  "编剧是不是脑子有坑，写的什么垃圾剧情",
  "画面质感真的绝了",
  "有没有人知道片头曲叫什么名字？",
  "反派其实就是舰长他亲爸，原著里写得很清楚",
  "哈哈哈哈哈哈这个机器人好可爱",
  "点击主页链接，高清无删减全集免费看",
  "楼上那个说难看的是不是没长眼睛，滚出去",
  "这个星球的设定参考了哪本书啊？",
  "前方高能预警！",
  "我赌五毛，下一集主角团会分开",
  "大结局是所有人都回到了地球，原著党表示很感动",
  "这个特效放在国产剧里真的是天花板了",
  "副舰长的演员是谁？演技好好",
  "什么时候出第二季啊？",
  "垃圾演员，演得跟木头一样，赶紧退圈吧",
  "666666",
  "收徒！教你网赚日入过千，私信我",
  "这里的伏笔第 15 集才会揭开，是个大反转",
  "终于有一部能看的科幻剧了",
  "主播能不能放大一下刚才那个星图？",
  "笑死，这个台词好中二",
  "冷知识：这艘飞船的原型是航母",
  "弹幕礼仪：请勿剧透，谢谢大家",
  "你们觉得舰长和副舰长谁更厉害？",
];

const USERS = ["星河漫游者", "小熊软糖", "momo", "深空观测站", "阿杰", "不吃香菜", "夜航船", "柠檬气泡", "银河护卫", "一只咸鱼"];

type Verdict = "pass" | "blocked" | "spoiler" | "question";
interface Item {
  id: number;
  user: string;
  text: string;
  probs?: Record<string, number>;
  verdict?: Verdict;
  latency?: number;
  lane?: number;
}

// 阈值来自实测：真实的广告 / 辱骂弹幕最低 0.48，正常弹幕最高 0.28，取 0.4 留出余量
function judge(p: Record<string, number>): Verdict {
  if (p.ad >= 0.4 || p.abuse >= 0.4) return "blocked";
  if (p.spoiler >= 0.6) return "spoiler";
  if (p.question >= 0.5) return "question";
  return "pass";
}

const LANES = 8;

export default function DanmakuGuard() {
  const [items, setItems] = useState<Item[]>([]);
  const [flying, setFlying] = useState<Item[]>([]);
  const [running, setRunning] = useState(true);
  const [rate, setRate] = useState(1.5);
  const [input, setInput] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);
  const seq = useRef(0);
  const cursor = useRef(0);
  const laneFree = useRef<number[]>(Array(LANES).fill(0));

  const process = useCallback(async (text: string, user: string) => {
    const id = ++seq.current;
    setItems((x) => [{ id, user, text }, ...x].slice(0, 80));
    try {
      const r = await api.decide({ state: text, questions: QUESTIONS, log: false, source: "scenario:danmaku" });
      const { kind, question } = r.response.answers;
      const probs = { ...kind.probabilities, question: question.noul ?? question.probabilities.true };
      const verdict = judge(probs);
      // 选一条最早空出来的弹道
      const now = Date.now();
      let lane = laneFree.current.findIndex((t) => t <= now);
      if (lane < 0) lane = laneFree.current.indexOf(Math.min(...laneFree.current));
      laneFree.current[lane] = now + 2200;
      const done: Item = { id, user, text, probs, verdict, latency: r.response.latency_ms, lane };
      setItems((x) => x.map((it) => (it.id === id ? done : it)));
      if (verdict !== "blocked") setFlying((f) => [...f, done]);
    } catch {
      setItems((x) => x.filter((it) => it.id !== id));
    }
  }, []);

  useInterval(
    () => {
      const text = STREAM[cursor.current % STREAM.length];
      cursor.current++;
      process(text, USERS[cursor.current % USERS.length]);
    },
    running ? 1000 / rate : null,
  );

  // 飞出屏幕的弹幕定期清理
  useEffect(() => {
    const t = window.setInterval(() => setFlying((f) => f.slice(-30)), 5000);
    return () => window.clearInterval(t);
  }, []);

  const done = items.filter((i) => i.verdict);
  const count = (v: Verdict) => done.filter((i) => i.verdict === v).length;
  const latencies = done.map((i) => i.latency ?? 0).sort((a, b) => a - b);
  const p50 = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;
  const questions = done.filter((i) => i.verdict === "question").slice(0, 6);

  return (
    <div className="dm">
      <div className="col" style={{ gap: 14 }}>
        <div className="screen">
          <div className="screen-stars" />
          <div className="screen-planet" />
          <div className="screen-hud">
            <span className="live-badge">LIVE</span>
            <span className="screen-title">{SHOW}</span>
            <span className="grow" />
            <span className="row" style={{ gap: 5, opacity: 0.85 }}>
              <Users size={14} /> 12.8 万人在看
            </span>
          </div>
          <div className="lanes">
            {flying.map((it) => (
              <div
                key={it.id}
                className={`danmaku ${it.verdict === "question" ? "question" : ""} ${it.verdict === "spoiler" ? "spoiler" : ""}`}
                style={{ top: `${(it.lane ?? 0) * (100 / LANES)}%`, ["--dur" as string]: `${8 + (it.id % 4)}s` }}
                onAnimationEnd={() => setFlying((f) => f.filter((x) => x.id !== it.id))}
              >
                {it.text}
              </div>
            ))}
          </div>
          <div className="screen-foot">
            <span className="mono">23:41 / 46:20</span>
            <div className="screen-progress">
              <i />
            </div>
            <span>决策模型实时护卫中</span>
          </div>
        </div>
        <Card bodyClass="card-body">
          <div className="row wrap" style={{ gap: 12 }}>
            <Button variant={running ? "default" : "primary"} icon={running ? <Pause /> : <Play />} onClick={() => setRunning(!running)}>
              {running ? "暂停弹幕流" : "开始弹幕流"}
            </Button>
            <div className="row" style={{ gap: 10, width: 260 }}>
              <span className="faint small" style={{ whiteSpace: "nowrap" }}>
                速率 {rate.toFixed(1)} 条/秒
              </span>
              <Slider value={rate} min={0.5} max={6} step={0.5} onChange={setRate} />
            </div>
            <span className="grow" />
            <div className="row" style={{ gap: 8, flex: "1 1 360px" }}>
              <input
                className="input"
                placeholder="发一条弹幕试试（回车发送）"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && input.trim()) {
                    process(input.trim(), "我");
                    setInput("");
                  }
                }}
              />
              <Button
                variant="primary"
                icon={<Send />}
                disabled={!input.trim()}
                onClick={() => {
                  process(input.trim(), "我");
                  setInput("");
                }}
              >
                发送
              </Button>
            </div>
          </div>
        </Card>
        <div className="dm-stats">
          <div className="dm-stat">
            <b>{done.length}</b>
            <span>已审核</span>
          </div>
          <div className="dm-stat">
            <b className="bad">{count("blocked")}</b>
            <span>拦截（辱骂/广告）</span>
          </div>
          <div className="dm-stat">
            <b style={{ color: "#c4b5fd" }}>{count("spoiler")}</b>
            <span>剧透折叠</span>
          </div>
          <div className="dm-stat">
            <b className="warn">{count("question")}</b>
            <span>提问高亮</span>
          </div>
          <div className="dm-stat">
            <b>{ms(p50)}</b>
            <span>审核延迟 p50</span>
          </div>
        </div>
      </div>

      <div className="col" style={{ gap: 14 }}>
        <div className="inset tiny" style={{ padding: "10px 12px", lineHeight: 1.7, color: "var(--text-2)" }}>
          <b className="warn">已知短板</b>：剧透判断会被“剧透”这个字眼本身带偏（例如“请勿剧透”），也分不清“猜测”和“剧透”——这是决策模型按字面理解问题的典型表现。广告和辱骂的识别则相当可靠。可以把这些弹幕放进
          <Link to="/lab" className="linklike"> 鲁棒性实验室 </Link>
          看看换种问法会怎样。
        </div>
        <Card title="观众提问" icon={<HelpCircle />} sub="推给主播的问题">
          {questions.length ? (
            <div className="col" style={{ gap: 6 }}>
              {questions.map((q) => (
                <div key={q.id} className="qa-item">
                  <HelpCircle size={15} color="var(--warn)" style={{ flex: "none", marginTop: 3 }} />
                  <div>
                    <b>{q.user}</b>：{q.text}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="faint small">还没有提问</div>
          )}
        </Card>
        <Card
          title="审核日志"
          icon={<MessageSquareWarning />}
          sub="每条弹幕：1 个分类 + 1 个是/否，一次请求"
          actions={
            <Button size="sm" variant="ghost" icon={showBlocked ? <EyeOff /> : <Eye />} onClick={() => setShowBlocked(!showBlocked)}>
              {showBlocked ? "全部" : "只看拦截"}
            </Button>
          }
        >
          <div className="dm-log">
            {items
              .filter((i) => !showBlocked || i.verdict === "blocked" || i.verdict === "spoiler")
              .slice(0, 40)
              .map((it) => (
                <div key={it.id} className={`dm-log-item ${it.verdict ?? ""}`}>
                  <span className="dm-text">
                    <span className="faint">{it.user}：</span>
                    {it.text}
                  </span>
                  <span className="faint tiny mono">{it.latency ? ms(it.latency) : "…"}</span>
                  {it.probs && (
                    <div className="dm-flags">
                      {it.verdict === "blocked" && (
                        <Badge kind="bad" icon={<ShieldBan />}>
                          已拦截
                        </Badge>
                      )}
                      {it.verdict === "spoiler" && <Badge kind="brand">剧透折叠</Badge>}
                      {it.verdict === "question" && <Badge kind="warn">提问</Badge>}
                      {Object.entries(it.probs)
                        .filter(([k, p]) => k !== "normal" && p > 0.2)
                        .map(([k, p]) => (
                          <span key={k} className="badge">
                            {{ abuse: "辱骂", ad: "广告", spoiler: "剧透", question: "提问" }[k]} {pct(p, 0)}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
