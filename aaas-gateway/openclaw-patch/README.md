# OpenClaw 최소 패치 가이드

이 폴더의 목적은 **OpenClaw 코드를 가능한 한 적게 수정**하면서, AaaS Gateway가
헤더로 넘기는 멀티 테넌트 정보(`X-Aaas-Workspace`, `X-Aaas-Auth-Profile`,
`X-Aaas-User-Id`, `X-Aaas-Request-Id`)를 OpenClaw 내부 실행 컨텍스트로
주입하는 패치 지점을 정리하는 것이다.

> 사용자 결정: **Workspace 라우팅은 "OpenClaw가 이미 받는 파라미터에 끼워 넣는 방법"**으로 구현한다.
> 즉 우리는 OpenClaw 코드를 fork 수정하기보다, OpenClaw가 이미 사용하는
> "현재 요청의 workspace path"와 "현재 요청의 model-auth profile id"가
> 결정되는 단 한 지점에서 **헤더 값을 읽어 들이도록만** 바꾼다.

## 패치 포인트 4곳

핸드아웃 9절이 지목한 파일을 다음 순서로 손댄다. 각 파일에서 수정해야 할
줄 수는 보통 3~10줄을 넘지 않는다.

### 1. `external/openclaw/src/gateway/openai-http.ts`
역할: OpenAI 호환 HTTP 요청의 entry. 헤더에서 테넌트 메타데이터를 꺼낸다.

해야 할 변경:
- 요청 핸들러 진입부에서 다음 헤더를 읽어 요청 컨텍스트 객체에 채워 넣는다.
  - `x-aaas-user-id`
  - `x-aaas-workspace`
  - `x-aaas-auth-profile`
  - `x-aaas-request-id`
- 이 값들은 OpenClaw 내부에서 사용되는 RequestContext (혹은 동등한 객체)에
  `aaas`라는 namespace로 부착한다. 예:
  ```ts
  const aaas = {
    userId: req.headers["x-aaas-user-id"]?.toString(),
    workspace: req.headers["x-aaas-workspace"]?.toString(),
    authProfileId: req.headers["x-aaas-auth-profile"]?.toString(),
    requestId: req.headers["x-aaas-request-id"]?.toString(),
  };
  ```
- 컨테이너가 생성/종료될 때 응답 헤더로 다음을 되돌려준다.
  - `x-aaas-container-id`
  - `x-aaas-tool-calls`

### 2. `external/openclaw/src/gateway/http-utils.ts`
역할: 헤더/세션 키 파싱 유틸. 위 헤더를 안전하게 꺼내는 헬퍼 한두 개를 추가한다.

해야 할 변경:
- `getAaasContext(req)` 같은 헬퍼를 추가하고, `openai-http.ts`에서 이를 호출하도록 한다.
- 헤더가 없으면 단일 사용자 fallback(기존 동작)으로 떨어지도록 한다.
  → AaaS Gateway를 거치지 않고 OpenClaw를 직접 호출하는 기존 사용자가 깨지지 않도록.

### 3. `external/openclaw/src/agents/agent-scope-config.ts`
역할: agent 실행 scope (Workspace 경로 포함)를 만든다.

해야 할 변경:
- scope-config 생성 함수에 `aaas` 컨텍스트를 인자로 추가한다.
- workspace 경로 결정 로직에서 `aaas.workspace`가 존재하면 **그것을 우선 사용**한다.
  ```ts
  const workspacePath =
    aaas?.workspace ?? defaultWorkspaceFromEnvOrConfig();
  ```
- 보안 가드: `workspacePath`가 `OPENCLAW_WORKSPACE_ROOT` 하위인지, `..`를
  포함하지 않는지를 여기서 한 번 더 검증해 거부한다(이중 방어).

### 4. `external/openclaw/src/agents/sandbox/context.ts`
역할: sandbox 컨테이너 생성. 위에서 정해진 workspacePath를 실제 마운트로 연결한다.

해야 할 변경:
- 컨테이너 생성 옵션의 binds에서 호스트 경로를 `workspacePath`로 바꾼다.
  ```ts
  HostConfig: {
    Binds: [`${workspacePath}:/workspace:rw`],
    NetworkMode: "none",      // 시연 시 보안 강화 권장
    AutoRemove: true,
    // 가능하면 비-root user로 실행
  }
  ```
- 컨테이너 ID와 종료 시점을 반환해서 `openai-http.ts`가 응답 헤더에 실을 수 있게 한다.

### 5. `external/openclaw/src/agents/model-auth.ts`
역할: 모델 호출에 사용할 OAuth 프로필을 선택한다.

해야 할 변경:
- 프로필 선택 함수에 `aaas?.authProfileId`를 받아서, 존재하면 그 값으로
  프로필 lookup을 수행한다.
- AaaS 모드일 때는 환경 변수의 기본 프로필 대신 항상 요청별 프로필을 사용한다.

### 6. (선택) `external/openclaw/src/agents/command/attempt-execution.ts`
역할: 도구 실행 한 사이클. 사용량 로깅 hook을 여기에 건다.

해야 할 변경:
- 도구 실행 시작/종료 시점에 `aaas.requestId`로 묶인 로그를
  `/app/logs/openclaw-tools.jsonl` 같은 파일에 append.
- 응답 헤더 `x-aaas-tool-calls` 값을 위한 카운터를 증가시킨다.

## 패치 적용 순서

1. OpenClaw repo를 clone하고 위 파일들의 **현재 동작**부터 읽는다. (수정 X)
2. 새 브랜치(`feat/aaas-headers`)에서 위 6개 파일을 순서대로 수정한다.
3. OpenClaw 단독으로 `curl -H "x-aaas-workspace: /tmp/ws" ...` 같은 호출이
   기대대로 동작하는지 먼저 확인한다(Gateway 없이).
4. 그 뒤에 Gateway → OpenClaw → Mock LLM 전체 경로를 docker-compose로 띄운다.

## 호환성 원칙

- AaaS 헤더가 **없으면** OpenClaw는 기존 동작(단일 사용자 fallback)으로 떨어진다.
- AaaS 헤더가 **있으면** 그 값으로 workspace와 model-auth profile이 결정된다.
- 클라이언트 요청 본문에 들어 있는 `workspace_path`, `auth_profile_id`는
  OpenClaw에서도 **무시**한다(Gateway에서 한 번, OpenClaw에서 한 번 — 이중 방어).
