import type { FastifyInstance, FastifyRequest } from "fastify";
import { authenticate } from "../middleware/auth.js";
import { authorizeAgent } from "../middleware/authorize.js";
import { resolveRequestContext } from "../services/mapper.js";
import { proxyToOpenClaw } from "../services/openclaw-proxy.js";
import { stats, writeContainerLog, writeRequestLog } from "../services/logger.js";
import type { AgentRunRequest } from "../types.js";

type RunReq = FastifyRequest<{ Body: AgentRunRequest }>;

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AgentRunRequest }>(
    "/v1/agents/run",
    {
      preHandler: [
        authenticate,
        authorizeAgent((req) => (req.body as AgentRunRequest | undefined)?.agent_id),
      ],
      schema: {
        body: {
          type: "object",
          required: ["agent_id", "input"],
          properties: {
            agent_id: { type: "string", minLength: 1 },
            input: { type: "string", minLength: 1 },
            metadata: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
      },
    },
    async (req: RunReq, reply) => {
      const startedAt = Date.now();
      const user = req.tenant!;
      const ctx = resolveRequestContext(user, req.body);

      req.log.info(
        {
          request_id: ctx.request_id,
          user_id: user.id,
          agent_id: ctx.agent_id,
          workspace_path: user.workspace_path,
          auth_profile_id: user.auth_profile_id,
        },
        "agent.run.start"
      );

      let httpStatus = 500;
      let error: string | undefined;
      let containerId: string | undefined;
      let toolCalls: number | undefined;
      let toolCallsDetail: string | undefined;
      let responseBody: unknown = null;
      let backend: string | undefined;

      try {
        const upstream = await proxyToOpenClaw(ctx);
        httpStatus = upstream.status;
        responseBody = upstream.body;
        containerId = upstream.container_id;
        toolCalls = upstream.tool_calls;
        toolCallsDetail = upstream.tool_calls_detail;
        backend = upstream.backend;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        httpStatus = 502;
        responseBody = { error: "openclaw_proxy_error", detail: error };
      }

      const durationMs = Date.now() - startedAt;
      const ts = new Date().toISOString();

      await writeRequestLog({
        request_id: ctx.request_id,
        ts,
        user_id: user.id,
        agent_id: ctx.agent_id,
        workspace_path: user.workspace_path,
        auth_profile_id: user.auth_profile_id,
        http_status: httpStatus,
        duration_ms: durationMs,
        error,
      });

      if (containerId) {
        await writeContainerLog({
          request_id: ctx.request_id,
          ts,
          user_id: user.id,
          container_id: containerId,
          started_at: new Date(startedAt).toISOString(),
          ended_at: ts,
          tool_calls: toolCalls,
          tool_calls_detail: toolCallsDetail,
        });
      }

      stats.record(user.id, durationMs, Boolean(containerId));

      reply
        .code(httpStatus)
        .header("x-aaas-request-id", ctx.request_id)
        .header("x-aaas-backend", backend ?? "unknown")
        .send(responseBody);
    }
  );
}
