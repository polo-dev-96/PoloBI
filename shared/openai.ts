export const OPENAI_USAGE_CATEGORIES = [
  { id: "completions", label: "Conversações", model: true },
  { id: "decisions", label: "Decisions", model: true },
  { id: "embeddings", label: "Embeddings", model: true },
  { id: "moderations", label: "Moderação", model: true },
  { id: "images", label: "Imagens", model: true },
  { id: "audio_speeches", label: "Geração de áudio", model: true },
  { id: "audio_transcriptions", label: "Transcrição de áudio", model: true },
  { id: "vector_stores", label: "Armazenamento vetorial", model: false },
  { id: "code_interpreter_sessions", label: "Sessões de código", model: false },
  { id: "file_search_calls", label: "Busca em arquivos", model: false },
  { id: "web_search_calls", label: "Busca na web", model: true },
] as const;

export type OpenAIUsageCategory =
  (typeof OPENAI_USAGE_CATEGORIES)[number]["id"];
export const OPENAI_METRICS = {
  input_tokens: "Tokens de entrada",
  output_tokens: "Tokens de saída",
  input_cached_tokens: "Tokens em cache",
  num_model_requests: "Requisições de modelo",
  num_requests: "Buscas",
  images: "Imagens",
  characters: "Caracteres",
  seconds: "Segundos de áudio",
  usage_bytes: "Bytes armazenados (último dia)",
  num_sessions: "Sessões",
} as const;
export type OpenAIMetric = keyof typeof OPENAI_METRICS;
export type OpenAIMetrics = Partial<Record<OpenAIMetric, number>>;
export type OpenAIErrorCode =
  | "not_configured"
  | "invalid_key"
  | "forbidden"
  | "rate_limited"
  | "unavailable";
export interface OpenAISourceState {
  status: "ok" | "error";
  errorCode?: OpenAIErrorCode;
  message?: string;
  fetchedAt: string;
}
export interface OpenAIUsageRow {
  projectId: string | null;
  model: string | null;
  metrics: OpenAIMetrics;
}
export interface OpenAIUsageReport extends OpenAISourceState {
  id: OpenAIUsageCategory;
  label: string;
  totals: OpenAIMetrics;
  daily: { date: string; metrics: OpenAIMetrics }[];
  rows: OpenAIUsageRow[];
}
export interface OpenAIMoney {
  currency: string;
  amount: string;
}
export interface OpenAICostReport extends OpenAISourceState {
  totals: OpenAIMoney[];
  daily: { date: string; amounts: OpenAIMoney[] }[];
  rows: {
    projectId: string | null;
    lineItem: string | null;
    currency: string;
    amount: string;
  }[];
}
export interface OpenAIReport {
  startDate: string;
  endDate: string;
  projectId?: string;
  fetchedAt: string;
  costs: OpenAICostReport;
  usage: OpenAIUsageReport[];
}
export interface OpenAIRecentUsage extends OpenAISourceState {
  startTime: string;
  endTime: string;
  projectId?: string;
  totals: OpenAIMetrics;
  series: {
    startTime: string;
    endTime: string;
    partial: boolean;
    metrics: OpenAIMetrics;
  }[];
}
export interface OpenAIProject {
  id: string;
  name: string;
  status: string;
}
