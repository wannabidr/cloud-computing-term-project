/**
 * 참고용 스니펫. 실제 OpenClaw 코드에 그대로 붙이지 말고,
 * 해당 파일의 시그니처에 맞게 통합할 것.
 *
 * 위치: external/openclaw/src/gateway/http-utils.ts (신규 헬퍼)
 */

export interface AaasContext {
  userId?: string;
  workspace?: string;
  authProfileId?: string;
  requestId?: string;
}

export function getAaasContext(headers: Record<string, string | string[] | undefined>): AaasContext {
  const get = (k: string): string | undefined => {
    const v = headers[k];
    if (Array.isArray(v)) return v[0];
    return v ?? undefined;
  };
  return {
    userId: get("x-aaas-user-id"),
    workspace: get("x-aaas-workspace"),
    authProfileId: get("x-aaas-auth-profile"),
    requestId: get("x-aaas-request-id"),
  };
}

/**
 * 위치: external/openclaw/src/agents/agent-scope-config.ts (수정 후)
 *
 * 기존:
 *   const workspace = resolveDefaultWorkspace(env, config);
 *
 * 수정:
 *   const workspace = aaas?.workspace
 *     ? assertSafePath(aaas.workspace, env.OPENCLAW_WORKSPACE_ROOT)
 *     : resolveDefaultWorkspace(env, config);
 *
 * assertSafePath: workspace가 ROOT 하위인지, '..' 포함 여부 검증.
 */
export function assertSafePath(p: string, root: string): string {
  if (!p.startsWith("/")) {
    throw new Error(`workspace must be absolute: ${p}`);
  }
  if (p.includes("..")) {
    throw new Error(`workspace must not contain '..': ${p}`);
  }
  // p 가 root 하위인지 확인 (path.resolve 후 비교가 안전)
  const normalized = p.replace(/\/+$/, "");
  const normalizedRoot = root.replace(/\/+$/, "");
  if (
    normalized !== normalizedRoot &&
    !normalized.startsWith(normalizedRoot + "/")
  ) {
    throw new Error(
      `workspace ${p} is outside OPENCLAW_WORKSPACE_ROOT ${root}`
    );
  }
  return normalized;
}
