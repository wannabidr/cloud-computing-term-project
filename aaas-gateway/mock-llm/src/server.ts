/**
 * Mock LLM — drop-in replacement for OpenAI's /v1/chat/completions.
 *
 * Used by OpenClaw during development so we can verify multi-tenant
 * routing and sandbox isolation WITHOUT spending real model tokens.
 *
 * The mock:
 *   - Always returns a "chat.completion"-shaped JSON.
 *   - Echoes the authenticated user_id (X-Aaas-User-Id header) and the
 *     workspace path back in the assistant message, so the demo can
 *     visually prove that userA's request did not leak into userB's.
 *   - When the user message includes "tool:list_workspace", it returns
 *     a tool_call so OpenClaw exercises the sandbox path too.
 */
import Fastify from "fastify";

const HOST = process.env.MOCK_LLM_HOST ?? "0.0.0.0";
const PORT = Number(process.env.MOCK_LLM_PORT ?? "9001");

const app = Fastify({ logger: true });

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatRequest {
  model?: string;
  messages?: ChatMessage[];
}

app.get("/healthz", async () => ({ ok: true, service: "mock-llm" }));

app.post<{ Body: ChatRequest }>("/v1/chat/completions", async (req, reply) => {
  const userId = String(req.headers["x-aaas-user-id"] ?? "unknown");
  const workspace = String(req.headers["x-aaas-workspace"] ?? "/unknown");
  const profile = String(req.headers["x-aaas-auth-profile"] ?? "unknown");
  const requestId = String(req.headers["x-aaas-request-id"] ?? "unknown");
  const model = req.body?.model ?? "mock-agent";
  const lastUserMsg =
    [...(req.body?.messages ?? [])].reverse().find((m) => m.role === "user")?.content ??
    "";

  // If OpenClaw asks for tool execution, return a tool_call so the
  // sandbox path is exercised end-to-end.
  if (lastUserMsg.includes("tool:list_workspace")) {
    return reply.send({
      id: `mock-${requestId}`,
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "list_workspace",
                  arguments: JSON.stringify({ path: "." }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  }

  // Default plain text response, with explicit tenant info embedded so
  // bleed-through is obvious in demos.
  const content =
    `[MOCK-LLM]\n` +
    `user_id=${userId}\n` +
    `workspace=${workspace}\n` +
    `auth_profile=${profile}\n` +
    `agent_model=${model}\n` +
    `you_said="${lastUserMsg}"`;

  return reply.send({
    id: `mock-${requestId}`,
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
});

app.listen({ host: HOST, port: PORT }).then(() => {
  app.log.info(`mock-llm listening on http://${HOST}:${PORT}`);
});
