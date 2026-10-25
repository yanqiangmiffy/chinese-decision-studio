import type {
  BatchResponse,
  BenchPreset,
  BenchRecord,
  CaseItem,
  DecideResult,
  DecisionRequest,
  ExplainResult,
  ExtractDecideResult,
  ExtractResult,
  Health,
  HistoryItem,
  ModelInfo,
  Overview,
  Question,
  RunDetail,
  RunResultItem,
  RunSummary,
  State,
  Suite,
  TournamentResult,
  Training,
} from "./types";

// 前端永远只请求相对路径 /api：开发期由 Vite 代理到后端，生产由 nginx 反代。
// 不要在这里写后端的绝对地址——VITE_* 变量是构建时写死进 JS 的，换环境就得重新构建。

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `请求失败（${res.status}）`;
  try {
    const data = await res.json();
    const detail = data?.detail;
    if (typeof detail === "string") message = detail;
    else if (detail?.message) message = detail.message + (detail.errors?.length ? `：${detail.errors[0]}` : "");
    else if (Array.isArray(detail) && detail[0]?.msg) message = `参数不合法：${detail[0].loc?.slice(-1)[0]} ${detail[0].msg}`;
  } catch {
    /* 响应不是 JSON，用默认文案 */
  }
  return new ApiError(res.status, message);
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method, signal };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

const get = <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal);
const post = <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>("POST", path, body, signal);

/**
 * 用 fetch + ReadableStream 消费 SSE（EventSource 只支持 GET，带不了请求体）。
 * 每解析出一个事件就回调 onEvent；收到 `data: [DONE]` 或流结束时返回。
 */
export async function streamSSE<E>(
  path: string,
  body: unknown | undefined,
  onEvent: (event: E) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? { Accept: "text/event-stream" } : { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw await parseError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    // stream: true 不能省：一个汉字 3 个字节，可能被网络分包切成两半
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") {
        await reader.cancel().catch(() => undefined);
        return;
      }
      try {
        onEvent(JSON.parse(payload) as E);
      } catch {
        /* 跳过坏帧 */
      }
    }
  }
}

export const api = {
  health: () => get<Health>("/api/health"),
  overview: () => get<Overview>("/api/overview"),
  modelInfo: () => get<ModelInfo>("/api/model/info"),
  training: () => get<Training>("/api/model/training"),
  reload: () => post<{ reloaded: boolean; checkpoint: ModelInfo["checkpoint"] }>("/api/model/reload"),

  decide: (
    body: DecisionRequest & { source?: string; title?: string; log?: boolean; compare_llm?: boolean },
    signal?: AbortSignal,
  ) => post<DecideResult>("/api/decide", body, signal),
  batch: (requests: DecisionRequest[], signal?: AbortSignal) =>
    post<BatchResponse>("/api/decide/batch", { requests }, signal),
  tournament: (
    body: { state: State; question: Question; group_size?: number; keep?: number; seed?: number },
    signal?: AbortSignal,
  ) => post<TournamentResult>("/api/decide/tournament", body, signal),
  /** 抽取：types 是 {类型名: 说明}，说明越接近训练写法越稳 */
  extract: (body: { text: string; types: Record<string, string>; threshold?: number }, signal?: AbortSignal) =>
    post<ExtractResult>("/api/extract", body, signal),
  /** 用统一模型回答决策问题：串联场景里“先判断、再抽取”的第一步 */
  extractDecide: (body: { state: State; questions: Record<string, Question> }, signal?: AbortSignal) =>
    post<ExtractDecideResult>("/api/extract/decide", body, signal),
  compile: (body: DecisionRequest) =>
    post<{
      prompt_version: string;
      questions: Record<string, { prompt: string; input_tokens: number; options: { letter: string; key: string; description: string }[] }>;
    }>("/api/decide/compile", body),
  explain: (state: State, question: Question, target?: string | null) =>
    post<ExplainResult>("/api/decide/explain", { state, question, target }),

  history: (params: { q?: string; source?: string; page?: number; size?: number }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)));
    return get<{ items: HistoryItem[]; total: number; page: number; size: number; sources: { source: string; n: number }[] }>(
      `/api/history?${qs}`,
    );
  },
  historyItem: (id: number) => get<HistoryItem>(`/api/history/${id}`),
  labelHistory: (id: number, body: { labels?: Record<string, unknown>; note?: string }) =>
    request<HistoryItem>("PATCH", `/api/history/${id}`, body),
  deleteHistory: (id: number) => request<{ ok: boolean }>("DELETE", `/api/history/${id}`),
  historyToSuite: (id: number, suiteId: number) =>
    post<{ case_id: number; suite_id: number }>(`/api/history/${id}/to-suite`, { suite_id: suiteId }),

  suites: () => get<Suite[]>("/api/suites"),
  suite: (id: number) => get<Suite>(`/api/suites/${id}`),
  createSuite: (body: { name: string; description?: string }) => post<Suite>("/api/suites", body),
  updateSuite: (id: number, body: Partial<Pick<Suite, "name" | "description" | "tags">>) =>
    request<Suite>("PATCH", `/api/suites/${id}`, body),
  deleteSuite: (id: number) => request<{ ok: boolean }>("DELETE", `/api/suites/${id}`),
  importSuite: (form: FormData) =>
    post<{ suite_id: number; imported: number; skipped: number; errors: string[] }>("/api/suites/import", form),
  cases: (suiteId: number, page = 1, size = 20) =>
    get<{ items: CaseItem[]; total: number; page: number; size: number }>(
      `/api/suites/${suiteId}/cases?page=${page}&size=${size}`,
    ),
  addCase: (suiteId: number, body: Omit<CaseItem, "id" | "suite_id">) => post<CaseItem>(`/api/suites/${suiteId}/cases`, body),
  deleteCase: (id: number) => request<{ ok: boolean }>("DELETE", `/api/cases/${id}`),

  runs: (suiteId?: number) => get<RunSummary[]>(`/api/runs${suiteId ? `?suite_id=${suiteId}` : ""}`),
  run: (id: number) => get<RunDetail>(`/api/runs/${id}`),
  createRun: (body: { suite_id: number; name?: string; temperature: number; compare_llm: boolean; limit?: number | null }) =>
    post<RunSummary>("/api/runs", body),
  cancelRun: (id: number) => post<{ ok: boolean }>(`/api/runs/${id}/cancel`),
  deleteRun: (id: number) => request<{ ok: boolean }>("DELETE", `/api/runs/${id}`),
  runResults: (id: number, params: { filter?: string; kind?: string; tag?: string; sort?: string; page?: number; size?: number }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)));
    return get<{ items: RunResultItem[]; total: number; page: number; size: number }>(`/api/runs/${id}/results?${qs}`);
  },

  benchPresets: () => get<BenchPreset[]>("/api/bench/presets"),
  benchHistory: () => get<BenchRecord[]>("/api/bench/history"),
  deleteBench: (id: number) => request<{ ok: boolean }>("DELETE", `/api/bench/history/${id}`),
};
