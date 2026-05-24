import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js"; 
import type {
  ResolvedRequestContext,
  TenantUser,
  AgentRunRequest,
} from "../types.js";

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

  const root = path.resolve(config.workspaceRoot);
  const ws = path.resolve(user.workspace_path);
  const rel = path.relative(root, ws);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `tenant ${user.id} workspace_path "${user.workspace_path}" escapes root "${config.workspaceRoot}"`
    );
  }

  return {
    request_id: randomUUID(),
    user,
    agent_id: body.agent_id,
    input: body.input,
    metadata: cleanedMetadata,
  };
}