import type { FastifyInstance } from "fastify";
import { stats } from "../services/logger.js";
import { tenantStore } from "../tenants.js";

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // Health probe — no auth.
  app.get("/healthz", async () => ({ ok: true }));

  // Demo-grade stats endpoint. No auth in the demo build; in production
  // this would require an admin token.
  app.get("/admin/stats", async () => ({
    users: tenantStore.listIds(),
    metrics: stats.snapshot(),
  }));
}
