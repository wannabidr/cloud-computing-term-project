import type { FastifyRequest, FastifyReply } from "fastify";
import { tenantStore } from "../tenants.js";
import type { TenantUser } from "../types.js";

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantUser;
  }
}

/**
 * Bearer-token authentication.
 * Extracts the token from the Authorization header and resolves it against
 * the tenant store. Attaches the resolved user to request.tenant.
 */
export async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = req.headers["authorization"];
  if (!header || typeof header !== "string" || !header.startsWith("Bearer ")) {
    reply.code(401).send({ error: "missing_or_invalid_authorization_header" });
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  const user = tenantStore.findByToken(token);
  if (!user) {
    reply.code(401).send({ error: "unknown_api_token" });
    return;
  }

  req.tenant = user;
}
