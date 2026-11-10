# TASK 21 — AsyncPostgresSaver·Thread 상태 복원

2026-11-10. **분리 Saver와 참조 전용 Main/TaskRunner 재개를 구현하고 격리 PostgreSQL에서 검증했다.**
사용자가 TASK 20 실제 적용 미완료를 유지한 채 TASK 21의 독립 진행을 명시 승인했다.
TASK 20의 can_apply=false·unsupported_atomic_scope는 변경하지 않았다. TASK 22 이후는 착수하지 않는다.
운영 채택·실제 Content 전문 실행과 자동 복구/보존 정책 완료를 뜻하지 않는다.

## 1. 시작 상태·근거·이슈

시작 브랜치 `feat/61-world-plot-management`, 기준 커밋
`ebf6ccca753c26733f6984a85f0c9660ebe1c42e`, dirty 변경 없음.
이 TASK 20 체크아웃을 보존하고 `feat/57-async-postgres-checkpoints`를 생성했다.
develop으로 강제 변경·rebase·fetch하지 않았다. `.git` 쓰기 제한으로 최초 생성이 실패해 같은 명령만 host에서 재시도했다.

Downloads의 `00_COMMON_RULES.md`·`22_TASK_21_async_postgres_saver.md`, TASK 20 인수보고와 현재 소스/테스트,
저장소 02·04 §13·05·06, 프로젝트 설계/DEC-41/서비스 경계/유스케이스/AGENTS/개발 검증 지침을 확인했다.
기존 Saver ERD 조사와 공식 PyPI 3.2.0 메타데이터, 설치 wheel의 aio.py/base.py/serde API를 대조했다.
Graphify query는 오래된 Frontend/업무 CHECKPOINT 연결만 반환해 실제 AI 소스·호출자·테스트로 범위를 확인했다.
Aside는 실행되지 않아 공식 웹과 로컬 설치 소스로 버전을 확인했다.

GitHub 도구로 [#57](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57),
[#60](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60)을 확인했다.
둘 다 open, assignee kyo-135. 이슈의 구형 Core 인가/정본 표현 대신 최신 Content 소유 경계를 따른다.
댓글·이슈 변경·새 이슈·자동 종료는 없다.

## 2. 범위와 동작

`runs/checkpoints.py`에 고정 AsyncPostgresSaver 3.2.0, psycopg 전용 풀, 조회 전용 schema/version/권한 검사,
관리 전용 setup 명령, thread session lock, 같은 Saver의 별도 namespace RunnerJournal을 추가했다.
runtime schema 생성/setup·Flyway SQL 복사·업무 search_path 혼용은 없다.
schema는 개발 후보 langgraph 또는 테스트 전용 무작위 이름이다. URL 미설정은 기존 메모리 경로이며
설정 후 실패는 메모리 성공으로 fallback하지 않는다.

기존 LangGraph 1.2.12/checkpoint 4.3.1을 유지하고 Saver 3.2.0·psycopg[binary,pool] 3.3.2를 추가했다.
pool은 lock의 3.3.3이다. Python에 기존 asyncpg/업무 풀이 없으며 Content는 기존 JDBC/Hikari/Flyway를 유지한다.
모든 연결에 전용 search_path/autocommit/dict_row·timeout을 고정한다. worker당 최대 연결 3개이며
동시 thread 잠금 2개로 SQL용 연결 1개를 남긴다. 시작은 migration 0~9/필수 컬럼/최소 실효 권한만 조회한다.
관리 계정·소유자·schema CREATE·DB CREATE/TEMP·업무 테이블 권한·migration DML이 있으면 거부한다.
공유 DB PUBLIC 권한 변경은 자동화하지 않았다. 배포 관리 setup만 고정 버전·연속 이력·session lock을 확인한다.

lifespan은 Saver를 app.state와 RunService에 주입하고 실행 Task 회수 뒤 풀을 닫는다.
FixtureContent의 인가된 같은 요청 재전달은 저장 유무에 따라 MainGraph를 재개한다.
직접 호출은 resume=True, 비동기 이력은 ahistory다. 기존 신규 run의 중복 실행 거부는 유지한다.
원래 요청/한도 binding·Content manifest와 문맥 digest를 검증하며 현재 권한이 달라지면 복원/이력 접근을 막는다.
subject/work/Fork/grant/요청/한도·판본과 원래 deadline을 임의로 갱신하지 않는다.

Main 노드 경계는 sync durability다. dispatch 내부의 완료 결과·active attempt/lease·재시도·동적 확장·누적 비용·
원래 deadline은 task_runner namespace에 저장한다. 호출 전 예약 저장이 실패하면 모델을 호출하지 않는다.
저장된 완료 Task는 재사용하고 불명 active Task는 interrupted_outcome_unknown으로 실패 처리한다.
예약/usage_unknown을 보존하며 결과가 불명인 제공사 호출을 자동 재실행하지 않는다.
제공사 요청과 DB의 exactly-once 원자성, 실제 Core 크레딧 원장은 구현하지 않았다.

checkpoint에는 JSON primitive 참조·상태와 digest만 저장한다. 최근 messages는 참조 최대 20개다.
원문·요청문·생성 전문·grant·provider key는 넣지 않고 pickle/임의 msgpack 타입 복원을 허용하지 않는다.
복원 시 문맥은 재조회·검증하므로 읽기 검증은 반복될 수 있다. Specialist/모델의 완료 Task 중복과 구분한다.
Agent 본문은 여전히 메모리 전용이므로 실제 본문 resolver 없는 미완료 후속 작업은 실패하며 본문을 복제하지 않는다.

## 3. 파일

| 파일 | 변경 |
|---|---|
| AI app/runs/checkpoints.py (신규) | 전용 pool·사전 검사·관리 setup·lock·journal |
| AI app/runs/graph.py, state.py, runner.py | async Saver/재개·primitive 저장·binding/이력·예약/결과 복원 |
| AI app/main.py, runs/service.py | lifespan 주입·정리·인가된 fixture 재전달 재개 |
| AI pyproject.toml, uv.lock, 루트 .env.example | 필요한 고정 의존성·기본 비활성 설정 |
| AI tests/test_checkpoint_{runner,resume,integration}.py, test_checkpoints.py (신규), test_run_service.py | 단위·실 PG·호출자 회귀 |
| .github/workflows/ci.yml, infrastructure/ci/test_ci.py | AI job의 격리 PG와 필수 테스트 환경·선택 계약 |
| AI docs/checkpoints.md (신규), AGENTS.md | 관리 명령·권한·실제 계약·미결 |
| 설계 02/04/05/06, 기능표, 이 보고서 | 구현 상태/검증/제품 ❌ 보존 |

## 4. TDD·실제 검증

RunnerState/checkpoints 모듈·binding 부재의 collection Red→구현 Green을 확인했다.
호출자 lifespan 주입 누락 3개, 미래 schema 관리 setup 허용, TEMP DDL 허용도 실패를 먼저 확인한 뒤 수정했다.
초기 Windows 샌드박스 asyncio가 socketpair accept에서 멈춘 스택을 확인했고 이번 테스트 프로세스만 종료했다.
이후 uv offline/locked 명령만 host에서 실행했다. 유료 모델·실 사용자 원고는 사용하지 않았다.

AI 디렉터리의 최종 선택 단위:

```powershell
uv run --offline --locked --extra dev python -m pytest -m 'not integration' tests/test_checkpoints.py tests/test_checkpoint_runner.py tests/test_checkpoint_resume.py tests/test_run_service.py tests/test_task_runner.py tests/test_task_graph.py tests/test_world_plot.py tests/test_writing.py tests/test_next_draft.py tests/test_development.py tests/test_simulation.py --tb=short
uv lock --check --offline
```

결과 **253 passed in 9.90s**, lock 검사 **Resolved 78 packages**.
루트의 `backend/ai-service/.venv/Scripts/python.exe -X utf8 -m unittest infrastructure.ci.test_ci.SelectionTest -q`는
**21 tests, OK**다. 최초 CI 단위는 Windows cp949 읽기 오류로 UTF-8 모드 재실행했고,
기존 PG 적용 조건의 AI 추가에 맞춰 회귀 기대를 갱신한 후 통과했다.

TASK 21의 명시된 격리 PG 검증 요청 범위에서 로컬 통합 예외를 적용했다.
Docker daemon은 없어 기존 설치 PostgreSQL 16.15의 initdb로 새 임시 클러스터를 만들었다.
DB는 127.0.0.1:60528의 postgres, 관리 사용자는 테스트 전용 checkpoint_admin이며 실제 .env를 읽지 않았다.
테스트마다 무작위 schema/role을 생성·정리했다. 운영/shared DB는 접속하지 않았다.

```powershell
$env:TEST_CHECKPOINT_ADMIN_DATABASE_URL = 'postgresql://checkpoint_admin@127.0.0.1:60528/postgres'
$env:TEST_CHECKPOINT_DISPOSABLE = 'true'
uv run --offline --locked --extra dev python -X utf8 -c "import asyncio, pytest; asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy()); raise SystemExit(pytest.main(['-m', 'integration', 'tests/test_checkpoint_integration.py', 'tests/test_main_graph.py', '--tb=short']))"
```

최종 **32 passed in 15.42s**: 새 PG 11개 + 기존 MainGraph 21개.
풀/그래프/앱 재생성·같은 요청 재전달, 완료 결과/비용 무중복, dispatch 내부 호출 중단과 예약 보존,
현재 권한/subject/Fork/요청/판본 변경 거부, 역직렬화한 blobs/writes의 비밀/원문 미노출,
runtime 일반/TEMP DDL 및 migration DML 실패, 관리 계정/미래 버전 거부, 이력·동시 잠금/SQL 용량을 확인했다.
초기 통합 실패 2건은 매번 새 deadline을 만든 fixture와 정상 인용 수의 잘못된 고정 기대였다.
동일 원 요청을 보존하고 인용의 회차 범위·고유성을 검증하도록 보정했다.
실제 OS 강제 종료/전원 장애를 주입한 시험이나 Content 자동 재전달 검증은 아니다.

최종 권한 검사 중복 정리 후 PG 권한/버전/풀 용량 3개도 재실행해 **3 passed in 6.22s**를 확인했다.
추가 보안 리뷰에서 예상 밖 Content 예외 본문이 LangGraph 자동 ERROR write에 저장되는 것을 Red로 재현했다.
노드 경계에서 원문 없는 graph_node_failed로 변환한 뒤 아래 메모리 그래프 회귀가
**22 passed, 2 deselected in 4.38s**로 통과했다(기존 21개+누출 회귀 1개, PG/HTTP 없음).

```powershell
uv run --offline --locked --extra dev python -m pytest -m integration tests/test_checkpoint_resume.py tests/test_main_graph.py --tb=short
```

## 5. 영향·남은 결정

실제 콘텐츠/원고 쓰기·유료 호출·운영 DDL/권한 변경·키 노출은 0건이다. 실 PG 저장에는 합성 참조만 썼고
모든 콘텐츠 근거와 응답은 is_mock=true다. runtime DDL 성공·업무 Flyway 충돌·역직렬화한 checkpoint 원문 노출은
격리 검증에서 0건이다. 운영 DB의 상태나 hosted PG17 결과를 검증한 것은 아니다.
새 비용은 프로세스당 최대 PG 연결 3개와 단계/예약/결과 저장 I/O이며 실 부하/latency는 미측정이다.

| 미결 | 추천 / 대안 |
|---|---|
| 공유 DB/권한 | 운영 비활성 유지, PUBLIC TEMP/CREATE 회수와 Content 재부여를 관리자가 조율 / 별도 DB |
| 인증·암호화·보존·삭제 | Content 인가/삭제 계약·TTL·백업 삭제 기한 확정 전 실 데이터 저장 금지 / 별도 격리 저장소 검토 |
| Content 복구 | 원 요청/현재 권한·lease/attempt·grant 갱신·결과 resolver를 Content와 확정 / 현재 명시 fixture 재전달만 유지 |
| 승인/적용 | 후속 TASK의 불변 승인/영수증 계약에서 구현 / TASK 20 분석 전용·can_apply=false 유지 |
| 운영 검증 | PG17 hosted CI·전체 연결 예산·복구/롤백 리허설 후 판단 / 로컬 PG16 근거만 제한적으로 사용 |

RemoteGrant는 전문 Agent/원문/결과 resolver 미연결로 계속 dependency_unavailable다.
권한 변경은 접근을 차단하지만 자동 물리 삭제·보존 기간을 임의로 구현하지 않았다.
제품 기능표 ❌를 유지했다. 다음 TASK는 새 사용자 요청에서만 착수 가능하며 운영/실제 적용은 위 결정이 선행한다.

## 6. 리뷰·종료

ponytail-review와 직접 diff 점검으로 기존 TaskRunner/검증기를 재사용하고 별도 업무 테이블·범용 저장 계층·
새 provider를 추가하지 않았는지 확인했다. 중복 schema 권한 검사는 전체 schema 검사로 합쳤다.
CodeRabbit 외부 코드 전송은 요청하지 않아 실행하지 않았다. HTTP/브라우저·전체 suite·빌드·유료 API·
PG17 hosted CI·실제 운영 마이그레이션·실제 SIGKILL 시험은 미실행이다.

로컬 커밋 메시지: `feat: 비동기 체크포인트와 작업 상태 복원 구현` (Refs #57, #60).
push·PR 생성/병합·배포는 하지 않는다. 임시 클러스터 종료와 최종 Git 상태는 아래 종료 기록에 남긴다.

임시 클러스터의 정확한 절대 경로와 포트 60528을 확인하고 pg_ctl stop -m fast -w로 종료했다.
로그의 database system is shut down과 server stopped를 확인했다. 테스트 schema/role은 fixture가 정리했다.
파일 삭제는 하지 않아 임시 클러스터 파일은
`C:/Users/rlarl/AppData/Local/Temp/storyfork-task21-cda3930f488e40c4b580e1b42e89abd6`에 남아 있다.
최종 diff --check와 CI 선택 단위 21개를 다시 확인했다. 로컬 커밋 ID는 작업 응답과 git log로 확인한다.
