# TASK 23 — SSE 진행·재연결·취소 인수보고

> **2026-11-11 현행:** 실제 연결 여부와 남은 선행 조건은 최신 표를 따른다. [실연동 인수보고](live-rag-handoff.md) 참조. 아래 TASK별 결과는 당시 기록이다.

2026-11-10. 진행/취소 기반을 구현했다. **실제 전문 Agent·결과 본문 resolver·UI까지 완료한 것은 아니다.**
최종 검증 결과와 종료 상태는 아래에 기록한다. TASK 24는 시작하지 않는다.

## 시작 상태와 근거

시작 브랜치 `feat/60-hitl-interrupt-resume`, 기준 커밋 `1ae0fb79fc1615c10026fd89e5054951929d35c8`, dirty 없음.
그 체크아웃에서 `feat/54-run-progress-cancel`을 만들었다. develop으로 강제 변경하거나 fetch/rebase하지 않았다.
TASK 22의 명시적 완료 범위와 실제 전송 미연결 한계를 확인하고 이어받았다.

사용자가 지정한 Downloads의 `00_COMMON_RULES.md`와 `24_TASK_23_sse_progress_cancel.md`, 저장소의 설계 원문
04 §공개 API/14/15, 05 §통신·복원 수용 기준, 설계/결정/DEC-41 서비스 경계·유스케이스·AI/Content/Core 지침을 읽었다.
지시서의 구형 Core 정본 표현은 기존 결정대로 Content 정본으로 해석했다. TASK 23의 명시적 수용 테스트 요청 범위에서만
로컬 HTTP/메모리 그래프/격리 PG 검증 예외를 적용했다. 전체 suite/빌드/브라우저 검증은 요청 범위에 넣지 않았다.

GitHub 도구로 확인한 현재 이슈:

| 이슈 | 상태/담당 | 적용 |
|---|---|---|
| [#54](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54) | open / kyo-135 | 공개 Run 오류·취소·위임 계약 |
| [#57](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57) | open / kyo-135 | 동일 Run 재접속·현재 권한 확인 |
| [#145](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/145) | closed/completed / yerin816 | 회원 알림의 역순 회귀 참고만 |
| [#146](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/146) | closed/completed / yerin816 | 회원 알림의 cursor 회귀 참고만 |

새 이슈·댓글·담당 변경·자동 종료는 없다. Graphify query는 오래된 회원 알림 연결을 반환해 관련 실제 Run/승인 소스와
호출자·직접 생성 테스트를 확인했다. 고정 LangGraph 1.2.12의 설치 소스로 custom/values multi-mode stream 서명을,
설치 Spring Web 7.0.8의 javap로 테스트용 Jackson converter API를 확인했다. 새 의존성/lock 변경은 없다.

## 구현과 사용자 결정

AI `progress.py`는 고정 code/task/attempt/phase/step/status DTO만 허용한다. Main은 custom writer를 연결하고
values를 내부 결과 조립에만 사용한다. LLM messages/debug/reasoning/token은 스트림에 포함하지 않는다.
TaskRunner는 고정 단계만 발행하고 모델 예약 checkpoint 직후에도 취소를 재확인한다.
취소를 무시하는 handler의 늦은 결과·이벤트를 버린다. 같은 Run의 동시 resume도 한 실행으로 제한한다.

Content는 V19의 Run cursor/결과 참조/취소 전달 확인과 진행 테이블을 추가했다. 기존 작품 잠금과 transaction을 재사용하고
`(run,seq)` 및 `(run,task,attempt,phase,step)`를 unique로 보장한다. 중복·역순 step과 늦은 상태 snapshot을 무시한다.
제안 준비/결정에도 같은 transaction에서 Run과 최종 이벤트를 갱신한다. 재수정 뒤 명시적 다음 판 준비의 이벤트도 보존한다.
자동 재수정 생성은 추가하지 않았다. 기존 V1~V18·Saver schema·Core 회원 알림은 변경하지 않았다.

공개 SSE는 현재 회원/작품/Fork/thread 인가, cursor/Last-Event-ID, gap 410, batch 100, 15초 heartbeat,
55초 정상 종료/60초 servlet timeout과 프로세스당 8개 동시 연결을 사용한다. 개발·배포 nginx는 Content의
`X-Accel-Buffering: no`로 해당 응답의 buffering을 끄며 캐시는 설정하지 않는다. 기존 90초 idle timeout을 유지한다.
연결 종료는 Run 취소가 아니다. polling만으로도 최종 상태·안전한 결과 참조를 읽는다.

공개 취소는 작품 잠금 아래 CAS로 먼저 커밋한다. 승인 적용이 먼저면 409, 취소가 먼저면 승인 writer가 거부된다.
취소 후 새 후보 준비·늦은 결과 적용은 차단된다. 수동 편집으로 기준 revision이 변해도 현재 소유자는 취소할 수 있다.
위임 확인에서 먼저 읽은 JPA Run도 작품 잠금 뒤 refresh해 캐시에 남은 상태로 취소 확정을 놓치지 않게 했다.
Content가 확정한 cancelled를 내부 grant 재검증 응답에 담고 AI가 이 확정으로 종료한다.
실행 중단 전달 실패는 503이며 취소 상태를 유지한다. 같은 Run으로 전달만 재시도하고 확인 후 반복 취소는 무호출이다.
5분 grant 만료 갱신은 미지원으로 유지한다. [상세 경로/DTO/재연결 절차](task23-contract.md)를 따른다.

사용자 답변으로 이벤트는 **자동 삭제 없이 보관**한다. 없는 과거 cursor의 410 경로만 둔다.
CodeRabbit 외부 전송도 사용자 답변에 따라 하지 않고 로컬 리뷰로 마친다.

## 파일과 범위

| 구분 | 생성·수정 파일 |
|---|---|
| AI 운영 코드 | `app/runs/progress.py`(신규), `graph.py`, `runner.py`, `schemas.py`, `service.py`, `remote_content.py` |
| AI 테스트 | `tests/test_progress.py`(신규), `test_main_graph.py`, `test_task_runner.py`, `test_remote_content.py` |
| Content 운영 코드 | `proposal/service/AiRunProgressService.kt`, `AiRunStreamService.kt`, `service/dto/AiRunProgress.kt`, `entity/AiRunEventEntity.kt`, `repository/AiRunEventRepository.kt`(신규); `AiRunService.kt`, `ChangeProposalService.kt`, `AiRunResponse.kt`, `AiRunEntity.kt`, `ChangeProposalVersionRepository.kt`, `AiRunClient.kt`, `client/dto/AiRunDispatchRequest.kt`, `controller/AiRunController.kt`; `db/migration/proposal/V19__ai_run_progress.sql`(신규) |
| Content 테스트 | `AiRunProgressTest.kt`, `AiRunStreamIntegrationTest.kt`(신규); `AiRunServiceTest.kt`, `ChangeProposalServiceTest.kt`, `AiRunHttpIntegrationTest.kt`, `AiRunClientIntegrationTest.kt`, `ChangeProposalPostgresTest.kt`, `regression/ContentMigrationTest.kt` |
| 문서·프록시 | AI/Content `AGENTS.md`, `04-infrastructure-integration.md`, `05-implementation-roadmap.md`, 기능표, `task23-contract.md`/본 인수보고(신규), `infrastructure/nginx.dev.conf`, `frontend/nginx.conf` |

UI 소비자·화면·실 모델/외부 검색·실 원고·운영 migration·자동 복구·외부 계정 변경은 범위 밖이다.
기능표는 병합/Required CI·UI 미확인이므로 ❌를 유지하고 이번 계약 구현의 근거만 추가했다.

## TDD와 실행한 검증

신규 ProgressEvent 모듈 부재의 collection Red를 먼저 확인했다. 이후 취소를 무시한 늦은 응답·중복/역순 이벤트·적용 후 취소·
동시 resume를 검증했다. 모델 예약 checkpoint 중 취소 테스트는 실제 모델 대역이 1회 불려 실패했고,
호출 직전 checkpoint 재확인으로 0회가 됐다. Content의 다음 제안 판 준비 이벤트도 WantedButNotInvoked Red 후 고쳤다.
초기 Kotlin 단위 실패는 Pageable matcher가 null을 전달한 대역 문제였고 non-null 대역으로 수정했다.

AI 명령은 `backend/ai-service`에서 기존 `.venv/Scripts/python.exe`를 사용했다. uv 샌드박스 캐시 접근 거부와
Windows asyncio 제약을 피하기 위해 명령 단위 host 실행을 사용했으며 패키지 설치/갱신/유료 모델 호출은 없다.

```powershell
.\.venv\Scripts\python.exe -m pytest -m 'not integration' tests/test_progress.py tests/test_run_service.py tests/test_task_runner.py tests/test_remote_content.py tests/test_approval.py tests/test_checkpoint_resume.py --tb=short
.\.venv\Scripts\python.exe -m pytest -m integration tests/test_main_graph.py tests/test_run_api.py tests/test_approval_resume.py tests/test_remote_run_api.py tests/test_checkpoint_resume.py --tb=short
```

AI 최종 단위: **76 passed, 1 deselected in 8.86s**. 제외된 메모리 ERROR write는 위 integration 명령에 포함한다.
AI 최종 HTTP/그래프: **55 passed, 2 deselected in 10.34s**. 제외 2개는 같은 파일의 단위 테스트이며 위 단위 명령에서 실행했다.

Content는 루트 `.gradle/task10-tools/jdk-21.0.13+9`를 해당 프로세스 JAVA_HOME으로만 지정하고 offline을 유지했다.

```powershell
.\gradlew.bat unitTest --tests 'ai.storyfork.content.proposal.AiRunServiceTest' --tests 'ai.storyfork.content.proposal.AiRunProgressTest' --tests 'ai.storyfork.content.proposal.ChangeProposalServiceTest' --no-daemon --offline
```

Content 최종 단위: **36개 통과**(AiRunService 17, Progress 3, ChangeProposal 16; failures/errors/skipped=0).
Content 최종 HTTP/PG: **27개 통과**(Run HTTP 8, 실제 SSE writer 2, HTTP client 1, PG 경합/rollback 9, migration 7).
XML의 failures/errors/skipped는 모두 0이며 최종 Gradle은 **BUILD SUCCESSFUL in 4m 58s**다.
최종 실행은 아래 단위·통합 두 task와 각각의 `--tests` 필터를 한 Gradle 명령으로 연결하고
`--no-daemon --offline '-Pkotlin.incremental=false'`를 사용했다. 앞선 두 Gradle 명령을 겹친 실행 실수로
증분 캐시 충돌이 발생해 둘 다 종료한 뒤 순차 실행으로 바꿨다. 캐시 파일을 삭제하거나 저장소 설정을 바꾸지 않았다.
별도 임시 PG 16.15를 127.0.0.1:59173에 만들었다. `.env`/공유 DB는 사용하지 않았다.
관리 역할은 가짜 `task23_admin`, 업무 테스트 역할은 `content_test`다. 최종 검증은 새 `task23_content_final` DB를 사용한다.
V19 개발 중의 테스트 checksum을 repair하거나 기존 DB 이력을 고치지 않고 새 빈 DB에서 다시 검증했다.

```powershell
$env:TEST_CONTENT_DATABASE_URL='jdbc:postgresql://127.0.0.1:59173/task23_content_final'
$env:TEST_CONTENT_DATABASE_USER='content_test'
$env:TEST_CONTENT_DATABASE_PASSWORD=''
.\gradlew.bat integrationTest --tests 'ai.storyfork.content.proposal.AiRunHttpIntegrationTest' --tests 'ai.storyfork.content.proposal.AiRunStreamIntegrationTest' --tests 'ai.storyfork.content.proposal.AiRunClientIntegrationTest' --tests 'ai.storyfork.content.proposal.ChangeProposalPostgresTest' --tests 'ai.storyfork.content.regression.ContentMigrationTest.fresh*' --tests 'ai.storyfork.content.regression.ContentMigrationTest.change*' --tests 'ai.storyfork.content.regression.ContentMigrationTest.work view*' --tests 'ai.storyfork.content.regression.ContentMigrationTest.V16 keeps*' --tests 'ai.storyfork.content.regression.ContentMigrationTest.V16 secondary*' --no-daemon --offline
```

처음 PG 검증에서 만료가 기본값인 기존 수동 Run fixture 때문에 취소 전달이 503을 반환해 양쪽 성공 수가 0이었다.
새 취소 경합에 유효한 5분 fixture 위임을 지정한 뒤 재검증했다. HTTP 대역의 raw RestClient에도 Kotlin mapper를 명시해
실제 Boot builder와 같은 선택 필드 디코딩 환경으로 맞췄다. production 전송 오류를 숨기거나 fallback하지 않았다.

## 발견한 기존 실패와 한계

넓혀 확인한 기존 `ContentMigrationTest.V16 samples preserve bodies source versions wiki and replay without changes`는
Windows checkout의 CRLF로 본문 hash가 달라 실패했다. 원문을 출력하지 않는 별도 DB 비교에서 16개 불일치 모두
CRLF→LF 정규화 후 기존 inventory hash와 일치했다. 이번 V19는 원고/샘플을 수정하지 않는다.
기존 V16/원문 hash 계약을 바꾸지 않았고 이 테스트 1개를 숨겨 통과시키지 않았다. 최종 명령은 관련 migration 7개만 지정한다.
LF checkout의 hosted CI에서 기존 샘플 hash 회귀를 확인해야 한다.

실제 SSE writer의 wire framing/재연결은 MockMvc에서 검증한다. TCP 중간 단절/느린 소켓·브라우저·실 nginx 경유·실 부하,
15초 실시간 heartbeat 수신·OS SIGKILL·운영 재시작 자동 복구는 검증하지 않았다. 시간/프록시 정책은 코드/설정 대조다.
AI의 Content grant HTTP 시험은 대역이며 실제 양 서비스 생성→원고 적용 E2E가 아니다.

## 영향과 다음 조건

비용: 실 모델 호출 0회, 새 production 의존성 0개. DB 단계 기록과 스트림당 1초 상태 조회 비용이 추가된다.
성능: 프로세스당 스트림 8개, 초과는 503/polling. 운영 부하/지연은 미측정이다.
보안/권한: 고정 DTO와 현재 소유권 검증을 유지하고 SSE에 원문/추론/토큰/키를 넣지 않는다.
Mock/real: Fixture는 `is_mock=true`를 유지하며 Content real 응답 검사와 Mock 제안 실제 적용 차단을 보존했다.

| 남은 조건 | 추천 / 대안 |
|---|---|
| 실제 전문 실행·준비/결과 resolver | 기존 승인된 참조 경계에서 별도 요청으로 연결 / 현재 dependency_unavailable 유지 |
| UI 소비자 | 같은 run의 fetch SSE·seq 중복 제거·410 상태 조회·로그아웃 AbortController를 후속 단계에서 연결 / polling만 사용 |
| AI 재시작 전 미전송 이력·Content 재전달 | Content lease/안정된 grant 갱신 계약을 먼저 확정 / 현재 이미 커밋한 이력만 replay |
| 운영 보관/연결 규모 | 현재 사용자 결정대로 삭제 없이 보관 / 별도 요청으로 보관·비차단 전송 정책 결정 |
| 배포·회귀 | LF checkout Required CI와 실 프록시 검증 / 현재 단위·HTTP·격리 PG 증거로 제한 |

TASK 20 설정/플롯 실제 적용 미지원과 TASK 22 실제 준비 전송 미연결은 유지된다.
다음 단계는 새 사용자 요청 후 착수 가능하며, 실 생성 수용은 이 미연결을 먼저 해소해야 한다.

## 리뷰·커밋·종료

ponytail-review로 새 프레임워크/범용 registry/worker·production 의존성을 추가하지 않았는지 점검하고,
기존 Content 잠금/transaction·Main·TaskRunner·Spring SSE를 재사용했다. 직접 호출자/변경 diff의 로컬 correctness 리뷰를 수행했다.
프록시는 응답별 X-Accel-Buffering 기능을 사용해 일반 작품 경로 전체의 buffering 설정 변경 8줄을 덜어냈다.
CodeRabbit 실행은 자동 승인 검토가 코드/미추적 파일의 외부 전송에 명시 승인이 없다는 이유로 거부했다.
전송은 실행되지 않았다. 이후 사용자가 **외부 전송 없이 로컬 리뷰로 완료**를 선택해 다시 시도하지 않았다.

로컬 커밋 메시지: `feat: 실행 진행 스트림과 재접속 및 취소 연결` (Refs #54, #57).
push·PR 생성/병합·배포는 하지 않는다. 파일 삭제도 하지 않는다. 최종 commit ID는 응답/git log에서 확인한다.

## 종료 기록

AI 선택 단위 76개·HTTP/그래프 55개, Content 선택 단위 36개·HTTP/PG 27개 통과를 확인했다.
실패했던 기존 CRLF 샘플 hash 1개는 위 한계에 별도 기록했고 전체 suite가 통과했다고 표시하지 않는다.
위임 확인의 캐시 refresh는 필요한 constructor 부재의 compile Red 후 구현했으며 관련 단위와 실제 PG 회귀가 통과했다.

임시 클러스터의 절대 경로와 postmaster 옵션을 대조한 뒤 `pg_ctl -m fast -w stop`이 **server stopped**로 종료됐다.
이어서 `pg_ctl status`의 **no server running**, 포트 59173의 `pg_isready` **no response**를 확인했다.
파일은 삭제하지 않았다. 이번 테스트 자료는
`C:/Users/rlarl/AppData/Local/Temp/storyfork-task23-dc6217181bef496ea6bf813ae7867d93`에 남는다.

최종 `git diff --check`와 stage된 diff 점검은 통과했다. 변경 41개 파일에 실제 `.env`·비밀 파일·lockfile은 없다.
로컬 커밋 후 Git 상태와 ID는 작업 응답에서 확인한다. TASK 24·push·PR·병합·운영 배포는 실행하지 않았다.
