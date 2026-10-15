// CJ-Bench 参考结果：Chinese Decision 为 step 5000 checkpoint 在全量测试集（307,900 条）上的结果；
// 基线数字引自 Chinese-Jev 论文 Table 1 / Table 2（Wang et al., 2026），本平台未复现。

export const DOMAINS = ["通用", "医疗", "法律", "金融"] as const;

export const BENCH_ACC = [
  { name: "Chinese Decision", color: "brand", values: [0.709, 0.8789, 0.6337, 0.7117], highlight: true },
  { name: "Chinese-Jev（G / S）", color: "#22d3ee", values: [0.692, 0.8765, 0.601, 0.6472] },
  { name: "Jev †", color: "#fbbf24", values: [0.6835, 0.8429, 0.6835, 0.7839] },
  { name: "Open-Jev", color: "#64748b", values: [0.5233, 0.7308, 0.4407, 0.4811] },
];

export const BENCH_ECE = [
  { name: "Chinese Decision", color: "brand", values: [0.0305, 0.003, 0.023, 0.0189], highlight: true },
  { name: "Chinese-Jev（G / S）", color: "#22d3ee", values: [0.0378, 0.0725, 0.1745, 0.1155] },
  { name: "Jev †", color: "#fbbf24", values: [0.1145, 0.057, 0.0803, 0.0298] },
  { name: "Open-Jev", color: "#64748b", values: [0.1054, 0.0288, 0.2315, 0.1019] },
];

export const DOMAIN_TYPE_ACC: { domain: string; values: [number, number, number] }[] = [
  { domain: "通用", values: [0.8683, 0.7023, 0.5408] },
  { domain: "医疗", values: [0.9764, 0.7882, 0.6509] },
  { domain: "法律", values: [0.8007, 0.5813, 0.5015] },
  { domain: "金融", values: [0.7667, 0.6208, 0.7475] },
];

export const CHECKPOINTS = [
  { step: 2000, general: 0.6904, special: 0.6834, ece: 0.0163 },
  { step: 3000, general: 0.7026, special: 0.7161, ece: 0.0125 },
  { step: 5000, general: 0.709, special: 0.7414, ece: 0.0084 },
];

export const SOURCE_LABELS: Record<string, string> = {
  c3: "C3 阅读理解",
  chid: "ChID 成语填空",
  chnsenticorp: "ChnSentiCorp 情感",
  cmrc2019: "CMRC 阅读理解",
  cnsd_mnli_translation: "CNSD-MNLI 推理",
  cped: "CPED 对话情绪",
  dianping_reviews: "大众点评评论",
  douban_dmsc: "豆瓣影评",
  dureader_yesno: "DuReader 是否题",
  ifeng_news: "凤凰新闻分类",
  jd_reviews: "京东评论",
  logiqa2: "LogiQA 逻辑推理",
  mep3m_product_catalog: "商品类目",
  pawsx_zh: "PAWS-X 复述",
  poetry_mteb: "古诗词",
  programmatic_rules: "程序化规则",
  slurp_massive: "MASSIVE 意图",
  ocnli: "OCNLI 推理",
  cmid: "CMID 医疗意图",
  chip_cdn: "CHIP 诊断标准化",
  cblue_sts: "CBLUE 语义相似",
  cblue_qqr: "CBLUE 问句相关",
  cblue_qtr: "CBLUE 词条相关",
  cmb: "CMB 医学考试",
  cmexam: "CMExam 医学考试",
  medqa_mainland: "MedQA 大陆",
  medqa_taiwan: "MedQA 台湾",
  cmedqa2: "cMedQA2 问答匹配",
  mlec_qa: "MLEC-QA 医学",
  meddg: "MedDG 医疗对话",
  empec: "EMPEC 医疗考试",
  cmnleqa: "CMNLE 医学考试",
  fintruthqa: "FinTruthQA 金融",
  cflue_knowledge: "CFLUE 金融知识",
  rolecs_finance: "金融客服对话",
  finre_original: "FinRE 金融关系",
  explicit_finance_rules: "金融规则",
  capp130: "CAIL 罪名预测",
  claimgen_cn: "金融事实核查",
  imcs21: "IMCS 医疗对话",
  lcmdc: "LCMDC 医学分类",
  appealcase: "上诉案件",
  lcr_cn: "法律案例检索",
  t2ranking: "T2Ranking 检索",
  lecard_v2: "LeCaRD 类案",
  cail2019_scm: "CAIL 相似案例",
  jec_qa: "JEC-QA 司法考试",
  lawbench: "LawBench",
  explain_cpe: "法律考试解析",
};
