import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function readSecret(envName: string, fileEnvName: string): string {
  const filePath = process.env[fileEnvName];
  if (filePath && existsSync(filePath)) {
    try {
      return readFileSync(filePath, "utf-8").trim();
    } catch (e) {
      console.warn(
        `[config] Failed to read ${fileEnvName}=${filePath}: ${String(e)}`
      );
    }
  }
  return process.env[envName] ?? "";
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

  backendMode: resolveBackendMode(),

  openaiBaseUrl: process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1",
  openaiApiKey: readSecret("OPENAI_API_KEY", "OPENAI_API_KEY_FILE"),
  openaiDefaultModel: process.env.OPENAI_DEFAULT_MODEL ?? "gpt-5.4-mini",

  mockLlmBaseUrl: process.env.MOCK_LLM_BASE_URL ?? "http://mock-llm:9001/v1",

  openclawBaseUrl: process.env.OPENCLAW_BASE_URL ?? "http://openclaw:18789",
  openclawToken: readSecret("OPENCLAW_TOKEN", "OPENCLAW_TOKEN_FILE"),
  openclawTimeoutMs: Number(process.env.OPENCLAW_TIMEOUT_MS ?? "120000"),

  workspaceRoot: required("WORKSPACE_ROOT", "/workspaces"),
} as const;