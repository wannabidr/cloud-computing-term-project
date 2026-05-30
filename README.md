## 핵심 아이디어:

> 여러 명의 사용자가 로컬 Gateway를 가지고 하나의 클라우드 에이전트 실행 환경에 접근하며, 각 사용자는 개별적인 workspace를 가진다.
> 

기존 OpenClaw는 local-first 단일 사용자 도구로, agent loop, model auth, channel integration 등 control plane 전체가 사용자 PC에서 동작한다. 그러나 shell·file 같은 tool 실행은 결국 컴퓨터 자원과 환경에 의존하므로, 팀 단위로 같은 agent 환경을 공유하려면 충돌이 발생한다.
이번 프로젝트는 OpenClaw core를 **수정하지 않고**, 다음 두 가지만 바꾸는 것으로 multi-tenant 클라우드 sandbox를 구현한다:

- OpenClaw sandbox backend를 SSH로 전환 (backend: "ssh") : 기존부터 존재하던 backend 옵션 이용
- 클라우드 VM 한 대에 tenant별 Linux user + chmod 700 workspace 설치 : OS 권한이 격리를 강제

결과적으로 사용자 입장에서는 "내 로컬 OpenClaw가 클라우드 agent 환경을 쓰는" 것처럼 보이고, OS 입장에서는 "여러 사용자가 동일 호스트에서 격리된 디렉토리에 작업하는" 구성이다.

> 비대칭 암호의 원리: private key를 가진 사람만 서버가 보낸 challenge에 올바르게 서명할 수 있고, 서버는 authorized_keys의 public key로 그 서명을 검증한다.
> 

SSH 키 쌍은 provisioning script가 ssh-keygen을 VM에서 호출하고, VM에서 생성된 키 값을 운영자 로컬로 받아옴으로써 생성 및 관리된다.이는 공개망 통과에도 안전한 방법이고, VM 구동을 중단하거나 기존 테넌트의 작업을 방해하지 않고 새로운 테넌트를 추가할 수 있다.

```bash
운영자가 tenants.json에 charlie 추가하는 과정:
- scp로 VM에 전달 → VM의 ~/openclaw-aaas/tenants.json 갱신
- sudo ./provision-tenants.sh 실행 — VM 재시작 없이 다음을 처리:
   useradd tnt_charlie (즉시 반영)
   ssh-keygen 으로 새 키쌍 생성 → VM의 ~/openclaw-aaas/keys/
   public key를 /home/tnt_charlie/.ssh/authorized_keys에 설치
   /srv/openclaw-tenants/tnt_charlie/ 워크스페이스 mode 700으로 생성
- 운영자가 키 회수: scp -r azureuser@VM:~/openclaw-aaas/keys/ C:\cloud\repo\keys\
- Charlie에게 private key + config snippet 안전 전달
- Charlie가 자기 PC에 키 설치 + OpenClaw config 적용 → 30분 내 사용 시작 가능
```

## 의의:

1. 기존 모델 공유 방식의 한계 :
    1. 팀이 같은 AI 환경을 공유하려면 AI 구독 계정 자체를 공유함 → 페르소나 분리 불가, 한 명의 행동이 다른 사용자의 채팅 이력에 노출되어 보안성 떨어짐
    2. 워크스페이스 공유 시 동시 편집 충돌, 파일 덮어쓰기 위험
    3. 공급자 측에서 IP·세션 기반 동시 접속 제한 : 공유 인원 확장 시 차단 위험
    4. agent의 tool 실행이 사용자 PC 자원에 묶여 있어 무거운 작업이 병목
    
    그러나 본 프로젝트의 아이디어로 OS가 강제하는 권한 수준에 의해 아래와 같은 구조적 안정성을 확보할 수 있다.
    
    - 팀 관리자(azureuser, vm 운영자) : 팀의 업무에 최적화된 모델을 선정 후 모델 키, 조직 키, 개별 키를 전달 및 관리, tenant 명단 관리, VM 운영, **감사 시 sudo로 워크스페이스 조회(log로 조회 이력 남음)**
    역할책임
    팀 관리자 : (azureuser)tenant 명단 관리, VM 운영, 모델/조직 키 관리, 감사 시 sudo로 워크스페이스 조회 [sudo 권한 (모든 접근이 로그에 기록됨)]
    개별 테넌트 :
    - 테넌트들 : 자기 AI 페르소나 운영, 개별 워크스페이스에서 작업, 자기 키로만 tenant root 내부 접속/다운로드, 세션 파일이 로컬 OpenClaw에 저장되므로 이력 복기·검색 가능 (openclaw sessions list/show), 무거운 tool 실행이 클라우드 VM에서 일어나 본인 PC의 부하 감소, 같은 agent ID·session ID여도 tenant마다 별도 OS 프로세스로 실행해 tenant별 OS 권한으로 분리
2. 즉시 적용 가능성:
    
    OpenClaw core 자체를 수정하지 않으므로, agent를 공유할 테넌트가 로컬 pc에 OpenClaw를 다운받고 조직으로부터 config snippet (target + workspaceRoot + identityFile)과 agent+private key를 할당받으면 **30분 이내의 간단한 셋업으로 당장 적용 가능한 아이디어**. OpenClaw 사용자 경험 그대로 유지(openclaw chat, openclaw tui, openclaw agent, channel integration 등)
    
3. OS 레벨 격리:
"사용자 local Gateway를 신뢰하지 않는다"가 OS 권한으로 강제됨. Alice가 자기 OpenClaw config의 workspaceRoot를 임의로 /srv/openclaw-tenants/tnt_bob/sandboxes로 바꿔도, Linux 커널이 tnt_alice의 UID로 tnt_bob 디렉토리 접근을 거부함
    - 디렉토리를 직접 읽으려 할 때 Permission denied
    - chmod 700이 traversal을 막아 하위 파일의 존재 노출 자체를 차단하여 No such file or directory 반환
4. 조직 agent 작업 시 재현성 확보 :
모든 테넌트가 provisioning script로 지정한 동일한 OS와 도구 버전 위에서 작업하므로 환경 불일치 문제가 사라짐

## 발전 가능한 아이디어:

1. 워크스페이스 로컬 동기화 (양방향):
    - rsync 기반 cron job (로컬 측): 사용자 PC에  매 N분마다 실행
    
    ```bash
    rsync -avz -e ssh tnt_<name>@VM:/srv/openclaw-tenants/tnt_<name>/sandboxes/ ~/openclaw-mirror/
    ```
    
    - OpenClaw 확장 hook: agent turn 종료 시점에 자동으로 변경 파일 pull (file-transfer plugin 활용)
    - 양방향 sync (Unison 등): 충돌 감지 + 자동/수동 해결. 사용자가 로컬에서 편집한 결과를 VM에 반영하는 것도 가능
    - 워크스페이스 snapshot: VM에서 매일 0시에 /srv/openclaw-tenants/tnt_<name>을 tar로 압축 → 별도 백업 디스크 또는 Azure Blob 로 archive(사용자가 "어제 작업본 복원" 요청 시 응답 가능)
2. 테넌트별 사용량 모니터링 + 오토스케일링으로 **AaaS 시스템 완전 구현**
    - per-tenant 디스크 사용량: du -sh /srv/openclaw-tenants/tnt_<name> 을 cron으로 수집 → Prometheus/Grafana로 모니터링
    - per-tenant CPU/메모리: cgroup으로 각 Linux user에 limit 적용 + 사용량 수집
    - Autoscale 트리거: 전체 CPU/메모리의 일정 점유율 초과 + tenant 수 K명 도달 시 VM scale-up (Standard_B2ms → Standard_D4s_v5 등) 또는 VM scale-out (VM 추가 + Azure Files 공유 디스크로 워크스페이스 마운트)
    - SSH 라우팅: 여러 VM이 있을 때 tenant→VM 매핑을 Azure Load Balancer 또는 SSH bastion으로 추상화
3. 웹 UI 지원
OpenClaw의 openclaw dashboard 명령(Control UI)을 multi-tenant 화면으로 확장:
    - 운영자 대시보드: tenant 목록, 사용량, 활성 세션, 권한 변경, 키 발급/회수
    - 테넌트 대시보드: 자기 워크스페이스 파일 트리, 세션 이력, 모델 사용량, 키 갱신 self-service
    - 인증: SSO (OIDC) 연동 → Linux user 자동 매핑 → SSH key는 백엔드에서 SSH CA로 발급
4. **Agent 간 협업** : 에이전트가 테넌트 간 작업 요청을 전달하도록 하는 로직 추가(multi-agent collaboration framework)
    - 메시지 채널: tenant 간 비동기 메시지 박스를 VM에 둠 (/srv/openclaw-shared/messages/<from>-<to>/..., 보낼 사람은 write 가능, 받을 사람만 read)
    - 권한 위임 토큰: Alice agent가 "Bob의 /X/Y/file.txt 읽기 권한을 1시간 위임" 같은 토큰 발행 → Bob이 수락 시 Linux ACL로 limited time 부여 (setfacl -m u:tnt_alice:r /srv/.../tnt_bob/X/Y/file.txt, 만료는 cron으로 제거)
    - agent 시그널: Alice agent가 LLM 호출 도중 "이 작업은 Bob의 input이 필요"하다고 판단 시 자동으로 Bob agent에게 요청 메시지 발송 → Bob의 OpenClaw가 알림 → Bob이 결재 → 권한 위임 트리거
    - 공동 작업 디렉토리: /srv/openclaw-tenants/shared/<project>/ 같은 공유 영역에 양쪽 ACL 부여하는 방식 도입
5. SSH Certificate Authority (단기 자격증명)
    - 사내 SSH CA 운영을 통해, 사용자가 매일 출근 시 `step-cli ssh login` 같은 명령으로 OIDC 인증 → 24시간 유효 인증서 발급 후 agent 이용 (OpenClaw config의 certificateFile 필드 활용 등으로 구현)
    - 분실 시에도 24시간 후 자동 만료되어 사고 영향 최소화
6. Tenant별 컨테이너 격리 추가
현재 chmod 700 + Linux user보다 한 단계 더 강한 격리 적용 → tenant마다 systemd-nspawn 또는 podman rootless container 할당
    - 각 tenant의 작업이 자기 container 내에서만 실행
    - container 내부 root이라도 host 자원 접근 불가
    - 잠재적인 커널 취약점 escape 방어

## 최적화 방향:

1. 워크스페이스 디스크 관리
    - Session GC: 오래된 sandbox session 디렉토리 자동 정리 (예: 30일 이상 미접근한 디렉토리 자동 archive 후 삭제
    - Tenant quota: ext4의 사용자별 quota 활성화 → 한 tenant가 디스크를 과도하게 이용하는 상황 방지
    - Tiered storage: 활성 워크스페이스는 Premium SSD, archive는 Standard HDD나 Azure Blob
2. 네트워크 최적화
    - VM의 SSH inbound만 열고 outbound 제어: NSG로 tenant가 VM에서 외부에 자유 통신하는 것을 방지해 데이터 유출을 방어
    - WireGuard / Tailscale: public IP 노출 없이 사내 망에서만 VM 접근 가능하게 → SSH brute-force 표면 0
    - Region 분산: 사용자 지역에 가까운 VM으로 라우팅(Korea Central + Japan East + EU 등)하여 latency 감소
3. 운영 자동화
    - 상태 헬스체크: openclaw doctor 결과를 모든 tenant에 대해 cron으로 정기적 수집 후, 문제 발생 시 팀에 알림
    - 자동 백업 + 복원 리허설: 워크스페이스 백업 자체보다 복원이 정말 되는지 정기 검증 (월 1회 random tenant 백업으로 임시 VM에 복원 → 데이터 일치 확인)
4. 신뢰성 향상(비용과의 trade-off를 고려해야 함)
    - VM 이중화 (Availability Set / Zone): 단일 VM이 다운되면 모든 tenant 영향하는 것 방지
    - 워크스페이스 디스크 RAID 또는 Azure Managed Disk replication: 현재 Premium_LRS를 Premium_ZRS (zone-redundant)로 전환하여 다른 Zone에서 데이터 유지
    - 모델 fallback chain: provider 헬스체크 + 지능적 라우팅을 통해 모델 fallback을 정교하게 설정하여 유저 경험을 떨어뜨리지 않도록 함