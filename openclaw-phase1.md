이전과 똑같이 컨테이너를 띄우는 작업을 진행하시고, http://localhost:18789/로 이동하면 장치와 연결하라는 창이 나옵니다. 게이트웨이 토큰에 "internal-aaas-to-openclaw-token-change-me"라고 입력하면 승인이 안 될 건데, 

1) 현재 장치 목록 확인
docker compose exec openclaw sh -c "node openclaw.mjs devices list --token internal-aaas-to-openclaw-token-change-me"
2) 페어링 요청 승인 (UI가 알려준 ID 그대로)
docker compose exec openclaw sh -c "node openclaw.mjs devices approve [id] --token internal-aaas-to-openclaw-token-change-me"

이렇게 두 커맨드로 pending상태의 요청을 paired로 만들어주시면 됩니다. 자세한 내용은 openclaw-pairing_cmdlogs.txt에 있습니다.
아래는 현재까지의 진행상황을 클로드가 정리해준 내용입니다!

# OpenClaw 통합 Phase 1 — 회고와 다음 단계 (openclaw-phase1.md)

## 0. Phase 1 성공 요약

| 항목 | 결과 |
|------|------|
| Gateway → OpenClaw 호출 경로 | ✅ docker exec + CLI subprocess로 동작 |
| 사용자별 sessionKey 격리 | ✅ `aaas:user:userA`, `aaas:user:userB` |
| OpenClaw Dashboard에서 세션 시각화 | ✅ 같은 agent의 두 세션이 분리되어 표시 |
| 응답 헤더 `x-aaas-backend: openclaw` | ✅ |
| runId 사용자별 분리 발급 | ✅ 두 호출이 다른 runId 반환 |
| 멀티 백엔드 토글 (mock / openai / openclaw) | ✅ `BACKEND_MODE` 한 줄로 전환 |

핸드아웃 §3~§6의 6가지 목표 중 **5개 충족**, "사용자별 OAuth 프로필 분리"는 sessionKey 기반으로 부분 충족(완전한 OAuth 분리는 Phase 2 과제).

## 1. 현재 구조

```
Client (curl/웹)
     │ Bearer 토큰
     ▼
[AaaS Gateway :8080]
  - mapper.ts (워크스페이스/프로필 강제 매핑)
  - openclaw-cli.ts (docker exec subprocess)
     │
     │  docker exec aaas-openclaw \
     │    node openclaw.mjs gateway call chat.send \
     │    --params {sessionKey: aaas:user:<id>, message, idempotencyKey} \
     │    --token <gateway-token>
     ▼
[OpenClaw :18789]
  - 같은 agent("main")
  - sessionKey별 별도 세션
     │
     ▼
[OpenAI / Codex API]
```

핵심 메커니즘: **OpenClaw의 sessionKey가 우리의 user_id를 인코딩**한다. OpenClaw 자체는 멀티테넌트를 모르고 sessionKey만 보지만, 그 sessionKey 명명 규칙이 사용자 격리를 만든다.

## 2. 사용자가 식별한 한계 3가지

### 한계 [1] — 단일 agent 설정 공유

같은 `agent_id: main`을 모든 사용자가 공유하므로, OpenClaw config의 agent 정의(시스템 프롬프트, 이름, 답변 스타일, IDENTITY.md, USER.md, MEMORY.md)가 **전 사용자에게 동일하게 적용**된다.

**현재 동작**:
- 사용자별로 질의·응답은 분리(sessionKey 격리 덕분)
- 그러나 사용자가 자기만의 호칭, 페르소나, 컨텍스트 파일을 가질 수 없음
- 한 사용자가 OpenClaw 대시보드에서 agent 설정을 바꾸면 즉시 모두에게 적용

**왜 이런가**:
- OpenClaw의 agent는 글로벌 config 객체(`cfg.agents.list`)에 등록됨
- 세션은 agent 인스턴스의 하위 개념일 뿐, 별도 agent로 분리 안 됨
- IDENTITY.md 등 도메인 파일은 agent의 `agentDir`에 한 벌만 존재

**해결 방향(Phase 2)**:
- **2-A**: Docker bind mount overlay로 sessionKey별 IDENTITY.md/USER.md/MEMORY.md를 다르게 마운트
- **2-B**: 사용자별로 별도 agent 등록 (`tenants.yaml`의 `auth_profile_id`를 agent ID로도 활용)
- **2-C**: OpenClaw에 "per-session context overlay" 기능을 PR로 추가

### 한계 [2] — 요청 직렬화 (한 사용자 응답 끝나야 다른 사용자 차례)

OpenClaw 인스턴스 하나가 chat.send를 순차 처리하면, userA의 모델 호출이 30초 걸릴 때 userB의 호출도 그만큼 대기.

**왜 이런가**:
- 우리 Gateway는 비동기로 OpenClaw에 던지지만(runId 즉시 반환), OpenClaw 내부의 agent runtime은 sessionKey별로 직렬 처리될 수 있음
- 같은 agent를 공유하므로 model rate limit, tool execution, sandbox 컨테이너 등이 공통 리소스
- 특히 OpenClaw가 sandbox 컨테이너 1개를 재사용하면 그게 병목

**해결 방향(Phase 2)**:
- **2-D**: OpenClaw 인스턴스 멀티화 — 호스트에 N개 OpenClaw 컨테이너를 띄우고 Gateway가 user_id 해시로 round-robin
- **2-E**: OpenClaw의 `agents.defaults.sandbox.scope: per-session` 설정으로 sandbox 컨테이너를 sessionKey별로 분리(OpenClaw 지원 시)
- **2-F**: 동시 호출 임계치 도달 시 사용자별 큐 + QoS

### 한계 [3] — 워크스페이스가 사실상 공유

같은 agent를 쓰면 OpenClaw가 보는 workspace 디렉토리도 같다. 우리 `/workspaces/userA`, `/workspaces/userB`로 분리해 두었지만, **agent가 어느 workspace를 사용할지는 sessionKey/agent config가 결정**한다. 명시적 매핑이 없으면 OpenClaw 기본 workspace 하나만 보고, 다른 사용자가 만든 파일도 보인다.

**현재 상태**:
- `tenants.yaml`의 `workspace_path`가 우리 Gateway 측에서는 정확히 분리되어 있음
- 그러나 OpenClaw 측 RPC 파라미터에 workspace를 직접 주입할 방법이 없음(chat.send schema에 workspace 필드 없음)
- 결과: OpenClaw가 agent config의 글로벌 workspace를 사용 → 사실상 공유

**해결 방향(Phase 2)**:
- **2-G**: sessionKey별 workspace를 OpenClaw config의 `agents[i].workspace`에 동적 등록(우리 newpatch Fix 2를 더 확장)
- **2-H**: 사용자별 별도 agent로 분리하면(2-B와 결합) 자연스럽게 workspace도 분리
- **2-I**: OpenClaw에 chat.send의 params에 `workspaceOverride`를 받는 옵션 추가 PR

## 3. 추가로 발견한 한계 — 7가지

### 한계 [4] — CLI subprocess overhead

매 요청마다 `docker exec aaas-openclaw node openclaw.mjs ...`를 spawn한다. 콜드 스타트가 200~600ms씩 추가되어, QPS 5~10 이상에서 병목. 메모리 사용도 spawn 횟수에 비례.

**해결 방향**:
- WebSocket native client로 교체(OpenClaw preauth handshake 프로토콜 reverse-engineer)
- 또는 sidecar HTTP 브릿지 서비스 구축(openclaw CLI를 호스팅하는 long-running daemon)
- 또는 Gateway 안에서 connection pool로 spawn 재사용

### 한계 [5] — 권한 granularity 부족

`tenants.yaml`의 `auth_profile_id`가 정의되지만 실제 OpenClaw 호출 시 그 값이 사용되지 않는다(chat.send schema에 auth profile 필드 없음). 모든 사용자가 동일한 OpenAI API key(OpenClaw 컨테이너 환경변수)로 호출되어 **개인별 OAuth 토큰 분리가 미구현**.

**해결 방향**:
- OpenClaw에 sessionKey별 model-auth profile 매핑 추가(newpatch Fix 5의 확장)
- OAuth 2.0 Authorization Code Flow 도입해 사용자별 OAuth 토큰 발급·저장
- OpenAI Project ID(개별 사용자 = 개별 project)로 비용 분리

### 한계 [6] — 사용량 추적이 사용자 단위가 아님

OpenClaw가 사용한 토큰은 단일 OpenAI key의 총 사용량으로 합산되어, 사용자별 토큰 소비량을 정확히 추적·과금하기 어렵다. 우리 Gateway는 요청 수·평균 응답시간만 카운트.

**해결 방향**:
- OpenClaw가 응답에 `usage.total_tokens`를 포함하도록 → Gateway가 사용자별 누적
- 또는 OpenAI Project ID별 청구서로 사후 분리
- Phase 2-J: 사용자별 토큰 quota 강제 + 한도 초과 시 429

### 한계 [7] — 스트리밍 응답 미지원

현재 chat.send는 `{"status":"started"}`만 즉시 반환. 실제 chat 응답은 OpenClaw 내부에서 진행되며 Gateway가 그것을 가져와 클라이언트에 streaming back하는 메커니즘이 없다. 클라이언트는 "응답 완성"을 알 길이 없다.

**해결 방향**:
- Gateway → 클라이언트 SSE 또는 WebSocket 연결로 OpenClaw events 중계
- 또는 `agent.wait` RPC로 폴링 후 한 번에 반환(latency 증가)
- OpenClaw event ledger를 구독하는 패턴

### 한계 [8] — 페어링·scope 모델이 헤드리스에 부적합

OpenClaw는 모든 device가 페어링 승인 + scope upgrade를 받아야 한다. 운영자가 매번 수동 승인해야 하므로 **자동화된 무인 배포가 어렵다**. 우리는 docker socket을 통한 docker exec로 우회했지만 보안상 trade-off.

**해결 방향**:
- OpenClaw에 service-account 개념 PR 기여(사람 승인 없이 사전 등록된 device가 즉시 full scope)
- 또는 페어링 정보를 named volume에 영구 저장(이미 적용)
- 자동화 setup 스크립트로 첫 부팅 시 페어링 일괄 처리

### 한계 [9] — Docker socket 노출이라는 영구 보안 부채

Gateway 컨테이너에 `/var/run/docker.sock`이 마운트되어 있는 한, Gateway가 침해되면 호스트 root와 동등한 권한이 노출된다. Phase 1에서 일시 수용한 trade-off이지만 실 운영에는 부적합.

**해결 방향**:
- Docker-in-Docker(DinD) 사이드카로 격리
- 또는 rootless 런타임(Podman, gVisor, Kata)으로 sandbox 전환
- 또는 native WebSocket 통신으로 전환해 docker exec 자체 제거

### 한계 [10] — 워크스페이스가 같은 호스트 uid로 마운트

`/workspaces/userA`와 `/workspaces/userB`가 호스트의 동일 uid 소유. sandbox 컨테이너가 root로 실행되면 두 디렉토리 모두 쓰기 가능. setuid·심볼릭 링크 등으로 격리 우회 가능성.

**해결 방향**:
- 사용자별 다른 uid로 sandbox 컨테이너 실행 (`docker run --user 1001:1001` 사용자별 가변)
- 워크스페이스 디렉토리 권한을 700으로 사용자별 분리
- Linux user namespaces 활용

## 4. 기존 OpenClaw 생태계와의 차이점·의의

### 기존 OpenClaw 사용 시나리오

OpenClaw는 본래 **단일 사용자(operator)의 데스크톱 에이전트 도구**다. 전형적 사용자 흐름:

1. 개인이 자기 컴퓨터에 OpenClaw 설치
2. `openclaw setup`으로 자기 OpenAI 키 등록, 워크스페이스 지정
3. `openclaw dashboard`로 브라우저 UI 진입 (자기 한 device가 페어링)
4. 같은 컴퓨터의 모든 작업이 그 한 명의 운영자 신원으로 수행됨
5. 다른 사람과 OpenClaw 인스턴스 공유 = 그 사람과 OAuth 토큰·워크스페이스·사용 이력 전체 공유

**제약**: 한 명이 자기 OpenAI 토큰으로 자기 데이터에서만 동작. 팀이 같은 OpenClaw 인스턴스를 쓰려면 OAuth 토큰을 공유해야 하므로 사실상 불가능.

### 우리 AaaS Gateway의 변화

같은 OpenClaw 인스턴스를 **공용 서버**로 두고, **앞에 멀티테넌트 Gateway**를 세워 다음을 분리:

| 분리 차원 | OpenClaw 단독 | + AaaS Gateway |
|----------|---------------|----------------|
| **인증** | 단일 device 페어링 | 사용자별 Bearer 토큰 (확장 가능) |
| **워크스페이스** | 단일 글로벌 디렉토리 | 사용자별 디렉토리(Gateway가 매핑) |
| **세션** | 운영자 한 명의 세션들 | sessionKey로 사용자별 분리 |
| **로깅** | OpenClaw 내부 로그 | Gateway가 사용자별 요청 jsonl 적재 |
| **권한** | 운영자 = admin | 사용자별 allowed_agents 화이트리스트 |
| **모델 비용** | 운영자 OpenAI key | (Phase 2) 사용자별 OAuth/quota |

### 핵심 의의

**핸드아웃 §4 그대로**: OpenClaw가 "에이전트를 안전하게 실행하는 엔진"이라면, 본 프로젝트는 그 엔진을 **여러 사용자가 공유할 수 있는 공용 Agent 서비스로 감싸는 작업**이다.

구체적 의의 4가지:

1. **OpenClaw를 SaaS-ready 백엔드로 만든다** — 데스크톱 도구를 서버 서비스로 격상.
2. **운영 효율** — 한 인스턴스로 N명을 서비스. OpenClaw·Docker·모델 클라이언트가 사용자마다 따로 구동되지 않아도 됨.
3. **중앙 거버넌스** — admin이 모든 사용자의 요청을 한 곳에서 감사·통제·과금 가능.
4. **공용 Agent 서비스 패턴의 검증** — 본 프로젝트의 추상화(Gateway + sessionKey 매핑 + 권한 분리)는 OpenClaw 뿐 아니라 **임의의 단일 사용자용 agent 시스템**에 일반화 가능. 같은 패턴을 LangChain agent, AutoGPT, AgentKit 등에도 적용 가능.

### 무엇이 새로운가 — 한 문장

> 기존 OpenClaw 사용자는 "내 OpenClaw"를 자기 컴퓨터에서 돌렸고, 우리는 "**우리 OpenClaw**"를 팀이 함께 쓰면서도 각자의 작업은 격리된다는 것을 가능하게 만들었다.

## 5. Phase 2 발전 방향 — 12개 트랙

본 Phase 1을 토대로 다음 12개 트랙으로 확장 가능. 우선순위는 demo 가치·구현 난이도 기준 4단계로 분류.

### Track A — 사용자 개별화 (High priority, Medium effort)

**2-A. sessionKey별 IDENTITY/USER/MEMORY 분리**
- 사용자별 디렉토리(`./contexts/userA/IDENTITY.md`)를 만들고 sandbox 컨테이너에 동적 bind mount
- Gateway가 호출 직전 docker exec로 OpenClaw 컨테이너 내부 path를 overlay
- 결과: 한 사용자가 "민호"라고 부르도록 설정해도 다른 사용자에게는 영향 없음

**2-B. 사용자별 별도 agent 등록**
- `tenants.yaml`의 `auth_profile_id`를 OpenClaw agent ID로 활용
- 부팅 시 OpenClaw config에 사용자 수만큼 agent 자동 등록
- 결과: agent별 워크스페이스·시스템 프롬프트·심지어 모델까지 분리

### Track B — 동시성·성능 (High priority, High effort)

**2-D. OpenClaw 인스턴스 풀**
- OpenClaw 컨테이너를 N개 띄우고 Gateway가 user_id 해시로 round-robin
- 사용자별 큐잉이 자연스럽게 부하 분산
- N=3~5면 5인 동시 시연 충분

**2-F. 사용자별 QoS · 요청 큐**
- premium 사용자는 우선순위 큐
- free 사용자는 N초 throttle

### Track C — 워크스페이스 격리 강화 (Medium priority, Medium effort)

**2-G. sessionKey → workspace 동적 매핑**
- OpenClaw가 chat.send 호출 시 sessionKey를 보고 자체 workspace path 결정
- newpatch Fix 2의 확장 (sessionKey 기반 lookup)

**2-H. OS-level user 격리**
- 각 sandbox 컨테이너를 사용자별 uid로 실행
- 워크스페이스 디렉토리 권한 700, 사용자별 owner

### Track D — 인증·과금 (Medium priority, High effort)

**2-E. 실 OAuth 2.0 흐름**
- 사용자가 OpenAI/Codex/Anthropic으로 로그인 → 토큰 발급
- Gateway가 사용자별 OAuth 토큰을 OpenClaw에 dynamic injection
- 결과: 각 사용자 비용이 자기 OAuth 계정으로 청구

**2-J. 사용량 quota·과금**
- 사용자별 토큰 누적 추적
- 일·월 한도 초과 시 429
- Phase 2-E와 결합 시 자기 결제로 자동 제한

### Track E — 스트리밍·UX (Medium priority, Medium effort)

**2-K. Gateway SSE/WebSocket**
- 클라이언트가 Gateway에 SSE 연결 유지
- OpenClaw event를 실시간 중계
- chat 응답이 streaming으로 사용자 화면에 표시

**2-L. 자체 멀티테넌트 웹 UI**
- OpenClaw Dashboard와 별개의 우리 자체 dashboard
- 사용자 토글, workspace 탐색, 사용량 그래프, 실시간 로그
- result.md의 과제 2

### Track F — 보안·운영 (Low priority during demo, High priority for production)

**2-M. Docker socket 제거**
- Native WebSocket client로 docker exec 의존 제거
- 또는 DinD 사이드카로 격리

**2-N. 페어링 자동화**
- OpenClaw에 service-account PR 기여
- 또는 setup 스크립트로 첫 부팅 시 자동 페어링

### 우선순위 매트릭스

| Track | Demo 가치 | 구현 난이도 | 권장 순서 |
|-------|----------|-------------|----------|
| 2-A 컨텍스트 분리 | ★★★★ | ★★ | **1순위** |
| 2-L 자체 웹 UI | ★★★★ | ★★ | **2순위** |
| 2-K 스트리밍 | ★★★ | ★★ | 3순위 |
| 2-D 인스턴스 풀 | ★★★ | ★★★ | 4순위 |
| 2-J 사용량 quota | ★★★ | ★★ | 5순위 |
| 2-E 실 OAuth | ★★★ | ★★★★ | 6순위 |
| 2-G workspace 매핑 | ★★ | ★★★ | 7순위 |
| 2-B 사용자별 agent | ★★★ | ★★★ | 8순위 |
| 2-H OS-level uid | ★ | ★★★ | 9순위 |
| 2-M Socket 제거 | ★ | ★★★★ | 10순위 |
| 2-F QoS | ★★ | ★★ | 11순위 |
| 2-N 페어링 자동화 | ★ | ★★★★ | 12순위 |

## 6. Phase 2 시작 권장

**가장 효과 높은 첫 단계는 Track A의 2-A(사용자별 IDENTITY/USER/MEMORY 분리)와 Track E의 2-L(자체 멀티테넌트 웹 UI)을 병행하는 것**입니다.

- 2-A는 "같은 agent가 사용자별로 다르게 동작한다"는 본질적 멀티테넌트성을 완성
- 2-L은 "관리자가 모든 사용자를 한 화면에서 본다"는 운영 가치를 시연

이 둘만 추가되면 시연 narrative가 "OpenClaw를 우리 Gateway가 감싸 multi-tenant SaaS로 만들었다"에서 "각 사용자에게 자기만의 페르소나·작업 공간·기억을 제공하는 진짜 SaaS"로 격상됩니다.

## 7. Phase 1 산출물 인벤토리

본 Phase 1을 통해 다음이 완성됨:

| 파일 | 역할 |
|------|------|
| `src/services/openclaw-cli.ts` | OpenClaw CLI subprocess 호출 (Phase 1의 핵심) |
| `src/services/openclaw-proxy.ts` | mock/openai/openclaw 3-way 라우터 |
| `src/services/openclaw-ws.ts` | (deprecated) native WS 시도 — Phase 2-M 트랙에서 재사용 |
| `docker-compose.yml` | docker socket 마운트, openclaw_state named volume |
| `tenants.yaml` | userA·userB + allowed_agents에 main 추가됨 |
| `Dockerfile` (gateway) | docker CLI 포함 (apt-get docker.io 또는 apk docker-cli) |

OpenClaw 측 변경 (newpatch.md 기준):
- Fix 1: `model-auth.ts` 컴파일 오류 수정 (preferredProfile)
- Fix 2: `agent-scope-config.ts` workspace 환경변수 인식
- Fix 3: `attempt-execution.ts` + `context.ts` container_id 추적
- 추가: `attempt-execution.ts` 라인 171 미정의 함수 호출 제거

## 8. 닫는 말

Phase 1의 가장 큰 성과는 **"OpenClaw를 단일 사용자 도구에서 멀티테넌트 백엔드로 만든 첫 작동 PoC"**다. 한계가 명확하고 그 한계가 모두 해결 경로를 가지고 있다는 점이 곧 Phase 2의 출발점이 된다.

핸드아웃 §4의 마지막 문장 — "OpenClaw가 에이전트를 안전하게 실행하는 엔진이라면, 본 프로젝트는 그 엔진을 여러 사용자가 공유할 수 있는 공용 Agent 서비스로 감싸는 작업이다" — 이 문장의 첫 절반("공용 Agent 서비스로 감싸기")이 Phase 1에서 달성됐다. 다음 절반("사용자별로 개인화된 공용 서비스")이 Phase 2의 미션이다.
