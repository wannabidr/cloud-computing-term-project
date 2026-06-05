import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../config.js";
import type { ContainerLogEntry, RequestLogEntry } from "../types.js";

const requestsFile = () => resolve(config.logsDir, "requests.jsonl");
const containersFile = () => resolve(config.logsDir, "containers.jsonl");

async function ensureDir(): Promise<void> {
  await mkdir(resolve(config.logsDir), { recursive: true });
}

export async function writeRequestLog(entry: RequestLogEntry): Promise<void> {
  await ensureDir();
  await appendFile(requestsFile(), JSON.stringify(entry) + "\n", "utf-8");
}

export async function writeContainerLog(entry: ContainerLogEntry): Promise<void> {
  await ensureDir();
  await appendFile(containersFile(), JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Simple in-memory stats for /admin/stats. Persisted-log driven stats would
 * read the jsonl files; for the demo this is fine.
 */
class Stats {
  private perUser = new Map<string, { requests: number; totalDurationMs: number; containers: number; totalTokens: number }>();
  record(userId: string, durationMs: number, hasContainer: boolean, tokenCount?: number): void {
    const cur =
      this.perUser.get(userId) ?? { requests: 0, totalDurationMs: 0, containers: 0, totalTokens: 0 };
    cur.requests += 1;
    cur.totalDurationMs += durationMs;
    if (hasContainer) cur.containers += 1;
    if (tokenCount) cur.totalTokens += tokenCount;
    this.perUser.set(userId, cur);
  }

  snapshot() {
    const out: Record<string, { requests: number; avg_duration_ms: number; containers: number }> = {};
    for (const [k, v] of this.perUser.entries()) {
      out[k] = {
  requests: v.requests,
  avg_duration_ms: v.requests ? Math.round(v.totalDurationMs / v.requests) : 0,
  containers: v.containers,
  total_tokens: v.totalTokens,
};
    }
    return out;
  }
}

export const stats = new Stats();
