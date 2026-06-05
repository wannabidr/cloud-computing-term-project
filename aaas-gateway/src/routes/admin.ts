import type { FastifyInstance } from "fastify";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { config } from "../config.js";
import { stats, writeRequestLog } from "../services/logger.js";
import { tenantStore } from "../tenants.js";

type Usage = {
  tenant: string;
  requests: number;
  success: number;
  failed: number;
  avg_duration_ms: number;
  total_tokens: number;
  agents: Record<string, number>;
};

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/admin/stats", async () => ({
    users: tenantStore.listIds(),
    metrics: stats.snapshot(),
  }));

  app.get("/admin/usage", async () => {
    const file = resolve(config.logsDir, "requests.jsonl");
    const usage: Record<string, Usage & { totalDuration: number }> = {};

    try {
      const raw = await readFile(file, "utf-8");

      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;

        const log = JSON.parse(line);
        const tenant = log.user_id ?? "unknown";
        const agent = log.agent_id ?? "unknown";
        const status = Number(log.http_status ?? 0);
        const duration = Number(log.duration_ms ?? 0);

        if (!usage[tenant]) {
  usage[tenant] = {
    tenant,
    requests: 0,
    success: 0,
    failed: 0,
    avg_duration_ms: 0,
    total_tokens: 0,
    totalDuration: 0,
    agents: {},
  };
}

        usage[tenant].requests += 1;
        usage[tenant].totalDuration += duration;
        usage[tenant].agents[agent] = (usage[tenant].agents[agent] ?? 0) + 1;
usage[tenant].total_tokens += Number(log.token_count ?? 0);

        if (status >= 200 && status < 300) usage[tenant].success += 1;
        else usage[tenant].failed += 1;
      }

      return {
        updated_at: new Date().toISOString(),
        usage: Object.values(usage).map(({ totalDuration, ...row }) => ({
          ...row,
          avg_duration_ms: row.requests
            ? Math.round(totalDuration / row.requests)
            : 0,
        })),
      };
    } catch {
      return {
        updated_at: new Date().toISOString(),
        usage: [],
      };
    }
  });
    app.post("/admin/dev/usage/:userId", async (req) => {
    const { userId } = req.params as { userId: string };
    const ts = new Date().toISOString();

    await writeRequestLog({
      request_id: `dev-${Date.now()}`,
      ts,
      user_id: userId,
      agent_id: "dashboard-test",
      workspace_path: "/dev/dashboard-test",
      auth_profile_id: "dev",
      http_status: 200,
      duration_ms: 1000,
    });

    stats.record(userId, 1000, true);

    return {
      ok: true,
      userId,
      message: "usage log written",
    };
  });
    app.get("/admin/users/:id/requests", async (req) => {
    const { id } = req.params as { id: string };
    const { limit = "20" } = req.query as { limit?: string };

    const file = resolve(config.logsDir, "requests.jsonl");
    const max = Math.min(Number(limit) || 20, 100);

    try {
      const raw = await readFile(file, "utf-8");

      const requests = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((log) => log.user_id === id || log.tenantId === id)
        .slice(-max)
        .reverse()
        .map((log) => ({
          request_id: log.request_id ?? "-",
          ts: log.ts ?? log.timestamp ?? "",
          user_id: log.user_id ?? log.tenantId ?? id,
          agent_id: log.agent_id ?? log.model ?? "unknown",
          backend: log.backend ?? log.provider ?? "mock",
          duration_ms: log.duration_ms ?? 0,
          token_count: log.token_count ?? log.tokens ?? 0,
          http_status: log.http_status ?? 200,
          success:
            typeof log.success === "boolean"
              ? log.success
              : Number(log.http_status ?? 200) >= 200 &&
                Number(log.http_status ?? 200) < 300,
          container_id: log.container_id ?? "-",
          tool_calls: log.tool_calls ?? 0,
          tool_calls_detail: log.tool_calls_detail ?? [],
        }));

      return {
        user_id: id,
        limit: max,
        requests,
      };
    } catch {
      return {
        user_id: id,
        limit: max,
        requests: [],
      };
    }
  });

  app.get("/admin/users/:id/workspace", async (req) => {
    const { id } = req.params as { id: string };

    const tenantMap: Record<string, string> = {
      userA: "tnt_alice",
      userB: "tnt_bob",
      alice: "tnt_alice",
      bob: "tnt_bob",
      tnt_alice: "tnt_alice",
      tnt_bob: "tnt_bob",
    };

    const tenantDir = tenantMap[id] ?? id;
    const workspaceRoot =
      process.env.WORKSPACE_ROOT ?? "C:/cloud/repo/downloads";

    const targetPath = join(workspaceRoot, tenantDir);

    async function readTree(path: string): Promise<any[]> {
      try {
        const entries = await readdir(path, { withFileTypes: true });

        const result = await Promise.all(
          entries.map(async (entry) => {
            const fullPath = join(path, entry.name);
            const info = await stat(fullPath);

            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: "directory",
                path: fullPath,
                children: await readTree(fullPath),
              };
            }

            return {
              name: entry.name,
              type: "file",
              path: fullPath,
              size: info.size,
            };
          })
        );

        return result;
      } catch {
        return [];
      }
    }

    return {
      user_id: id,
      tenant_dir: tenantDir,
      root: targetPath,
      tree: await readTree(targetPath),
    };
  });
}