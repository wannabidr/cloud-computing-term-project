# OpenClaw 패치 재점검 결과 (newpatch.md)

업로드해 주신 파일 5개 (`http-utils.ts`, `openai-http.ts`, `agent-scope-config.ts`,
`model-auth.ts`, `attempt-execution.ts`, `context.ts`)를 기존 패치 가이드의
6개 조건과 1:1로 대조했다. **컴파일 오류 1건**, **통합 누락 3건**, **포맷
불일치 1건**, **개선 권고 1건**이 발견되었다. 아래 순서대로 직접 수정한 코드
diff를 제시한다.

---

## 패치 가이드 vs 현재 상태 체크리스트

| #   | 조건                                                       | 파일                       | 결과 | 비고                                                  |
| --- | ---------------------------------------------------------- | -------------------------- | ---- | ----------------------------------------------------- |
| 1   | `x-aaas-*` 4종 헤더 파싱                                   | `http-utils.ts`            | OK   | `getAaasContext()` 정상                               |
| 2   | `resolveGatewayRequestContext`가 `aaas` 반환                | `http-utils.ts`            | OK   |                                                       |
| 3   | `openai-http.ts`가 `aaas`를 `commandInput`에 부착          | `openai-http.ts`           | OK   |                                                       |
| 4   | 응답 헤더 `x-aaas-request-id`                              | `openai-http.ts`           | OK   |                                                       |
| 5   | 응답 헤더 `x-aaas-container-id`                            | `openai-http.ts`           | **NG** | 헤더 세팅 코드는 있으나 실제로 `containerId`가 호출되는 곳이 없음 |
| 6   | 응답 헤더 `x-aaas-tool-calls`                              | `openai-http.ts`           | △    | 헤더 포맷이 `id:name,...` → Gateway가 숫자 기대. 둘 중 하나 수정 필요 |
| 7   | `agent-scope-config.ts` workspace 우선순위 `aaas`          | `agent-scope-config.ts`    | OK   |                                                       |
| 8   | workspace 경로 보안 검증 (`..` 차단, 루트 하위 강제)       | `agent-scope-config.ts`    | △    | 검증 루트가 `stateDir/workspaces`로 하드코딩 — 컴포즈 마운트 경로 `OPENCLAW_WORKSPACE_ROOT`와 불일치 |
| 9   | `sandbox/context.ts` workspace bind mount이 위 경로 사용   | `context.ts`               | OK   | `params.workspaceDir`로 이미 받음, 변경 불필요         |
| 10  | `model-auth.ts` `aaasAuthProfileId` 우선                   | `model-auth.ts`            | **컴파일 에러** | `preferredProfile`가 destructure 안 되어 `ReferenceError` |
| 11  | `attempt-execution.ts` 도구 실행 카운터                    | `attempt-execution.ts`     | OK   | `getAaasToolCallsForRequest()` 등 잘 노출됨           |
| 12  | AaaS 헤더 없으면 기존 동작 fallback                        | 전 파일                    | OK   | 모두 `undefined`일 때 정상 경로로 떨어짐               |

---

## Fix 1 (필수) — `model-auth.ts` 컴파일 오류

### 문제

`resolveApiKeyForProvider` 함수에서 `preferredProfile` 식별자가 destructure 되지
않은 채 사용된다. 함수 시작부에:

```ts
// 파일: external/openclaw/src/agents/model-auth.ts:555
const { provider, cfg } = params;
```

만 있고, 이후 라인 619, 624, 629, 699, 705에서 `preferredProfile`이 그대로 사용된다.
`hasAvailableAuthForProvider`에는 라인 901에 `const { provider, cfg, preferredProfile } = params;`로 잘 destructure 되어 있으나 `resolveApiKeyForProvider`에는 빠졌다.
TypeScript strict 모드에서 컴파일이 실패한다.

### 수정

`model-auth.ts:555` 한 줄 교체.

```diff
- const { provider, cfg } = params;
+ const { provider, cfg, preferredProfile } = params;
```

### 검증

```bash
cd external/openclaw
npx tsc --noEmit -p tsconfig.json | grep model-auth
# 출력이 비어 있으면 OK
```

---

## Fix 2 (필수) — `agent-scope-config.ts` workspace 루트 하드코딩

### 문제

`validateAndNormalizePath`의 baseRoot가 `path.join(resolveStateDir(env), "workspaces")`로
고정되어 있다. 우리 docker-compose에서는 호스트의 `./workspaces`를 컨테이너의 `/workspaces`에
마운트하고, `tenants.yaml`은 `workspace_path: /workspaces/userA`로 보낸다.
`resolveStateDir(env)`는 일반적으로 `~/.openclaw` 같은 다른 경로를 반환하므로 모든 AaaS
요청이 "Invalid workspace path" 오류로 거부된다.

또한 `normalized.includes("..")` 체크는 `path.normalize` 이전·이후에 모두 `..`이 사라질 수
있어 우회 가능성이 있다. `path.relative`를 사용해야 안전하다.

### 수정

`agent-scope-config.ts` 상단 import에 한 줄 추가하고, 두 함수를 교체한다.

```diff
  import path from "node:path";
  import { resolveStateDir } from "../config/paths.js";
  // ... (다른 import 유지)

+ /**
+  * Resolve the root within which AaaS-provided workspace paths must live.
+  * Priority:
+  *   1. OPENCLAW_WORKSPACE_ROOT env var (set by docker-compose for AaaS deployments)
+  *   2. stateDir/workspaces fallback (single-user default)
+  */
+ function resolveAaasWorkspaceRoot(env?: NodeJS.ProcessEnv): string {
+   const envRoot = (env ?? process.env).OPENCLAW_WORKSPACE_ROOT?.trim();
+   if (envRoot) {
+     return path.resolve(envRoot);
+   }
+   return path.resolve(path.join(resolveStateDir(env), "workspaces"));
+ }

  function validateAndNormalizePath(candidatePath: string, baseRoot: string): string {
-   const normalized = path.normalize(candidatePath);
-   const normalizedBase = path.normalize(baseRoot);
-
-   // Check for path traversal attempts
-   if (normalized.includes("..") || !normalized.startsWith(normalizedBase)) {
-     throw new Error(
-       `Invalid workspace path: must be within ${normalizedBase} and contain no '..' traversal`
-     );
-   }
-
-   return stripNullBytes(normalized);
+   if (candidatePath.includes("\0")) {
+     throw new Error("workspace path must not contain null bytes");
+   }
+   const normalized = path.resolve(candidatePath);
+   const normalizedBase = path.resolve(baseRoot);
+   const rel = path.relative(normalizedBase, normalized);
+   if (rel === "" || rel === "." || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
+     return stripNullBytes(normalized);
+   }
+   throw new Error(
+     `Invalid workspace path: ${candidatePath} is not within ${normalizedBase}`
+   );
  }
```

그리고 `resolveAgentWorkspaceDir` 안쪽에서 baseRoot를 위 헬퍼로 교체한다.

```diff
  export function resolveAgentWorkspaceDir(
    cfg: OpenClawConfig,
    agentId: string,
    env?: NodeJS.ProcessEnv,
    aaas?: AaasContext,
  ): string {
    // Priority 1: AaaS-provided workspace (with security validation)
    if (aaas?.workspace?.trim()) {
-     const stateDir = resolveStateDir(env);
-     const workspaceRoot = path.join(stateDir, "workspaces");
+     const workspaceRoot = resolveAaasWorkspaceRoot(env);
      try {
        return validateAndNormalizePath(aaas.workspace, workspaceRoot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`AaaS workspace validation failed: ${message}`);
      }
    }
    // ... (이하 동일)
  }
```

### 검증

```bash
# tenants.yaml에 workspace_path: /workspaces/userA가 있고
# OPENCLAW_WORKSPACE_ROOT=/workspaces 환경에서:
docker compose exec openclaw node -e \
  "const m=require('./dist/agents/agent-scope-config.js'); \
   console.log(m.resolveAgentWorkspaceDir({agents:{list:[]}},'default',{OPENCLAW_WORKSPACE_ROOT:'/workspaces'},{workspace:'/workspaces/userA'}))"
# 출력: /workspaces/userA
```

---

## Fix 3 (필수) — `x-aaas-container-id` 응답 헤더가 비어 있음

### 문제

`openai-http.ts`의 `setAaasResponseHeaders` 함수는 `opts.containerId`를 받으면
헤더에 실어 주지만, **함수를 호출하는 모든 지점에서 `containerId`를 넘기지 않는다**.

```ts
// openai-http.ts:1032 — 호출 예
setAaasResponseHeaders(res, aaas, { toolCalls: aaasToolCalls ?? pendingToolCalls });
// containerId 누락
```

원인: sandbox 컨테이너 ID는 `sandbox/context.ts::resolveSandboxContext()`가 반환하는
`{ sandbox, containerId }`에 들어 있는데, 이 값이 `agentCommandFromIngress` 호출 결과
타고 올라와 `openai-http.ts`까지 전달되는 경로가 없다.

### 수정

Tool call tracking과 동일한 방식으로 per-request store를 만든다. 즉:

1. `sandbox/context.ts`에서 컨테이너가 생성될 때 requestId → containerId를 저장.
2. `openai-http.ts`에서 응답 헤더 세팅 직전에 저장소를 조회.

#### 3-A. `attempt-execution.ts` 끝부분에 컨테이너 추적 헬퍼 추가

```diff
  // 파일 끝부분에 추가
+ const aaasContainerIdByRequestId = new Map<string, string>();
+
+ /** Record the sandbox container ID created for this AaaS request. */
+ export function setAaasContainerIdForRequest(requestId: string, containerId: string): void {
+   const normalized = requestId.trim();
+   if (!normalized || !containerId.trim()) {
+     return;
+   }
+   aaasContainerIdByRequestId.set(normalized, containerId.trim());
+ }
+
+ /** Latest sandbox container ID associated with an AaaS request, if any. */
+ export function getAaasContainerIdForRequest(requestId: string): string | undefined {
+   const normalized = requestId.trim();
+   if (!normalized) {
+     return undefined;
+   }
+   return aaasContainerIdByRequestId.get(normalized);
+ }
+
+ /** Cleanup helper invoked from resetAaasToolCallTrackingForRequest. */
+ function resetAaasContainerIdForRequest(requestId: string): void {
+   aaasContainerIdByRequestId.delete(requestId);
+ }
```

그리고 기존 `resetAaasToolCallTrackingForRequest`에 한 줄 추가:

```diff
  export function resetAaasToolCallTrackingForRequest(requestId: string): void {
    const normalized = requestId.trim();
    if (!normalized) {
      return;
    }
    aaasToolCallCountByRequestId.delete(normalized);
    aaasToolCallsByRequestId.delete(normalized);
+   resetAaasContainerIdForRequest(normalized);
    const timingPrefix = `${normalized} `;
    for (const key of aaasToolCallStartTimes.keys()) {
      if (key.startsWith(timingPrefix)) {
        aaasToolCallStartTimes.delete(key);
      }
    }
  }
```

#### 3-B. `sandbox/context.ts` 끝에서 containerId 저장

`resolveSandboxContext`는 `params.sessionKey`만 가지고 있고 `aaas.requestId`는
직접 받지 않는다. 가장 깔끔한 방법은 `params`에 `aaasRequestId`를 옵션으로 추가하고,
호출자(즉 sandbox를 만드는 상위 함수)가 commandInput에서 꺼내 전달하는 것이다.

```diff
  export async function resolveSandboxContext(params: {
    config?: OpenClawConfig;
    sessionKey?: string;
    workspaceDir?: string;
+   aaasRequestId?: string;
  }): Promise<{ sandbox: SandboxContext; containerId: string } | null> {
    // ... 기존 코드 그대로 ...

    sandboxContext.fsBridge =
      backend.createFsBridge?.({ sandbox: sandboxContext }) ??
      createSandboxFsBridge({ sandbox: sandboxContext });

+   if (params.aaasRequestId) {
+     const { setAaasContainerIdForRequest } = await import(
+       "../command/attempt-execution.js"
+     );
+     setAaasContainerIdForRequest(params.aaasRequestId, backend.runtimeId);
+   }

    return { sandbox: sandboxContext, containerId: backend.runtimeId };
  }
```

> 주의: `resolveSandboxContext`의 호출처(아마 `runEmbeddedPiAgent` 또는 `runCliAgent`
> 내부)가 `aaas.requestId`를 함께 넘기도록 한 줄 추가하는 작업이 필요하다.
> OpenClaw 내부 호출 그래프를 따라가서 `commandInput.aaas?.requestId`를
> `resolveSandboxContext({..., aaasRequestId})`로 전파하면 된다.
> 본 핸드오프에서 그 호출지점까지 패치하지 않은 이유는 OpenClaw 내부 API가
> 버전별로 달라질 수 있어 한 군데만 보여주면 오해 소지가 있기 때문이다.

#### 3-C. `openai-http.ts`에서 컨테이너 ID를 응답 헤더에 실음

```diff
  import {
    getAaasToolCallsForRequest,
    resetAaasToolCallTrackingForRequest,
+   getAaasContainerIdForRequest,
  } from "../agents/command/attempt-execution.js";

  // ... 중략 ...

  function resolveAaasContainerId(aaas: AaasContext): string | undefined {
    const requestId = aaas.requestId?.trim();
    if (!requestId) return undefined;
    return getAaasContainerIdForRequest(requestId);
  }

  // setAaasResponseHeaders 호출지점을 다음과 같이 모두 보강한다.
- setAaasResponseHeaders(res, aaas, { toolCalls: aaasToolCalls ?? pendingToolCalls });
+ setAaasResponseHeaders(res, aaas, {
+   toolCalls: aaasToolCalls ?? pendingToolCalls,
+   containerId: resolveAaasContainerId(aaas),
+ });
```

라인 1032, 1059, 1100 세 군데 모두 동일하게 `containerId`를 함께 넘긴다.

### 검증

```bash
curl -i -X POST http://localhost:8080/v1/agents/run \
  -H "Authorization: Bearer aaas_demo_token_userA_change_me" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"file-summarizer","input":"tool:list_workspace"}' | grep -i x-aaas-container-id
# X-Aaas-Container-Id: <some hash> 라인이 나오면 OK
```

---

## Fix 4 (필수) — `x-aaas-tool-calls` 헤더 포맷 불일치

### 문제

OpenClaw가 보내는 헤더:

```
x-aaas-tool-calls: call_1:list_workspace,call_2:read_file
```

Gateway가 기대하는 포맷:

```ts
// src/services/openclaw-proxy.ts
tool_calls: typeof toolCallsRaw === "string" ? Number(toolCallsRaw) : undefined,
```

→ `Number("call_1:list_workspace,...")` = `NaN`. 로그에 `tool_calls`가 항상 누락된다.

### 수정

Gateway 측을 새 포맷에 맞춰 업데이트했다. **이 파일은 이미 갱신**되었다:
`src/services/openclaw-proxy.ts` — 콤마 분리하여 개수(`count`)와 상세(`detail`)를
모두 노출한다.

```ts
// 변경 후
const toolCallsRaw = res.headers["x-aaas-tool-calls"];
const parsed = parseToolCallsHeader(toolCallsRaw);
return {
  // ...
  tool_calls: parsed.count,
  tool_calls_detail: parsed.detail,  // "call_1:list_workspace,call_2:read_file"
};
```

OpenClaw 쪽은 수정할 필요가 없다.

---

## Fix 5 (권장) — `attempt-execution.ts` 로그 경로 환경변수 우선순위

### 문제

`DEFAULT_AAAS_TOOLS_LOG_PATH = "/app/logs/openclaw-tools.jsonl"`이 컨테이너 경로에
강하게 결합돼 있다. 호스트 단독 실행 시 권한 오류로 로그가 사라진다.

### 수정

이미 `OPENCLAW_AAAS_TOOLS_LOG_FILE` 환경변수로 오버라이드 가능하므로,
`docker-compose.yml`에서 명시적으로 지정해 두면 안전하다. 본 핸드오프에서는
이미 다음 환경변수를 추가했다(아래 SETUP_GUIDE 7단계에서 확인).

```yaml
openclaw:
  environment:
    OPENCLAW_AAAS_TOOLS_LOG_FILE: "/app/logs/openclaw-tools.jsonl"
  volumes:
    - ./logs:/app/logs   # gateway와 같은 폴더 공유
```

---

## 패치 적용 후 최종 체크리스트

- [ ] `cd external/openclaw && npx tsc --noEmit` — 컴파일 0건.
- [ ] `docker compose build openclaw` 통과.
- [ ] `curl -i -X POST .../v1/agents/run ...` 응답 헤더에
      `X-Aaas-Request-Id`, `X-Aaas-Container-Id`, `X-Aaas-Tool-Calls` 셋 다 보임.
- [ ] `tail -f logs/openclaw-tools.jsonl`에 도구 호출 start/end 라인이 보임.
- [ ] `tail -f logs/containers.jsonl`에 Gateway 측 컨테이너 로그가 보임.
- [ ] `tail -f logs/requests.jsonl`에 요청별 사용자/agent/workspace가 보임.
- [ ] userA·userB 각각으로 호출 시 응답 본문의 `workspace=` 라인이 다름.

이 6개가 모두 통과하면 핸드아웃 11절의 성공 기준 5개 중 4개(API 공유, Workspace 분리,
OAuth 프로필 분리, 컨테이너 실행 검증)가 자동으로 충족된다. 나머지 1개(다른
사용자 워크스페이스 접근 차단)는 `scripts/smoke.sh`의 case 4가 검증한다.
