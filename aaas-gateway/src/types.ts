/**
 * Core types shared across the AaaS Gateway.
 */

export interface TenantUser {
  id: string;
  api_token: string;
  workspace_path: string;
  auth_profile_id: string;
  allowed_agents: string[];
}

export interface TenantRegistry {
  users: TenantUser[];
}

export interface AgentRunRequest {
  agent_id: string;
  input: string;
  metadata?: Record<string, unknown>;
}

export interface ResolvedRequestContext {
  request_id: string;
  user: TenantUser;
  agent_id: string;
  input: string;
  metadata: Record<string, unknown>;
}

export interface RequestLogEntry {
  request_id: string;
  ts: string;
  user_id: string;
  agent_id: string;
  workspace_path: string;
  auth_profile_id: string;
  http_status: number;
  duration_ms: number;
  token_count?: number;
  error?: string;
}

export interface ContainerLogEntry {
  request_id: string;
  ts: string;
  user_id: string;
  container_id?: string;
  started_at: string;
  ended_at?: string;
  tool_calls?: number;
  tool_calls_detail?: string;
}
