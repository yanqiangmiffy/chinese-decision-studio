// 与后端 / 决策服务的契约。决策响应格式与 hmm / System One 一致。

export type Kind = "noul" | "choice" | "score";

export interface Question {
  type: Kind;
  instructions: string;
  criteria?: Record<string, string> | string[] | { false?: string; true?: string };
}

export type State = string | Record<string, unknown> | unknown[];

export interface DecisionRequest {
  state: State;
  questions: Record<string, Question>;
}

export interface Answer {
  type: Kind;
  probabilities: Record<string, number>;
  confidence: number;
  noul?: number;
  choice?: string;
  score?: number;
  legend?: Record<string, string>;
  logits?: Record<string, number>;
  input_tokens?: number;
}

export interface DecisionResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
}

export interface LLMAnswer {
  model: string;
  prediction: string;
  probabilities: number[];
  latency_ms: number;
  method: "logprobs" | "text";
  raw: string;
  error?: string;
}

export interface DecideResult {
  response: DecisionResponse;
  log_id: number | null;
  llm: Record<string, LLMAnswer> | null;
}

export interface BatchResponse {
  model: string;
  results: (DecisionResponse | { error: string })[];
  usage: { input_tokens: number; output_tokens: number };
  decisions: number;
  latency_ms: number;
}

export interface Health {
  status: string;
  app: string;
  version: string;
  database: boolean;
  decision: {
    base_url: string;
    online: boolean;
    step?: number;
    temperature?: number;
    calibrated?: boolean;
    rtt_ms?: number;
    model?: string;
  };
  llm: { configured: boolean; online: boolean; model: string | null };
  can_reload: boolean;
}

export interface MetricGroup {
  n: number;
  hard_n: number;
  accuracy: number | null;
  ece: number | null;
  hard_nll?: number | null;
  distribution_nll?: number | null;
  nll?: number | null;
  brier: number | null;
  soft_n?: number;
}

export interface ModelInfo {
  model: string;
  version: string;
  prompt_version: string;
  limits: { max_length: number; max_questions: number; max_candidates: number; max_batch_requests: number };
  checkpoint: {
    base: string;
    adapter: string | null;
    step: number | null;
    selection_metric: string | null;
    selection_value: number | null;
    temperature: number;
    calibrated: boolean;
    max_length: number;
    loaded_at: string;
    load_seconds: number;
  };
  validation: Record<string, MetricGroup>;
  engine: { token_budget: number; max_batch: number; max_wait_ms: number };
  stats: {
    requests: number;
    decisions: number;
    input_tokens: number;
    batches: number;
    forward_passes: number;
    errors: number;
    uptime_s: number;
    queue_depth: number;
    latency_p50_ms: number | null;
    latency_p95_ms: number | null;
    latency_p99_ms: number | null;
    avg_forward_batch: number | null;
    forward_p50_ms: number | null;
    compile_p50_ms: number | null;
    recent_forwards: { items: number; padded_len: number; ms: number }[];
  };
  gpu: {
    name: string;
    physical_index: string;
    memory_allocated_mb: number;
    memory_reserved_mb: number;
    device_free_mb: number;
    device_total_mb: number;
  } | null;
  latest_best_step: number | null;
}

export interface Training {
  available: boolean;
  status?: string;
  step?: number;
  examples_seen?: number;
  epoch_examples?: number;
  progress?: number;
  world_size?: number;
  updated_at?: string;
  best?: { step: number; metric: string; value: number };
  latest_eval?: Record<string, MetricGroup>;
  trained_by_stratum?: Record<string, number>;
  config?: Record<string, unknown>;
}

export interface Overview {
  decision: ModelInfo | null;
  training: Training | null;
  llm: { configured: boolean; online: boolean; model: string | null };
  platform: {
    decisions_total: number;
    decisions_14d: { day: string; n: number }[];
    latency_p50_ms: number | null;
    suites: number;
    cases: number;
    runs: number;
    best_bench: { decisions_per_s: number; concurrency: number; p50: number; created_at: string } | null;
  };
  recent_runs: RunSummary[];
}

export interface HistoryItem {
  id: number;
  source: string;
  title: string;
  state: State;
  questions: Record<string, Question>;
  answers: Record<string, Answer>;
  latency_ms: number;
  input_tokens: number;
  model_step: number | null;
  labels: Record<string, unknown>;
  note: string;
  created_at: string;
}

export interface Suite {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  builtin: boolean;
  created_at: string;
  updated_at: string;
  case_count?: number;
  kinds?: Partial<Record<Kind, number>>;
  last_run?: { id: number; accuracy: number | null; ece: number | null; created_at: string } | null;
}

export interface CaseItem {
  id: number;
  suite_id: number;
  external_id: string;
  state: State;
  questions: Record<string, Question>;
  gold: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  accuracy: number | null;
  confidence: number | null;
}

export interface GroupReport {
  n: number;
  hard_n: number;
  accuracy: number | null;
  ece: number | null;
  nll: number | null;
  brier: number | null;
  score_n?: number;
  score_mae?: number | null;
  reliability?: ReliabilityBin[];
}

export interface SelectivePoint {
  threshold: number;
  coverage: number;
  accuracy: number | null;
  kept: number;
  errors_kept: number;
}

export interface RunMetrics {
  overall: GroupReport;
  by_kind: Partial<Record<Kind, GroupReport>>;
  by_tag: Record<string, GroupReport>;
  selective: SelectivePoint[];
  budgets: Record<string, SelectivePoint | null>;
  histogram: { lo: number; hi: number; correct: number; wrong: number }[];
  calibration: {
    temperature: number;
    n: number;
    before: { accuracy: number; ece: number; nll: number; brier: number };
    after: { accuracy: number; ece: number; nll: number; brier: number };
    reliability_after: ReliabilityBin[];
  } | null;
  confusion: { question: string; kind: Kind; keys: string[]; n: number; matrix: number[][] }[];
  llm: {
    model: string;
    n: number;
    agreement: number;
    decision: GroupReport;
    llm: GroupReport;
    llm_latency_p50_ms: number;
    llm_latency_p95_ms: number;
  } | null;
  throughput: { decisions: number; seconds: number };
}

export interface RunSummary {
  id: number;
  suite_id?: number | null;
  suite_name: string;
  name: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  config?: { temperature: number; compare_llm: boolean; limit: number | null };
  model?: { step?: number; adapter?: string; prompt_version?: string };
  total: number;
  done?: number;
  errors?: number;
  error?: string;
  duration_ms?: number;
  created_at: string;
  finished_at?: string | null;
  accuracy: number | null;
  ece: number | null;
  nll?: number | null;
}

export interface RunDetail extends RunSummary {
  metrics: RunMetrics | Record<string, never>;
}

export interface RunResultItem {
  id: number;
  case_id: number;
  question: string;
  kind: Kind;
  keys: string[];
  target: number[];
  logits: number[];
  probabilities: number[];
  prediction: string;
  hard: boolean;
  correct: boolean | null;
  p_max: number;
  confidence: number;
  tag: string;
  llm: LLMAnswer | null;
  error: string;
  state: State | null;
  question_body: Question | null;
  gold: unknown;
}

export interface BenchTick {
  type: "tick" | "level";
  level: number;
  concurrency: number;
  elapsed_s: number;
  done: number;
  errors: number;
  total: number;
  rps: number;
  rps_window: number;
  decisions_per_s: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  window_p50: number | null;
  mean: number | null;
  max: number | null;
  final: boolean;
  histogram?: { lo: number; hi: number; n: number }[];
  error_samples?: string[];
}

export interface BenchPreset {
  id: string;
  label: string;
  body: DecisionRequest;
}

export interface BenchRecord {
  id: number;
  name: string;
  config: { label: string; levels: number[]; total: number; questions: number; sweep: boolean };
  summary: { levels: BenchTick[]; best: BenchTick | null; engine: Record<string, number | null> };
  created_at: string;
}

export interface ExplainResult {
  kind: Kind;
  target: string | null;
  metric: "probability" | "expected_score";
  base: Answer;
  base_value: number;
  segments: { text: string; delta: number; value: number | null; winner?: string; flipped: boolean }[];
  structured: boolean;
  latency_ms: number;
  decisions: number;
}

export interface RobustVariant {
  label: string;
  probabilities: Record<string, number>;
  winner: string;
  value: number;
  delta: number;
  agree: boolean;
  [extra: string]: unknown;
}

export interface RobustTest {
  type: "test";
  test: "order" | "naming" | "distractor" | "injection" | "paraphrase";
  variants: RobustVariant[];
  consistency: number;
  max_delta: number;
  mean_delta: number;
  score: number;
  verdict: "robust" | "drift" | "sensitive";
  base_value: number;
  base_winner: string;
  position_mass?: number[];
  position_winner_rate?: number[];
  mean_lift?: number;
  hijacked?: number;
}
