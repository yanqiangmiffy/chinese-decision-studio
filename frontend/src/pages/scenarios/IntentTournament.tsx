import { Network, Send, SlidersHorizontal, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Badge, Button, Card, Slider } from "../../components/ui";
import { useApp } from "../../hooks/useApp";
import { pct } from "../../lib/format";
import type { Question, TournamentResult } from "../../types";
import { LatChip, MiniProb } from "./shared";

// 41 个电商客服意图，超过 A–Z 的 26 个字母。顺序与 chinese-decision 的 examples/tournament.json 一致：
// seed 相同则分组相同，下面 SAMPLES 的 10 条留言在 GPU 服务（0.8B step 10000）上按默认参数全部选对。
const INTENTS: [key: string, desc: string, team: string][] = [
  ["order_status", "查询订单状态或物流进度", "订单物流"],
  ["change_address", "修改收货地址", "订单物流"],
  ["cancel_order", "取消订单", "订单物流"],
  ["urge_shipping", "催促发货", "订单物流"],
  ["missing_package", "包裹丢失，或显示签收但没有收到", "订单物流"],
  ["damaged_item", "收到的商品破损", "售后"],
  ["wrong_item", "发错货、少发或漏发", "售后"],
  ["return_request", "申请退货", "售后"],
  ["exchange_request", "申请换货（尺码、颜色等）", "售后"],
  ["refund_status", "查询退款进度", "退款支付"],
  ["refund_amount_dispute", "对退款金额有异议", "退款支付"],
  ["price_protection", "降价后申请价格保护、退差价", "退款支付"],
  ["coupon_issue", "优惠券无法使用或没有到账", "退款支付"],
  ["invoice_request", "开具或修改发票", "退款支付"],
  ["payment_failed", "支付失败", "退款支付"],
  ["double_charge", "重复扣款", "退款支付"],
  ["installment", "分期付款咨询", "退款支付"],
  ["membership", "会员权益咨询", "账号会员"],
  ["points_redeem", "积分查询与兑换", "账号会员"],
  ["account_login", "无法登录账号", "账号会员"],
  ["account_security", "账号被盗或异常登录", "账号会员"],
  ["change_phone", "更换绑定手机号", "账号会员"],
  ["delete_account", "注销账号", "账号会员"],
  ["product_spec", "商品参数与规格咨询", "售前咨询"],
  ["stock_inquiry", "商品库存与到货时间", "售前咨询"],
  ["size_advice", "尺码推荐", "售前咨询"],
  ["authenticity", "怀疑商品是假货", "投诉"],
  ["warranty", "保修政策咨询", "售后"],
  ["repair_request", "申请售后维修", "售后"],
  ["installation", "预约上门安装", "售后"],
  ["quality_complaint", "商品质量投诉", "投诉"],
  ["service_complaint", "投诉客服服务态度", "投诉"],
  ["courier_complaint", "投诉快递员服务", "投诉"],
  ["delivery_time", "预约或指定送货时间", "订单物流"],
  ["self_pickup", "自提点或快递柜取件问题", "订单物流"],
  ["bulk_purchase", "企业采购与批量订购", "售前咨询"],
  ["gift_wrapping", "礼品包装与贺卡", "售前咨询"],
  ["cross_border", "跨境商品清关与税费", "售前咨询"],
  ["privacy_data", "个人信息与隐私数据", "账号会员"],
  ["human_agent", "要求转人工客服", "人工"],
  ["other", "其他问题", "人工"],
];
const DESC = Object.fromEntries(INTENTS.map(([k, d]) => [k, d]));
const TEAM = Object.fromEntries(INTENTS.map(([k, , t]) => [k, t]));
const TEAMS = [...new Set(INTENTS.map(([, , t]) => t))];

const QUESTION: Question = {
  type: "choice",
  instructions: "客户这条留言属于哪一类客服意图？",
  criteria: DESC,
};

const SAMPLES = [
  "上周买的双开门冰箱今天送到了，拆开发现侧面凹进去一大块，外包装箱也是破的，这种情况怎么处理？",
  "我想把收货地址从北京改到天津，订单还没发货。",
  "双十一买的羽绒服现在便宜了 200 块，能不能把差价退给我？",
  "别再让机器人回我了，我要找真人说话！",
  "从日本海淘的奶粉卡在海关三天了，还要我补交税费吗？",
  "新买的空调什么时候能安排师傅上门装？我这周六在家。",
  "我的账号昨晚在外地被登录了，还下了两单不是我买的东西。",
  "付款时只点了一次，银行卡却被扣了两笔 3999 元。",
  "快递显示昨天已签收，可是我家里根本没人收到包裹。",
  "公司要采购 200 台显示器，能开增值税专票吗？有没有批量价？",
];

interface Run {
  text: string;
  result?: TournamentResult;
}

export default function IntentTournament() {
  const { toast } = useApp();
  const [input, setInput] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [groupSize, setGroupSize] = useState(16);
  const [keep, setKeep] = useState(2);
  const [gate, setGate] = useState(0.5);
  const started = useRef(false);

  const send = async (text: string) => {
    if (!text.trim()) return;
    setInput("");
    setRun({ text });
    try {
      const result = await api.tournament({ state: `客户留言：${text}`, question: QUESTION, group_size: groupSize, keep });
      setRun({ text, result });
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  useEffect(() => {
    if (started.current) return; // 开发模式下 StrictMode 会执行两次
    started.current = true;
    send(SAMPLES[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeSize = (size: number) => {
    setGroupSize(size);
    setKeep((k) => Math.min(k, Math.floor(size / 2)));
  };

  const result = run?.result;
  const answer = result?.answer;
  const finalists = answer ? Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]) : [];
  const winner = answer?.choice;
  const top = finalists[0]?.[1] ?? 0;
  const status = (key: string) => (!answer ? "" : key === winner ? "win" : key in answer.probabilities ? "final" : "out");

  return (
    <div className="it">
      <div className="col" style={{ gap: 18 }}>
        <Card title="客服留言" icon={<Send />} sub={`${INTENTS.length} 个意图放在同一个单选题里，超过 A–Z 的 26 个字母`}>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder="输入一条客户留言…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
            />
            <Button variant="primary" icon={<Send />} onClick={() => send(input)} disabled={!input.trim()}>
              识别
            </Button>
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
            {SAMPLES.map((s) => (
              <button key={s} className="chip" onClick={() => send(s)} title={s}>
                {s.length > 18 ? `${s.slice(0, 18)}…` : s}
              </button>
            ))}
          </div>
        </Card>

        <Card
          title={`${INTENTS.length} 个意图`}
          icon={<Network />}
          sub={run ? `“${run.text}”` : "等待输入"}
          actions={result && <span className="faint tiny">高亮：胜出 · 描边：进入决赛 · 变暗：小组淘汰</span>}
        >
          <div className="it-teams">
            {TEAMS.map((team) => (
              <div key={team} className="it-team">
                <div className="it-team-name">{team}</div>
                <div className="it-pills">
                  {INTENTS.filter(([, , t]) => t === team).map(([k, d]) => (
                    <span key={k} className={`it-pill ${status(k)}`} title={k}>
                      {d}
                      {answer && k in answer.probabilities && <b className="mono">{pct(answer.probabilities[k], 0)}</b>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="col" style={{ gap: 18 }}>
        <Card
          title="分组淘汰"
          icon={<Trophy />}
          sub={result ? `${result.candidates} 个候选 · ${result.decisions} 次前向` : "思考中…"}
          actions={result && <LatChip value={result.latency_ms} />}
        >
          {result && (
            <>
              {result.rounds.map((round, r) => (
                <div key={r} className="it-round">
                  <div className="it-round-title">
                    <span>第 {r + 1} 轮 · {round.groups.length} 组</span>
                    <span className="faint">每组前 {result.keep} 名晋级</span>
                  </div>
                  <div className="it-groups">
                    {round.groups.map((g, i) => {
                      const ranked = Object.entries(g.probabilities).sort((a, b) => b[1] - a[1]);
                      return (
                        <div key={i} className="it-group">
                          <div className="it-group-head">
                            <span>第 {i + 1} 组</span>
                            <span className="mono">{ranked.length} 个</span>
                          </div>
                          {ranked.slice(0, Math.max(3, g.advanced.length)).map(([k, p]) => (
                            <MiniProb key={k} label={g.advanced.includes(k) ? <b>{DESC[k]}</b> : <span className="faint">{DESC[k]}</span>} p={p} />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="it-round">
                <div className="it-round-title">
                  <span>{result.rounds.length ? "决赛" : "单题（候选数不超过每组上限）"} · {finalists.length} 个候选</span>
                  <span className="faint">概率只覆盖这一轮的候选</span>
                </div>
                <div className="col" style={{ gap: 8 }}>
                  {finalists.map(([k, p]) => (
                    <MiniProb key={k} label={k === winner ? <b>{DESC[k]}</b> : DESC[k]} p={p} />
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>

        <Card title="路由" icon={<Network />} sub="意图决定转给哪个团队；决赛最高概率低于门槛就转人工复核">
          {winner && (
            <div className="col" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 8 }}>
                <Badge kind={top >= gate ? "ok" : "warn"}>{top >= gate ? "自动分派" : "人工复核"}</Badge>
                <span>
                  {top >= gate ? `→ ${TEAM[winner]}组` : "→ 人工复核队列"}（{DESC[winner]}，{pct(top, 1)}）
                </span>
              </div>
              <div className="row between small">
                <span>置信度门槛</span>
                <b className="mono">{pct(gate, 0)}</b>
              </div>
              <Slider value={gate} min={0.2} max={0.95} step={0.05} onChange={setGate} />
            </div>
          )}
        </Card>

        <Card
          title="淘汰赛参数"
          icon={<SlidersHorizontal />}
          sub="每组不超过 16 个时在训练覆盖范围内；单题最多 26 个候选"
          actions={
            run && (
              <Button size="sm" onClick={() => send(run.text)}>
                重新识别
              </Button>
            )
          }
        >
          {(
            [
              ["每组最多候选数", groupSize, 3, 26, changeSize],
              ["每组晋级名额", keep, 1, Math.floor(groupSize / 2), setKeep],
            ] as const
          ).map(([label, value, min, max, onChange]) => (
            <div key={label} className="col" style={{ gap: 6, marginBottom: 12 }}>
              <div className="row between small">
                <span>{label}</span>
                <b className="mono">{value}</b>
              </div>
              <Slider value={value} min={min} max={max} step={1} onChange={onChange} />
            </div>
          ))}
          <div className="faint tiny">
            {INTENTS.length} 个候选按每组 {groupSize} 个分成 {Math.ceil(INTENTS.length / groupSize)} 组，调整后点“重新识别”生效。
          </div>
        </Card>
      </div>
    </div>
  );
}
