import type { ResolvedRequestContext, TenantUser, AgentRunRequest } from "../types.js";
import { randomUUID } from "node:crypto";

/**
 * Server-side mapping.
 *
 * IMPORTANT: This is the layer that enforces "the client cannot inject
 * workspace_path or auth_profile_id". We simply ignore whatever the
 * client put in those fields and overwrite them from the tenant record.
 */
export function resolveRequestContext(
  user: TenantUser,
  body: AgentRunRequest
): ResolvedRequestContext {
  // Strip anything sensitive that a malicious client could try to pass.
  const cleanedMetadata: Record<string, unknown> = { ...(body.metadata ?? {}) };
  for (const banned of ["workspace_path", "auth_profile_id", "user_id"]) {
    if (banned in cleanedMetadata) {
      delete cleanedMetadata[banned];
    }
  }

  return {
    request_id: randomUUID(),
    user,
    agent_id: body.agent_id,
    input: body.input,
    metadata: cleanedMetadata,
  };
}
