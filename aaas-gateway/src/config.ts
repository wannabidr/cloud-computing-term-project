import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export type BackendMode = "auto" | "openai" | "mock" | "openclaw";

function resolveBackendMode(): BackendMode {
  const raw = (process.env.BACKEND_MODE ?? "auto").toLowerCase();
  if (raw === "openai" || raw === "mock" || raw === "openclaw") return raw;
  return "auto";
}

export const config = {
  host: required("GATEWAY_HOST", "0.0.0.0"),
  port: Number(required("GATEWAY_PORT", "8080")),
  logLevel: process.env.LOG_LEVEL ?? "info",
  tenantsFile: required("TENANTS_FILE", "./tenants.yaml"),
  logsDir: required("LOGS_DIR", "./logs"),

  // ── Backend selection ─────────────────────────────────────
  // auto: openai → mock 순으로 fallback
  // openai/mock/openclaw: 명시적 선택, 실패 시에도 fallback 안 함(--strict 처럼)
  backendMode: resolveBackendMode(),

  // ── OpenAI ────────────────────────────────────────────────
  openaiBaseUrl: process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiDefaultModel: process.env.OPENAI_DEFAULT_MODEL ?? "gpt-5.4-mini",

  // ── Mock LLM ─────────────────────────────────────────────
  mockLlmBaseUrl: process.env.MOCK_LLM_BASE_URL ?? "http://mock-llm:9001/v1",

  // ── OpenClaw (WebSocket, 추후 구현) ──────────────────────
  openclawBaseUrl: process.env.OPENCLAW_BASE_URL ?? "http://openclaw:18789",
  openclawToken: process.env.OPENCLAW_TOKEN ?? "",
  openclawTimeoutMs: Number(process.env.OPENCLAW_TIMEOUT_MS ?? "120000"),

  workspaceRoot: required("WORKSPACE_ROOT", "/workspaces"),
} as const;