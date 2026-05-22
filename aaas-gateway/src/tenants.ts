import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import type { TenantRegistry, TenantUser } from "./types.js";

/**
 * In-memory tenant store. Loaded once at startup.
 * In production this would be a database; for the demo a YAML file is enough.
 */
class TenantStore {
  private byToken = new Map<string, TenantUser>();
  private byId = new Map<string, TenantUser>();

  load(filePath: string): void {
    const raw = readFileSync(resolve(filePath), "utf-8");
    const parsed = YAML.parse(raw) as TenantRegistry;

    if (!parsed?.users?.length) {
      throw new Error(`Tenant file ${filePath} has no users.`);
    }

    this.byToken.clear();
    this.byId.clear();

    for (const u of parsed.users) {
      this.validate(u);
      if (this.byToken.has(u.api_token)) {
        throw new Error(`Duplicate api_token for user ${u.id}`);
      }
      if (this.byId.has(u.id)) {
        throw new Error(`Duplicate user id ${u.id}`);
      }
      this.byToken.set(u.api_token, u);
      this.byId.set(u.id, u);
    }
  }

  findByToken(token: string): TenantUser | undefined {
    return this.byToken.get(token);
  }

  findById(id: string): TenantUser | undefined {
    return this.byId.get(id);
  }

  listIds(): string[] {
    return [...this.byId.keys()];
  }

  private validate(u: TenantUser): void {
    for (const field of [
      "id",
      "api_token",
      "workspace_path",
      "auth_profile_id",
    ] as const) {
      if (!u[field] || typeof u[field] !== "string") {
        throw new Error(`User missing/invalid field "${field}": ${JSON.stringify(u)}`);
      }
    }
    if (!Array.isArray(u.allowed_agents)) {
      throw new Error(`User ${u.id} missing allowed_agents`);
    }
    if (!u.workspace_path.startsWith("/")) {
      throw new Error(
        `User ${u.id} workspace_path must be absolute, got: ${u.workspace_path}`
      );
    }
    if (u.workspace_path.includes("..")) {
      throw new Error(`User ${u.id} workspace_path must not contain '..'`);
    }
  }
}

export const tenantStore = new TenantStore();
