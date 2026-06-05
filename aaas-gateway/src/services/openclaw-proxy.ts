import { request } from "undici";
import { config } from "../config.js";
import type { ResolvedRequestContext } from "../types.js";

export interface OpenClawResponse {
  status: number;
  body: unknown;
  container_id?: string;
  tool_calls?: number;
  tool_calls_detail?: string;
  /** 실제로 응답을 만든 백엔드 이름 */
  backend?: "openai" | "mock" | "openclaw";
}

interface BackendCallResult {
  status: number;
  body: unknown;
  containerId?: string;
  toolCalls?: { count?: number; detail?: string };
}

// ─── Backend 1: OpenAI 직접 호출 ──────────────────────────
async function callOpenAI(ctx: ResolvedRequestContext): Promise<BackendCallResult> {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  const url = `${config.openaiBaseUrl}/chat/completions`;
  const model = ctx.agent_id?.startsWith("gpt-") ? ctx.agent_id : config.openaiDefaultModel;

  const upstreamBody = {
    model,
    messages: [{ role: "user", content: ctx.input }],
  };

  const res = await request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify(upstreamBody),
    bodyTimeout: config.openclawTimeoutMs,
    headersTimeout: config.openclawTimeoutMs,
  });

  const text = await res.body.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {}

  return { status: res.statusCode, body: parsed };
}

// ─── Backend 2: Mock LLM 호출 ────────────────────────────
async function callMockLlm(ctx: ResolvedRequestContext): Promise<BackendCallResult> {
  const url = `${config.mockLlmBaseUrl}/chat/completions`;
  const upstreamBody = {
    model: ctx.agent_id,
    messages: [{ role: "user", content: ctx.input }],
  };

  const res = await request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-aaas-user-id": ctx.user.id,
      "x-aaas-workspace": ctx.user.workspace_path,
      "x-aaas-auth-profile": ctx.user.auth_profile_id,
      "x-aaas-request-id": ctx.request_id,
    },
    body: JSON.stringify(upstreamBody),
    bodyTimeout: config.openclawTimeoutMs,
    headersTimeout: config.openclawTimeoutMs,
  });

  const text = await res.body.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {}

  return { status: res.statusCode, body: parsed };
}

// ─── Backend 3: OpenClaw (WebSocket — 추후 구현) ──────────
async function callOpenClaw(ctx: ResolvedRequestContext): Promise<BackendCallResult> {
  const url = `${config.openclawBaseUrl}/v1/chat/completions`;
  const upstreamBody = {
    model: "openclaw",
    messages: [{ role: "user", content: ctx.input }],
  };

  const res = await request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.openclawToken}`,
      "x-aaas-user-id": ctx.user.id,
      "x-aaas-workspace": ctx.user.workspace_path,
    },
    body: JSON.stringify(upstreamBody),
    bodyTimeout: config.openclawTimeoutMs,
    headersTimeout: config.openclawTimeoutMs,
  });

  const text = await res.body.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch {}

  return { status: res.statusCode, body: parsed };
}

// ─── 라우터: 모드별 + auto에서 fallback ───────────────────
export async function proxyToOpenClaw(
  ctx: ResolvedRequestContext
): Promise<OpenClawResponse> {
  const mode = config.backendMode;

  // 명시적 모드
  if (mode === "openai") {
    const r = await callOpenAI(ctx);
    return { ...r, backend: "openai", container_id: r.containerId, tool_calls: r.toolCalls?.count, tool_calls_detail: r.toolCalls?.detail };
  }
  if (mode === "mock") {
    const r = await callMockLlm(ctx);
    return { ...r, backend: "mock", container_id: r.containerId, tool_calls: r.toolCalls?.count, tool_calls_detail: r.toolCalls?.detail };
  }
  if (mode === "openclaw") {
    const r = await callOpenClaw(ctx);
    return { ...r, backend: "openclaw", container_id: r.containerId, tool_calls: r.toolCalls?.count, tool_calls_detail: r.toolCalls?.detail };
  }

  // auto: OpenAI(키 있으면) → Mock LLM 순으로 fallback
  if (config.openaiApiKey) {
    try {
      const r = await callOpenAI(ctx);
      if (r.status >= 200 && r.status < 300) {
        return { ...r, backend: "openai", container_id: r.containerId, tool_calls: r.toolCalls?.count, tool_calls_detail: r.toolCalls?.detail };
      }
      // OpenAI가 4xx/5xx면 Mock로 fallback
      console.error(`[proxy] OpenAI returned ${r.status}, falling back to Mock LLM`);
    } catch (e) {
      console.error(`[proxy] OpenAI call failed: ${String(e)}, falling back to Mock LLM`);
    }
  }
  const r = await callMockLlm(ctx);
  return { ...r, backend: "mock", container_id: r.containerId, tool_calls: r.toolCalls?.count, tool_calls_detail: r.toolCalls?.detail };
}