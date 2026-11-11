# TASK 22 — HITL interrupt/resume·승인·재수정·거절

> **2026-11-11 현행:** [TASK별 실제 구현·미구현 근거와 개발 방법](implementation-status.md)을 우선한다. 아래 내용은 당시 인수 기록이다.

2026-11-10. **Content 결정 API와 참조 전용 HITL 조립을 구현하고 단위·HTTP·격리 PostgreSQL로 검증했다.**
실제 AI 생성→Content 준비 전송/결과 resolver는 미연결이므로 제품 전체 완료를 뜻하지 않는다.
사용자 결정은 **재수정은 기존 revision_requested 영수증 반환까지**다. 새 run 자동 생성은 제외했다.
TASK 20 설정/플롯 실제 적용 미완료를 유지하며 TASK 23 이후는 시작하지 않는다.

## 1. 시작 상태·설계·이슈

시작 브랜치 `feat/57-async-postgres-checkpoints`, 기준 커밋 `e11ae92`, dirty 없음.
같은 TASK 21 체크아웃에서 `feat/60-hitl-interrupt-resume`를 만들었다. develop 강제 변경·fetch·rebase는 없다.
후속 “남은 작업” 요청은 같은 TASK 22의 검증·문서·종료를 계속하라는 지시로 적용했다.

사용자가 지정한 Downloads의 00_COMMON_RULES.md·23_TASK_22_hitl_interrupt_resume.md와
TASK 21/17 인수보고, 실제 저장소의 02·04 §13/15·05를 확인했다.
프로젝트 설계/결정·DEC-41 서비스 경계·유스케이스·AI/Content/Core AGENTS·개발 검증 지침을 따른다.
LangGraph 1.2.12의 설치 소스로 interrupt/Command 서명, GraphInterrupt의 Exception 상속과 반환 envelope를 확인했다.
새 의존성·lock 변경·Flyway SQL 추가/변경은 없다.

Graphify query는 오래된 알림 연결만 반환했고 관련 AI/Content 관계를 확인하지 못했다.
현재 prepare/decide/receipt·Main/Run의 실제 호출자·소스·테스트를 대조했다.
GitHub 도구 확인: [#60](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60),
[#57](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57)은 open/kyo-135다.
[#157](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/157)은 closed/completed·yerin816의
다른 책임 경계 작업으로, 새 작업에 연결하거나 다시 열지 않았다. 구형 Core 정본 문구 대신 최신 Content 경계를 따른다.
이슈 변경·댓글·새 이슈·자동 종료는 없다.

## 2. 구현과 범위

`runs/approval.py`의 ApprovalCoordinator는 서버가 주입한 Content prepare/read/receipt 함수만 호출한다.
run/task SHA-256 키로 불변 제안을 준비하고 run/thread/task/scope/output ref·Mock 표시를 대조한다.
모델 Task가 끝난 뒤 별도 proposal 노드에서 준비하며 다음 await_decision은 조회→interrupt→영수증 조회만 한다.
준비 commit 뒤 checkpoint 전 중단은 같은 키로 재등록하고, interrupt 등록 직후에도 영수증을 조회해
일찍 도착한 결정과 신호 유실에 수렴한다. 완료 Task/비용·기존 원래 요청 binding은 그대로 보존한다.

Command는 정확한 pending interrupt ID에 검증된 Content decisionId만 전달한다.
제안 판/hash·현재 승인자·전체 before/after 결과 버전·applicationId·outcome을 대조한다.
Mock 제안의 applied 영수증, 미커밋/다른 결정·오래된 interrupt·판 변경·권한 철회는 거부한다.
GraphInterrupt를 정상 중단으로 전달하고 __interrupt__ envelope만 업무 상태에서 분리한다.
일반 예외 원문은 기존 graph_node_failed 처리로 자동 checkpoint ERROR write에도 남기지 않는다.

내부 POST `/internal/v1/ai/runs/{id}/resume`는 기존 서비스 토큰·현재 grant/thread와 DecisionSignal을 검증한다.
충돌/미커밋은 409이며 기존 Run 상태를 덮어쓰지 않는다. 재개 timeout도 기존 요청 한도를 사용한다.
준비 시작 후 내부 취소는 decision_requires_content로 거부해 이미 커밋할 수 있는 Content 결정을 덮어쓰지 않는다.
그 전 생성 취소는 기존 방식이다. 승인 대기 중 같은 thread의 새 메모리 Run도 거부한다.
커밋한 적용으로 원래 manifest가 바뀌면 현재 인가와 정확한 영수증으로 종료하며 오래된 원문을 재조회/반환하지 않는다.

Content는 B=`/api/v1/works/{id}/ai` 아래 proposal 판 조회와 approve/reject/revise를 추가했다.
새 action의 입력은 proposalVersion/proposalHash/전체 baseVersions와 Idempotency-Key다.
기존 ChangeProposalService·작품 잠금·동일 PG transaction·불변/unique·원고 writer를 재사용한다.
누락/중복/추가/변경 baseVersions, 판/hash·키 payload 불일치는 409다.
알려진 판 충돌도 실패 키로 보존해 다른 승인 payload에 재사용할 수 없다.
구형 결정에 baseVersions가 없으면 JSON 필드를 생략해 과거 requestHash의 바이트를 유지한다.
기존 accept·change-proposals API, V1~V18, Saver schema는 변경하지 않았다.

재수정 응답은 사용자 선택에 따라 **200 revision_requested 영수증**이다.
설계 목표안의 202 새 run/판 자동 생성과 instruction 처리는 구현하지 않았다.
취소·영수증 재조회는 기존 change-proposals의 decisions/receipt 경로를 사용한다.
상세 DTO/경로·인가·실제 전송 미연결 경계는 [TASK 22 계약](task22-contract.md)을 따른다.

## 3. 생성·수정 파일

| 파일 | 변경 |
|---|---|
| AI app/runs/approval.py (신규) | 제한된 참조 DTO·불변 준비·현재 판·커밋 영수증 검증·읽기 전용 interrupt |
| AI app/runs/graph.py, state.py | 선택 HITL·상태/응답·정확한 Command·중단 등록 경쟁/재개 |
| AI app/runs/service.py, router.py | 인가된 resume 경로·상태/시간 한도·준비 후 취소 차단 |
| AI tests/test_approval.py, test_approval_resume.py, test_approval_postgres.py (신규), test_run_service.py, test_run_api.py | 단위·메모리/PG Graph·내부 HTTP 회귀 |
| Content proposal/controller/AiChangeProposalController.kt (신규) | 공개 판 조회·approve/reject/revise |
| Content proposal/service/ChangeProposalService.kt, service/dto/ChangeSet.kt | 전체 기준 판·legacy hash·판 충돌 실패 키 |
| Content proposal/ChangeProposalServiceTest, ChangeProposalHttpIntegrationTest, ChangeProposalPostgresTest | 단위·인증/CSRF·실제 PG 경합/rollback |
| AI/Content AGENTS, 설계 02/04/05, 기능표, task22-contract/handoff | 실제 계약·사용자 결정·증거·한계 |

## 4. TDD와 실제 검증

Approval 모듈·Content baseVersions DTO 부재의 collection/compile Red를 확인한 후 구현했다.
그래프 approval 인자 부재, interrupt envelope 처리, 내부 준비/취소 경합, 결정 참조 누락,
영수증 재개 timeout, 판 충돌의 409와 실패 키 재사용도 실패 확인 후 수정했다.
Content 기존 canonical JSON의 바이트 동일성은 단위 테스트로 고정했다.

최종 AI 선택 단위(서비스 디렉터리):

```powershell
uv run --offline --locked --extra dev python -m pytest -m 'not integration' tests/test_approval.py tests/test_checkpoints.py tests/test_checkpoint_runner.py tests/test_checkpoint_resume.py tests/test_run_service.py tests/test_task_runner.py tests/test_task_graph.py tests/test_world_plot.py tests/test_writing.py tests/test_next_draft.py tests/test_development.py tests/test_simulation.py --tb=short
```

**277 passed, 1 deselected in 10.51s.** 제외 1개는 기존 자동 ERROR write의 메모리 그래프 통합이며 아래에서 실행했다.
Windows asyncio/uv의 알려진 샌드박스 제약을 피하기 위해 명령 단위 host 실행으로 offline/locked를 유지했다.

TASK 22가 요청한 통합/재시작/rollback 검증 범위에서만 로컬 통합 예외를 적용했다.
새 임시 PG 16.15 클러스터는 127.0.0.1:59171이며 실제 .env나 기존 DB는 사용하지 않았다.
AI는 postgres DB의 무작위 langgraph_test schema/role, Content는 별도 task22_content DB/가짜 content_test 역할을 썼다.

```powershell
$env:TEST_CHECKPOINT_ADMIN_DATABASE_URL = 'postgresql://checkpoint_admin@127.0.0.1:59171/postgres'
$env:TEST_CHECKPOINT_DISPOSABLE = 'true'
uv run --offline --locked --extra dev python -X utf8 -c "import asyncio, pytest; asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy()); raise SystemExit(pytest.main(['-m','integration','tests/test_approval_postgres.py','tests/test_approval_resume.py','tests/test_checkpoint_integration.py','tests/test_run_api.py','tests/test_main_graph.py','tests/test_checkpoint_resume.py','--tb=short']))"
```

**66 passed, 2 deselected in 18.67s.** 구성은 실제 Saver PG 13개(TASK 21 회귀 11+HITL 2),
HITL 메모리 Graph 13개, 기존 Main/ERROR write 22개, 내부 FastAPI HTTP 18개다.
Content 대역으로 prepare commit/checkpoint 간격·결정 조기 도착·중복/유실 신호·버전/권한 변경·
정확한 interrupt·준비 중 취소와 원문/비밀 checkpoint 미노출을 확인했다.
PG Saver는 풀/Graph를 닫고 다시 생성해 같은 중단과 영수증으로 수렴했다.
실제 OS SIGKILL/전원 장애 또는 양 서비스의 실 생성 E2E 시험은 아니다.

Content 디렉터리에서 기존 `.gradle/task10-tools/jdk-21.0.13+9`를 프로세스 JAVA_HOME으로만 지정했다.

```powershell
$env:TEST_CONTENT_DATABASE_URL = 'jdbc:postgresql://127.0.0.1:59171/task22_content'
$env:TEST_CONTENT_DATABASE_USER = 'content_test'
$env:TEST_CONTENT_DATABASE_PASSWORD = ''
.\gradlew.bat unitTest --tests 'ai.storyfork.content.proposal.ChangeProposalServiceTest' --tests 'ai.storyfork.content.proposal.ProposalServiceTest' integrationTest --tests 'ai.storyfork.content.proposal.ChangeProposalPostgresTest' --tests 'ai.storyfork.content.proposal.ChangeProposalHttpIntegrationTest' --no-daemon --offline
```

최종 **BUILD SUCCESSFUL in 2m 17s**. XML 확인: 단위 **17개**(ChangeProposal 16+기존 accept 1),
통합 **14개**(실 PG 8+HTTP 6), 모두 failures/errors/skipped=0.
실 PG는 동일 키의 동시 승인에 동일 영수증/원고 버전 1회, 다른 키의 승인/취소/거절/재수정 단일 승자,
수동 편집 경쟁, 둘째 문서 저장 실패의 전체 원고/작품 revision/버전 rollback·최종 영수증 없음,
판 충돌 실패 키 보존을 확인했다. HTTP는 Bearer/CSRF·action의 서버 결정·전체 기준 판 전달·기존 API를 확인했다.

최초 Content PG 실행은 업무 시험 전에 무관한 Neo4j 자격 설정 누락으로 실패했다.
이 PG-only 테스트의 relationshipDriver만 Mockito 대역으로 격리한 후 실제 PG 회귀를 통과시켰다.
실 Neo4j나 모델은 호출하지 않았다. 유료 API·실 사용자 원고는 사용하지 않았다.

## 5. 영향·남은 조건

AI에 원고 쓰기/승인 함수를 추가하지 않았다. checkpoint/interrupt에는 제한된 참조와 검증한 영수증만 저장한다.
Main의 현재 Mock 근거는 실제 적용하지 않으며 응답의 is_mock=true를 유지한다.
비 Mock 영수증 Graph 시험과 Content PG의 isMock=false는 합성 정본 계약 자료이며 실제 생성물/사용자 원고가 아니다.
실제 Content 적용과 LangGraph 영수증 수렴을 각각 검증한 것으로, 미연결 전송을 검증한 것처럼 표시하지 않는다.

| 남은 항목 | 추천 / 대안 |
|---|---|
| 실제 후보 준비 전송/결과 resolver | Content가 소유한 참조/근거 검증을 먼저 연결 / 현재 명시 주입 대역 유지 |
| Content 자동 재전달·grant 갱신 | lease/attempt·원 요청·안정된 인가 binding 계약 후 구현 / 현재 유효한 위임에서 명시 재개 |
| 재수정 새 run/판·instruction | 이번 사용자 결정대로 영수증만 유지 / 별도 새 요청으로 범위 확정 |
| 운영 보존/삭제·암호화·연결 예산 | TASK 21 미결과 운영 비활성 유지 / 별도 DB·격리 저장소 검토 |
| 제품/배포 검증 | UI·실 생성 E2E·PG17 hosted Required CI 확인 후 판단 / 로컬 격리 계약 증거만 사용 |

실제 RemoteGrant의 전문 Agent/원문/후보 준비 transport는 미연결로 계속 dependency_unavailable다.
기존 Content 공개 Run 상태 제약과 real 응답 검증을 넓히지 않았다.
새 production 의존성·외부 서비스·lockfile·운영 migration/DDL·운영/사용자 원고 적용은 없다.
추가 비용은 단계 checkpoint/Content 조회뿐이며 승인 경로의 모델 호출은 0회다. 실 부하/latency는 미측정이다.
TASK 20의 설정/플롯 writer 미지원과 can_apply=false도 그대로다. 기능표의 관련 ❌를 유지했다.

## 6. 리뷰·커밋·종료

ponytail-review와 직접 diff 점검으로 기존 Content transaction/잠금/저장·Saver를 재사용하는지 확인했다.
범용 승인 프레임워크·새 Protocol/ABC·writer·테이블·중앙 worker를 만들지 않았다.
CodeRabbit 외부 전송 범위를 새 코드로 확대하지 않았으며 수동 변경 리뷰를 수행했다.
전체 suite·빌드·브라우저·실 모델·실 생성 E2E·PG17 hosted CI·운영 배포·SIGKILL 시험은 미실행이다.

로컬 커밋 메시지: `feat: 승인 영수증 기반 중단과 재개 연결` (Refs #60, #57).
push·PR 생성/병합·배포는 하지 않는다. 다음 TASK는 새 사용자 요청에서만 시작한다.
실제 전송/운영 적용 완료를 선언하려면 위 미연결과 검증 조건을 먼저 해결해야 한다.
임시 클러스터 종료·최종 diff/Git 상태는 아래 종료 기록에 남긴다.

종료 점검: 이번 임시 디렉터리와 포트 59171을 대조한 pg_ctl stop은 PID 41724가 이미 없어 실패했다.
이어 pg_ctl status의 no server running, pg_isready의 no response, TCP listener 없음, PID 없음으로
비실행 상태를 확인했다. 정상 종료 명령의 성공이나 통제된 SIGKILL 시험으로 기록하지 않는다.
파일 삭제는 하지 않아 생성한 테스트 데이터/로그와 stale pid 파일은
`C:/Users/rlarl/AppData/Local/Temp/storyfork-task22-fc060aad116c43279046744a5d462324`에 남아 있다.
최종 git diff --check는 통과했다. 로컬 커밋 ID는 작업 응답과 git log에서 확인한다.
