import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import type { ResolvedRequestContext } from "../types.js";

interface RpcPending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: NodeJS.Timeout;
}

class OpenClawWsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, RpcPending>();
  private connecting: Promise<void> | null = null;

  private wsUrl(): string {
    return config.openclawBaseUrl.replace(/^http/, "ws") + "/";
  }

  private async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl());
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("OpenClaw WS connect timeout"));
      }, 10_000);

      ws.on("open", () => {
        clearTimeout(timer);
        ws.send(
          JSON.stringify({
            type: "connect",
            params: { auth: { token: config.openclawToken } },
          })
        );
        this.ws = ws;
        resolve();
      });

      ws.on("message", (data) => this.onMessage(data.toString()));
      ws.on("close", () => {
        this.ws = null;
        for (const [id, p] of this.pending.entries()) {
          clearTimeout(p.timer);
          p.reject(new Error("OpenClaw WS closed"));
          this.pending.delete(id);
        }
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  private onMessage(raw: string): void {
    let msg: { id?: string; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg.id) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    if (msg.error) {
      p.reject(new Error(`OpenClaw RPC error: ${JSON.stringify(msg.error)}`));
    } else {
      p.resolve(msg.result);
    }
  }

  async call(method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> {
    await this.connect();
    const id = randomUUID();
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OpenClaw RPC ${method} timeout`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(payload);
    });
  }
}

const client = new OpenClawWsClient();

export async function callOpenClawWs(ctx: ResolvedRequestContext): Promise<{
  status: number;
  body: unknown;
  containerId?: string;
}> {
  // 사용자별 sessionKey가 핵심 — OpenClaw UI에서 세션 격리의 기준
  const rpcParams = {
    model: ctx.agent_id,
    messages: [{ role: "user", content: ctx.input }],
    aaas: {
      userId: ctx.user.id,
      workspace: ctx.user.workspace_path,
      authProfileId: ctx.user.auth_profile_id,
      requestId: ctx.request_id,
    },
    sessionKey: `aaas:user:${ctx.user.id}`,
  };

  try {
    const result = await client.call("chat.send", rpcParams);
    const containerId =
      (result as { aaas?: { containerId?: string } } | null)?.aaas?.containerId;
    return { status: 200, body: result, containerId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 502, body: { error: "openclaw_ws_error", detail: msg } };
  }
}