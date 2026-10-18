export interface ScenarioMeta {
  id: string;
  title: string;
  tagline: string;
  pattern: string;
  tags: string[];
  hue: [string, string];
  icon: string; // lucide 图标名，在 Scenarios.tsx 里映射
  desc: string;
}

// 场景都来自决策模型（System One / Jev 类模型）的公开用法：意图路由、推测式扇出、置信度门控、
// 复合评分、护栏、检索重排、Map-Reduce 批量处理、LLM 裁判。每个场景都是一个真实调用模型的小应用。
export const SCENARIOS: ScenarioMeta[] = [
  {
    id: "triage",
    title: "工单分诊台",
    tagline: "一次调用问 6 个问题，代码决定走哪条路",
    pattern: "推测式扇出 + 代码路由",
    tags: ["fan-out", "routing"],
    hue: ["#8b5cf6", "#6366f1"],
    icon: "Inbox",
    desc: "把类别、严重程度、可复现性、退款诉求、情绪和流失风险放进同一个请求——问题并行评估，多问几个几乎不增加延迟。路由逻辑写在代码里，每一步都看得见。",
  },
  {
    id: "danmaku",
    title: "弹幕护卫",
    tagline: "直播弹幕实时审核：拦截辱骂与广告，折叠剧透，高亮提问",
    pattern: "实时流 · 多标签审核",
    tags: ["realtime", "moderation"],
    hue: ["#ec4899", "#8b5cf6"],
    icon: "MessagesSquare",
    desc: "每条弹幕在显示之前先过一次决策模型：一个四分类问题 + 一个“是否提问”，几十毫秒。辱骂和广告被拦下，剧透被折叠，观众的提问被高亮给主播。问法是在真实模型上对比调出来的：多分类比四个独立的是/否更稳，给 noul 写清 false / true 的含义比只写一句问题更准。",
  },
  {
    id: "resume",
    title: "简历复合评分",
    tagline: "拆成 5 个维度分别打分，权重在代码里随时调",
    pattern: "复合评分",
    tags: ["composite", "ranking"],
    hue: ["#f59e0b", "#ef4444"],
    icon: "Users",
    desc: "不要让模型直接给一个“综合分”。把判断拆成独立维度，各自打分，再用你能控制的权重组合——换个岗位只需换一组权重，排名立刻重算。实测发现：4 档评分题几乎都落在“初步具备”，换成字面化的证据问题（“简历是否显示有带团队经验？”）后区分度大幅提高。",
  },
  {
    id: "guardrail",
    title: "LLM 护栏",
    tagline: "进出大模型的每一句话都过一道安检，带复核区间",
    pattern: "护栏 · 复核带",
    tags: ["safety", "review band"],
    hue: ["#ef4444", "#f97316"],
    icon: "ShieldAlert",
    desc: "输入侧拦提示注入、越狱和隐私泄露；输出侧查系统提示词泄露和越权承诺。每项检查有“放行 / 人工复核 / 拦截”三段阈值，复核区间的宽窄就是你的人工预算。实测发现：把“应用说明”塞进 state 反而让隐私、越权承诺等检查变差——无关上下文会干扰判断，业务边界应该写进问题本身。",
  },
  {
    id: "rag",
    title: "RAG 重排与引用核查",
    tagline: "相关 ≠ 能回答：生成之前先判断证据够不够",
    pattern: "检索重排 · 拒答闸门",
    tags: ["retrieval", "verification"],
    hue: ["#22d3ee", "#3b82f6"],
    icon: "FileSearch",
    desc: "对每个检索段落问一句“能回答这个问题吗”，按概率重排；最高分都不够就拒答。再用一个三选一问题核查引用是否真的支撑结论。",
  },
  {
    id: "agent",
    title: "智能体路由器",
    tagline: "选工具、判断要不要追问、按风险设置置信度门槛",
    pattern: "置信度门控",
    tags: ["agent", "gating"],
    hue: ["#10b981", "#22d3ee"],
    icon: "Bot",
    desc: "智能体的“快思考”层：几十毫秒选出工具，再按动作风险设不同的置信度门槛——查天气 0.5 就够，转账要 0.85，不够就先确认或追问。",
  },
  {
    id: "reviews",
    title: "评论洞察 Map-Reduce",
    tagline: "36 条评论 × 8 个问题 = 288 次决策，几秒内出报告",
    pattern: "批量 Map-Reduce",
    tags: ["batch", "analytics"],
    hue: ["#a3e635", "#10b981"],
    icon: "LayoutGrid",
    desc: "用批量接口一次提交所有评论：每条评论问情感和 7 个方面，代码汇总成方面 × 情感的热力图。百倍便宜意味着你可以把它跑在整个数据集上。",
  },
  {
    id: "intents",
    title: "客服意图大分类",
    tagline: "41 个意图一次选出：超过 26 个字母，就分组淘汰再决赛",
    pattern: "分组淘汰 · 多类别",
    tags: ["tournament", "classification"],
    hue: ["#f97316", "#eab308"],
    icon: "Trophy",
    desc: "单题每个候选对应一个字母（A–Z），训练数据最多 16 个候选。类别更多时调用决策服务的 /v1/tournament：41 个意图随机分成每组不超过 16 个，各组前 2 名进入决赛，共 4 次前向、约 150 ms，不需要重新训练。右侧能看到每组谁晋级、决赛的概率分布；决赛概率只覆盖进入决赛的候选，按置信度设门槛时要用自己的数据重新确定。",
  },
  {
    id: "judge",
    title: "LLM 裁判",
    tagline: "两个回答谁更好？交换顺序再问一次，检查位置偏差",
    pattern: "成对比较 · 一致性检查",
    tags: ["evaluation", "pairwise"],
    hue: ["#6366f1", "#ec4899"],
    icon: "Scale",
    desc: "把决策模型当作廉价裁判：成对比较、分别打分、核查事实错误。同一对回答正反两种顺序各问一次，结论不一致就交给人。",
  },
];
