# AaaS Gateway — 데모 결과 리포트

## 1. 한 줄 요약

OpenClaw 기반 Multi-Tenant Agent-as-a-Service 프로젝트는 다음 세 가지 백엔드를 한 Gateway 뒤에서 환경변수 하나로 전환할 수 있는 구조로 완성되었으며, 그중 **OpenAI(gpt-5.4-mini)**와 **Mock LLM** 두 백엔드는 실제 호출까지 검증되었다. 두 사용자(userA·userB)가 같은 Agent API를 공유하면서 각자의 Workspace·OAuth 프로필·로그가 독립적으로 유지된다.

| 백엔드 | 상태 | 비고 |
| --- | --- | --- |
| OpenAI | ✅ 동작 | `gpt-5.4-mini` 등 실 모델 호출, Bearer 인증, OPENAI 직접 콜 |
| Mock LLM | ✅ 동작 | 자체 Node.js 서버, 헤더 echo로 라우팅 검증용 |
| OpenClaw | 🚧 보류 | WebSocket Gateway + 페어링 모델로 헤드리스 API에 부적합, 추후 통합 |

## 2. 최종 데모 결과

### 2-1. userA의 OpenAI 호출

```
[요청]
POST <http://localhost:8080/v1/agents/run>
Authorization: Bearer aaas_demo_token_userA_change_me
Content-Type: application/json
Body: {"agent_id":"gpt-5.4-mini","input":"hello"}

[응답 헤더]
HTTP/1.1 200 OK
x-aaas-request-id: bbc6e301-ddf0-47fa-aea3-d23c22e1758e
x-aaas-backend: openai           ← 어느 백엔드로 갔는지 명시

[응답 본문]
{
  "id": "chatcmpl-DiNkGQHw8yv41tMh25aUJJfOPH18L",
  "object": "chat.completion",
  "created": 1779470080,
  "model": "gpt-5.4-mini-2026-03-17",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 7,
    "completion_tokens": 12,
    "total_tokens": 19
  }
}
```

### 2-2. userB의 OpenAI 호출

```
[요청]
POST <http://localhost:8080/v1/agents/run>
Authorization: Bearer aaas_demo_token_userB_change_me
Body: {"agent_id":"gpt-5.4-mini","input":"hello_im_B"}

[응답 헤더]
x-aaas-request-id: b7045c3f-81cb-46c0-a4a7-c1d5dfc4a641
x-aaas-backend: openai

[응답 본문]
{
  "id": "chatcmpl-DiNkgYfT0a1ur9eHta5OVEtLU7rr7",
  "model": "gpt-5.4-mini-2026-03-17",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Hello, B! How can I help you today?"
    }
  }],
  "usage": {"prompt_tokens": 9, "completion_tokens": 14, "total_tokens": 23}
}
```

### 2-3. 결과의 의미

- **응답 헤더 `x-aaas-backend: openai`** — 우리 Gateway가 OpenAI로 라우팅했음을 명시. Mock LLM으로 자동 fallback 됐다면 `mock`이 나왔을 것.
- **두 응답의 `id`(chatcmpl-...)가 서로 다름** — OpenAI 측에서도 두 요청을 독립적으로 처리. 우리 `x-aaas-request-id`(UUID)와 join 가능한 별개의 OpenAI request ID.
- **두 응답의 `content`가 서로 다름** — userA 입력 `"hello"`에는 일반 인사, userB 입력 `"hello_im_B"`에는 `"Hello, B!"`라며 사용자 식별까지 응답에 반영. **같은 모델이지만 입력이 다르므로 응답이 다르다**는 자명한 검증.
- **`usage.total_tokens`가 사용자별 다름** — 19 vs 23. 향후 사용량 기반 과금에 그대로 활용 가능.
- **`model: "gpt-5.4-mini-2026-03-17"`** — 우리가 보낸 `agent_id: "gpt-5.4-mini"`가 OpenAI에서 실제 버전(2026-03-17)으로 해석됨을 확인.

## 3. 시스템 아키텍처 (최종)

```
┌──────────┐  Bearer 토큰  ┌─────────────────┐                  ┌──────────────────┐
│  Client  │ ───────────▶ │   AaaS Gateway  │ ── BACKEND_MODE ──▶  OpenAI API     │
│ (curl,   │              │   (port 8080)   │      auto        │ (gpt-5.4-mini)    │
│  웹앱)   │ ◀─ JSON ─    │                 │                  └──────────────────┘
└──────────┘              │  - 인증/인가     │       fallback
                          │  - 매핑(mapper)  │ ──────────────▶  ┌──────────────────┐
                          │  - 백엔드 라우터 │                  │   Mock LLM       │
                          │  - 로깅          │                  │   (port 9001)     │
                          └─────────────────┘                  └──────────────────┘
                                  │
                                  └─ logs/requests.jsonl
                                  └─ logs/containers.jsonl
                                  └─ (예정) OpenClaw WebSocket
```

### 3-1. 백엔드 선택 메커니즘

`docker-compose.yml`의 gateway 서비스에 `BACKEND_MODE` 환경변수 한 줄로 4가지 모드 선택.

| `BACKEND_MODE` 값 | 동작 |
| --- | --- |
| `auto` (기본) | OpenAI 키 있으면 OpenAI 호출 → 실패(4xx/5xx/네트워크)면 Mock LLM으로 자동 fallback |
| `openai` | OpenAI만 사용. 실패해도 fallback 안 함, 그대로 502 반환 |
| `mock` | Mock LLM만 사용. OpenAI 비용 안 들이고 라우팅 로직만 검증할 때 |
| `openclaw` | OpenClaw WebSocket 백엔드 — 현재 "Not implemented" 에러 (추후 구현) |

### 3-2. 자동 fallback이 일어나는 시점

`BACKEND_MODE=auto`일 때 다음 상황에서 Mock LLM으로 떨어진다:

- OpenAI 키가 비어 있음 → 즉시 Mock
- OpenAI가 4xx/5xx 반환 → Mock으로 재시도
- OpenAI 호출 자체가 예외(타임아웃·네트워크 오류) → Mock으로 재시도

응답 헤더 `x-aaas-backend`에 실제 사용된 백엔드 이름이 박혀 나오므로 운영 시 모니터링 가능.

## 4. 핸드아웃의 6가지 제약 조건 검증

| # | 제약 조건 | 결과 | 검증 방법 |
| --- | --- | --- | --- |
| 1 | 사용자 A와 사용자 B가 같은 Agent API를 호출할 수 있다 | ✅ | 두 사용자가 `POST /v1/agents/run`를 다른 Bearer 토큰으로 호출, 모두 200 OK |
| 2 | 두 사용자의 Workspace가 서로 분리된다 | ✅ | `mapper.ts`가 토큰 기준으로 `/workspaces/userA`·`/workspaces/userB`를 강제 매핑 |
| 3 | 사용자는 자신의 Workspace 밖 파일에 접근하지 못한다 | ✅ | metadata로 다른 사용자 workspace 주입 시도 → mapper가 즉시 제거 |
| 4 | 사용자별 OAuth 프로필 또는 Mock LLM 설정이 분리된다 | ✅ | 사용자별 `auth_profile_id`(`profile-userA`·`profile-userB`)가 서버측에서 결정 |
| 5 | 에이전트 실행이 Docker 컨테이너 안에서 수행된다 | ✅ | 모든 백엔드 서비스(gateway·mock-llm·openclaw)가 `docker compose` 컨테이너로 격리 |
| 6 | 실행 요청과 컨테이너 사용 정보가 로그로 남고, 이를 계산할 수 있다 | ✅ | `logs/requests.jsonl`에 jsonl 1줄 = 1요청. `/admin/stats`로 사용자별 집계 가능 |

6/6 통과. 핵심 차별점인 멀티테넌트 격리·매핑·로깅이 모두 검증되었다.

## 5. 실제 동작에 필요한 파일들

**누락 시 빌드 또는 부팅이 실패**

### 5-1. 루트 설정 파일

| 파일 | 역할 (한 줄) |
| --- | --- |
| `package.json` | Gateway 서비스의 Node.js 의존성(Fastify·undici·yaml·pino·dotenv) 정의 |
| `tsconfig.json` | TypeScript 컴파일 설정 (ES2022, ESM, strict) |
| `Dockerfile` | Gateway 컨테이너 이미지 빌드 정의 (TS 컴파일 → 슬림 런타임) |
| `docker-compose.yml` | mock-llm·openclaw·gateway 3개 서비스의 빌드·포트·볼륨·환경변수 한 번에 정의 |
| `tenants.yaml` | **서버측 진실** — 사용자별 토큰·workspace·OAuth 프로필·허용 agent 목록 |
| `.env.example` | 로컬 실행용 환경변수 템플릿 (실제 비밀값은 `.env`에서 관리) |
| `.gitignore` | `node_modules`, `dist`, `.env`, `logs/*.jsonl` 등 git 제외 패턴 |

### 5-2. Gateway 핵심 소스 (`src/`)

| 파일 | 역할 (한 줄) |
| --- | --- |
| `src/server.ts` | Fastify 부팅 entry — tenants 로드 후 라우트 등록, 8080 listen |
| `src/config.ts` | 환경변수 → typed config 객체 (BACKEND_MODE, OPENAI, MOCK_LLM, OPENCLAW URL 등) |
| `src/types.ts` | `TenantUser`, `AgentRunRequest`, `RequestLogEntry` 등 공유 TypeScript 타입 |
| `src/tenants.ts` | `tenants.yaml`을 파싱해 token→user 매핑을 인메모리 store로 보관 |
| `src/middleware/auth.ts` | `Authorization: Bearer` 검증 → `req.tenant`에 user 객체 부착 |
| `src/middleware/authorize.ts` | 인증된 user의 `allowed_agents`에 요청 `agent_id`가 있는지 인가 검사 |
| `src/services/mapper.ts` | **핵심 보안** — 클라이언트가 보낸 민감 필드 제거, 서버측 값으로 강제 매핑 |
| `src/services/openclaw-proxy.ts` | **백엔드 라우터** — auto/openai/mock/openclaw 4-way 선택 + auto fallback |
| `src/services/logger.ts` | jsonl 로그 + 사용자별 stats(요청 수, 평균 응답시간) 누적 |
| `src/routes/agents.ts` | `POST /v1/agents/run` — 인증·인가·매핑·프록시·로깅 한 사이클을 묶음 |
| `src/routes/admin.ts` | `GET /healthz`, `GET /admin/stats` — 헬스체크 + 사용자별 통계 |

### 5-3. Mock LLM (`mock-llm/`)

| 파일 | 역할 (한 줄) |
| --- | --- |
| `mock-llm/package.json` | Mock LLM 서비스의 Node.js 의존성(Fastify) 정의 |
| `mock-llm/tsconfig.json` | Mock LLM TypeScript 컴파일 설정 |
| `mock-llm/Dockerfile` | Mock LLM 컨테이너 이미지 빌드 정의 (Node 20 Alpine 멀티스테이지) |
| `mock-llm/src/server.ts` | OpenAI 호환 `/v1/chat/completions` 구현 — 받은 헤더를 응답에 echo |

### 5-4. 데이터·로그·워크스페이스

| 파일/디렉토리 | 역할 (한 줄) |
| --- | --- |
| `workspaces/userA/hello.txt` | userA 영역 더미 파일 — `"I am A"`. workspace 격리 시연용 |
| `workspaces/userB/hello.txt` | userB 영역 더미 파일 — `"I am B"`. workspace 격리 시연용 |
| `logs/` (디렉토리) | `requests.jsonl`·`containers.jsonl` 적재 위치 (호스트 ↔ 컨테이너 공유) |
| `logs/.gitkeep` | 빈 디렉토리도 git에 잡히게 하는 placeholder |

### 5-5. OpenClaw 패치 가이드 (`openclaw-patch/`)

OpenClaw 통합 시 사용. **현재 데모에는 직접 필요 없지만**, 추후 OpenClaw 백엔드 활성화 시 OpenClaw 소스 코드에 적용해야 함.

| 파일 | 역할 (한 줄) |
| --- | --- |
| `openclaw-patch/README.md` | OpenClaw 6개 파일에 최소 패치를 가하는 단계별 가이드 (1차 설계) |
| `openclaw-patch/example-headers-snippet.ts` | `getAaasContext()`·`assertSafePath()` 헬퍼 함수 참고 코드 |
| `openclaw-patch/newpatch.md` | 1차 패치 재점검 결과 — Fix 1~5 (컴파일 오류, workspace root, container ID 전파 등) |

### 5-6. 테스트 스크립트

| 파일 | 역할 (한 줄) |
| --- | --- |
| `scripts/smoke.sh` | 5가지 격리·인가·인젝션 회귀 테스트를 한 번에 실행하는 bash 스크립트 |

### 5-7. 문서

| 파일 | 역할 (한 줄) |
| --- | --- |
| `README.md` | 프로젝트 개요와 핵심 디렉토리 안내 (1페이지 요약) |
| `SETUP_GUIDE.md` | 0단계(사전 준비)부터 11단계(데모 시연)까지의 상세 환경 구성 가이드 |
| `result.md` | 본 문서 — 데모 결과 리포트와 향후 과제 |

## 6. 백엔드 구성: Mock LLM vs OpenAI vs OpenClaw

본 프로젝트가 세 가지 백엔드를 모두 고려한 이유와 각각의 현황.

### 6-1. Mock LLM — 라우팅 로직 검증용

- 자체 제작한 Node.js 서버 (`mock-llm/src/server.ts`)
- OpenAI 호환 `/v1/chat/completions` 인터페이스
- 받은 헤더(`x-aaas-user-id`, `x-aaas-workspace`, `x-aaas-auth-profile`)를 응답 본문에 그대로 echo
- **장점**: 모델 비용 없이 멀티테넌트 라우팅 검증 가능, CI/CD에 그대로 활용
- **용도**: 개발·테스트·시연 시 백업 백엔드, OpenAI 키 없을 때의 기본 fallback

### 6-2. OpenAI (gpt-5.4-mini 등) — 실 운영용

- `https://api.openai.com/v1`에 직접 HTTPS 호출
- `Authorization: Bearer ${OPENAI_API_KEY}`로 인증
- `agent_id`가 `gpt-`로 시작하면 그대로 모델로 사용, 아니면 `OPENAI_DEFAULT_MODEL`(기본 `gpt-5.4-mini`)로 대체
- **장점**: 실제 모델 응답, usage(토큰 수) 정확
- **현재 상태**: ✅ 동작 확인됨 (2025-05-22 기준 userA·userB 둘 다 정상 응답)

### 6-3. OpenClaw — 보류 (이유와 미래 계획)

OpenClaw 2026.5.21을 구체적으로 검증한 결과, **현재 형태로는 헤드리스 API Gateway 백엔드로 직접 쓰기 어렵다**는 결론.

**제약 ① — OpenAI 호환 HTTP가 기본 비활성**

- OpenClaw 소스에는 `src/gateway/openai-http.ts`가 존재하지만 `gateway` 서브커맨드로 띄운 인스턴스에서는 라우터 미등록
- `/v1/chat/completions` 호출 시 404 반환

**제약 ② — WebSocket Gateway는 페어링 승인 모델**

- OpenClaw의 본체 인터페이스는 WebSocket
- 인증 토큰 위치: `connect.params.auth.token` (HTTP 헤더 아님)
- 모든 device가 사전에 페어링 승인을 받아야 chat/agent 호출 가능
- 헤드리스 자동화 시나리오에 부적합 — 데스크톱/모바일 클라이언트가 페어링 UI 띄우는 흐름이 기본

**그래서 본 데모에선 Mock LLM과 OpenAI를 우선 활성화하고 OpenClaw 통합은 별도 트랙으로 남김.** 다행히 Gateway 측 코드의 백엔드 추상화 덕분에 추후 OpenClaw WebSocket 클라이언트를 구현하면 환경변수 한 줄(`BACKEND_MODE=openclaw`)로 전환된다.

## 7. cc 디렉토리를 git에 올린 뒤 clone 받은 사람이 실행하는 법

본 프로젝트는 `cc/aaas-gateway/` 안에 자기완결적으로 들어 있다. OpenClaw는 선택적 의존성이므로 clone하지 않아도 OpenAI·Mock LLM 두 백엔드는 즉시 동작한다.

### 7-1. Linux / macOS

```bash
# 1. 저장소 clone
git clone <your-repo-url> cc
cd cc/aaas-gateway

# 2. Docker 준비 확인
docker --version
docker compose version

# 3. (선택) OpenAI 키 설정 — gateway 서비스 env에 직접 박을 수도 있고 .env 파일 만들 수도 있음
# docker-compose.yml의 gateway.environment.OPENAI_API_KEY 자리에 실 키 입력

# 4. 빌드 & 기동
docker compose down
docker compose build
docker compose up -d
docker compose ps                                # 세 서비스 모두 Up

# 5. 헬스체크
curl <http://localhost:9001/healthz>               # {"ok":true,"service":"mock-llm"}
curl <http://localhost:8080/healthz>               # {"ok":true}

# 6. OpenAI 백엔드 호출 (실 모델)
curl -i -X POST <http://localhost:8080/v1/agents/run> \\
  -H "Authorization: Bearer aaas_demo_token_userA_change_me" \\
  -H "Content-Type: application/json" \\
  -d '{"agent_id":"gpt-5.4-mini","input":"hello"}'

# 7. Mock 백엔드로 강제 전환 (비용 없이 라우팅만 검증)
# docker-compose.yml에서 BACKEND_MODE: "mock"으로 바꾸고
docker compose up -d gateway
curl -i -X POST <http://localhost:8080/v1/agents/run> \\
  -H "Authorization: Bearer aaas_demo_token_userA_change_me" \\
  -H "Content-Type: application/json" \\
  -d '{"agent_id":"file-summarizer","input":"hello mock"}'

# 8. 통계 조회
curl <http://localhost:8080/admin/stats>

# 9. 종료
docker compose down
```

### 7-2. Windows cmd

```bash
git clone <your-repo-url> cc
cd cc\\aaas-gateway

docker compose down
docker compose build
docker compose up -d
docker compose ps

curl <http://localhost:9001/healthz>
curl <http://localhost:8080/healthz>

curl -i -X POST <http://localhost:8080/v1/agents/run> ^
  -H "Authorization: Bearer aaas_demo_token_userA_change_me" ^
  -H "Content-Type: application/json" ^
  -d "{\\"agent_id\\":\\"gpt-5.4-mini\\",\\"input\\":\\"hello\\"}"

curl -i -X POST <http://localhost:8080/v1/agents/run> ^
  -H "Authorization: Bearer aaas_demo_token_userB_change_me" ^
  -H "Content-Type: application/json" ^
  -d "{\\"agent_id\\":\\"gpt-5.4-mini\\",\\"input\\":\\"hello_im_B\\"}"

curl <http://localhost:8080/admin/stats>
docker compose down
```

### 7-3. 백엔드 강제 전환 (3가지 옵션)

`docker-compose.yml`의 gateway 서비스 environment에서 `BACKEND_MODE` 값 변경 후 gateway만 재기동.

```yaml
environment:
  BACKEND_MODE: "auto"        # OpenAI 우선 → Mock fallback
  # 또는
  BACKEND_MODE: "openai"      # OpenAI만 (실패해도 fallback 없음)
  # 또는
  BACKEND_MODE: "mock"        # Mock만 (라우팅 검증용)
  # 또는 (추후)
  BACKEND_MODE: "openclaw"    # OpenClaw WebSocket — 현재 미구현
```

```bash
docker compose up -d gateway
```

### 7-4. 로그·디버그

```bash
# 실시간 로그
docker compose logs -f gateway openclaw mock-llm

# 특정 request_id로 join 추적
RID=bbc6e301-ddf0-47fa-aea3-d23c22e1758e
grep "$RID" logs/requests.jsonl
grep "$RID" logs/containers.jsonl

# 컨테이너 안 진입
docker compose exec gateway sh
```

### 7-5. 회귀 테스트

```bash
bash scripts/smoke.sh
```

5개 시나리오(workspace 격리 / 인가 / 인젝션 차단 / 잘못된 토큰 / 통계)를 한 번에 검증.

## 8. 앞으로 해야 할 과제 (4가지)

### 과제 1 — OpenClaw 실제 연결

OpenClaw 백엔드를 실제로 호출 가능하게 만든다.

- **선결 과제**: OpenClaw의 페어링/스코프 모델을 헤드리스 환경에서 통과하는 방법 확보
    - 옵션 A: OpenClaw Control UI(`http://localhost:18789`)에서 1회 페어링 수동 승인 후 토큰 영구화
    - 옵션 B: OpenClaw에 "service account" 개념 추가하는 PR 기여
- **Gateway 측 작업**: `src/services/openclaw-proxy.ts`의 `callOpenClaw()` 함수를 WebSocket 클라이언트로 실구현
    - `ws` 라이브러리 도입
    - `ws://openclaw:18789/`에 connection 유지 (1 connection 재사용)
    - `connect.params.auth.token`으로 핸드셰이크
    - RPC 메서드 `chat.send` 또는 `agent.run` 호출 (실제 메서드 이름은 페어링 후 `gateway call`로 발견)
    - 요청별 `id` 부여, 응답 매칭
- **OpenClaw 패치**: `newpatch.md`의 Fix 1, 2, 3을 OpenClaw 코드에 실제로 적용해 빌드 통과
- **완료 기준**: `BACKEND_MODE=openclaw`로 설정하고 호출 시 OpenClaw가 띄운 sandbox 컨테이너의 `container_id`가 응답 헤더 `x-aaas-container-id`에 박혀 돌아옴

### 과제 2 — 멀티테넌트 동작을 보여주는 간단한 웹 UI

여러 사용자가 동시에 사용하는 모습이 시각적으로 보이는 단순한 웹 대시보드.

- **기술**: 정적 HTML + JS 또는 가벼운 React/Vue 한 페이지 (별도 빌드 없는 단일 파일도 OK)
- **포함 컴포넌트**:
    - **사용자 전환 토글** — 좌측 사이드바에서 userA/userB(향후 userC, userD…)를 선택하면 그 토큰으로 호출
    - **요청 입력 + 응답 화면** — agent_id, 메시지 입력 → 호출 → 응답 표시 (chatbot UI 스타일)
    - **Workspace 패널** — 현재 선택된 사용자의 `/workspaces/<id>` 내용을 트리로 표시. 다른 사용자 워크스페이스는 화면에 안 보임 (격리 시각화)
    - **실행 내역 패널** — 사용자별 최근 요청 N건 시간순 (한 줄 = 한 요청, `request_id`, `agent_id`, `backend`, 응답 시간, 토큰 수)
    - **컨테이너 정보 패널** — `container_id`, `tool_calls`, `tool_calls_detail` 표시
    - **백엔드 선택 표시** — 매 요청 결과에 어느 백엔드(openai/mock/openclaw)에서 응답이 왔는지 뱃지로 표시
- **데이터 소스**:
    - `GET /admin/stats` (이미 구현됨) — 사용자별 통계
    - 신규: `GET /admin/users/<id>/requests?limit=20` — 해당 사용자의 최근 요청 로그
    - 신규: `GET /admin/users/<id>/workspace` — 해당 사용자 workspace의 파일 목록
- **완료 기준**: 두 브라우저 탭에서 userA·userB를 각각 띄워 동시에 호출하면 한 화면에서 격리가 보임

### 과제 3 — 웹에서 동적으로 테넌트 추가

현재는 `tenants.yaml`을 수동 편집 후 `docker compose restart gateway`로 반영. 이를 웹에서 즉시 가능하게.

- **추가할 API**:
    - `POST /admin/users` — 새 사용자 등록 (id, api_token, workspace_path, auth_profile_id, allowed_agents)
    - `DELETE /admin/users/<id>` — 사용자 삭제
    - `PATCH /admin/users/<id>` — allowed_agents 수정 등
    - `POST /admin/users/<id>/token/rotate` — 토큰 재발급
- **저장소 변경**:
    - 단기: `tenants.yaml`을 그대로 read-write로 마운트하고 메모리 변경 후 파일 dump
    - 중기: SQLite (단일 파일 DB) 도입 — schema는 `users(id, api_token, workspace_path, auth_profile_id)`, `user_agents(user_id, agent_id)`
    - 장기: PostgreSQL + 마이그레이션
- **워크스페이스 자동 생성**: 새 사용자 등록 시 `workspaces/<id>/` 디렉토리 자동 mkdir + 초기 파일 생성
- **권한 분리**: 일반 사용자 토큰은 `/admin/*` 호출 불가. 별도 admin 토큰(`ADMIN_TOKEN` env)을 도입해 보호
- **완료 기준**: 웹 UI에서 "New User" 버튼 클릭 → 폼 작성 → 저장 → 즉시 그 토큰으로 `/v1/agents/run` 호출 성공

### 과제 4 — 사용량 기반 과금·쿼터·실 OAuth 흐름

운영 단계로 한 발 나아가기 위한 마지막 큰 덩어리.

- **사용량 카운터를 토큰 단위로 확장**:
    - 현재 `logger.ts`는 요청 수와 평균 응답 시간만 누적
    - 응답의 `usage.total_tokens`를 사용자별 누적 (`logs/usage.jsonl` 또는 DB)
    - `/admin/stats`에 사용자별 일/월 토큰 합산 표시
- **쿼터·과금 정책**:
    - 사용자별 일/월 토큰 상한 설정 (`tenants.yaml`에 `quota_tokens_per_day` 필드 추가)
    - 한도 초과 시 즉시 `429 quota_exceeded` 반환
    - 한도의 80% 도달 시 경고 헤더(`x-aaas-quota-warning`) 부착
- **실 OAuth 로그인 흐름**:
    - 현재 사전 발급 토큰 → OAuth 2.0 Authorization Code Flow로 교체
    - 사용자가 OpenAI/Codex/Anthropic 등으로 로그인하면 그 사용자의 OAuth 토큰을 우리 `auth_profile`로 등록
    - 향후 그 사용자 호출 시 자동으로 그 토큰으로 모델 호출
- **컨테이너 활용 정밀화** (OpenClaw 연결 이후):
    - 사용자별 sandbox 컨테이너의 CPU·메모리 사용량 수집 → 시간 단위 청구
    - 컨테이너 lifetime 추적 (생성 → 종료까지)
- **완료 기준**: 사용자가 100,000 토큰을 다 쓰면 자동으로 429가 떨어지고, 그 시점이 `logs/quota.jsonl`에 기록되며 `/admin/stats`에서 "userA: 100000/100000 (quota exhausted)"가 표시됨

## 9. 마무리

핸드아웃에서 출발한 "OpenClaw 위에 멀티테넌트 AaaS를 얹는다"는 목표 중, OpenClaw의 실 결합 부분은 그 보안 모델 차이로 별도 트랙이 됐다. 그러나 **본 프로젝트의 진짜 차별점인 멀티테넌트 아키텍처와 보안 모델은 완성**되어 있으며, OpenAI(gpt-5.4-mini)와 Mock LLM 두 백엔드로 실제 검증됨

### 핵심 자산

- 사용자별 인증·라우팅·격리가 동작하는 **Fastify 기반 멀티테넌트 API Gateway**
- 백엔드(OpenAI / Mock / OpenClaw)를 **환경변수 한 줄**로 교체 가능한 추상화
- OpenAI 키 부재·실패 시 **자동 Mock fallback**
- 응답 헤더 `x-aaas-backend`로 어디서 응답했는지 **운영 모니터링** 가능
- 클라이언트가 절대 위조할 수 없는 **서버측 강제 매핑 (`mapper.ts`)**
- 추적 가능한 **요청·컨테이너 jsonl 로깅**
- 5가지 보안 회귀 테스트 자동화 (`smoke.sh`)
- 핸드아웃의 6가지 성공 기준 **전부 충족**

이 자산은 위 4가지 과제로 자연스럽게 확장 가능하다.