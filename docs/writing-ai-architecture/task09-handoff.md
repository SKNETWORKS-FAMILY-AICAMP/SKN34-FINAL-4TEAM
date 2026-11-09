# TASK 09 — 내부 Run HTTP·FixtureContent 위임 인수 기록

2026-11-09. **TASK 09의 합성 내부 HTTP 경계를 완료했다.** 접수·조회·취소와 작업별 위임 검증을 기존 MainGraph에 연결했다. 실제 Content grant/MCP·실제 모델·원고 저장·공개 API·화면 연결을 완료했다는 의미는 아니다.

## 기준·범위·근거

| 항목 | 확인 |
|---|---|
| 브랜치·시작 HEAD | `feat/55-main-stategraph`, `7b80b3816a4a1f6b563713fc4abe9fc81c4f52b9`. 시작 dirty 없음. develop fetch·병합·브랜치 전환 없음. |
| 사용자 입력 | Downloads의 `00_COMMON_RULES.md`, `10_TASK_09_internal_run_http.md`, 저장소의 [TASK 08 인수](task08-handoff.md). TASK 09에 한정해 진행했다. |
| 설계 원문 | 실제 `docs/writing-ai-architecture/`의 01~07 위치 확인. [04 공개/내부 API 및 Checkpointer](04-infrastructure-integration.md), [05 구현 파일 배치 및 검증](05-implementation-roadmap.md), [06 서비스/저장 결정 11·12·15 및 미결 경계](06-design-decisions.md), 기존 02·07 계약과 코드, 루트/AI AGENTS, 프로젝트 설계·결정·DEC-41·유스케이스·개발 검증 규칙. |
| #54 | GitHub 재조회: open, 담당 `kyo-135`. 내부 요청·위임·실패 계약의 부분 구현이며 공개 Content 연결/전체 이슈 완료는 아니다. |
| #157·#163 | #157은 closed/completed, 담당 `yerin816`, Core/Content 계층 정리이며 AI 변경 제외. #163은 open, 미할당, 실제 Content MCP와 인증/위임 전송 미결. 두 이슈의 구현을 진행하지 않았다. |

이슈 원문: [#54](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54), [#157](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/157), [#163](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/163). 기존 #54 본문의 Core 정본 표현은 현행 DEC-41의 Content 정본·인가 경계를 따른다.

## 변경 파일·실행 계약

| 파일 | 변경 |
|---|---|
| `backend/ai-service/app/runs/schemas.py` | RunRequest·RunBudget·RunResponse·RunFailure. 기존 SourceVersion/TaskResult/Coverage/GraphResponse 재사용. |
| `backend/ai-service/app/runs/service.py` | FixtureContent/FixtureGrant, 정확한 작업 바인딩·만료/철회/manifest 대조, 메모리 claim·중복/thread busy 거부·실행·조회·취소·timeout·종료 정리. |
| `backend/ai-service/app/runs/router.py` | 내부 접수 POST·상태 GET·취소 POST, 서비스 토큰 확인·중복 헤더 거부·HTTP 오류 매핑. |
| `backend/ai-service/app/main.py` | 새 router 등록·선택적 합성 서비스 주입·lifespan 정리·내부 Run 검증 오류의 입력값 비노출. 기존 health/generation router 보존. |
| `backend/ai-service/app/runs/graph.py` | 실행별 ExecutionLimits 인자를 받아 기존 DAG Validator/TaskRunner에 전달. 서버의 그래프 객체 설정을 요청마다 변경하지 않는다. |
| `backend/ai-service/tests/test_run_service.py`, `test_run_api.py` | 새 단위 14개·HTTP 통합 17개. 합성 Content와 테스트 handler만 사용. |
| AI AGENTS/README, `docs/design/design.md`, 기능표, 설계 04/05/06, 이 기록 | 내부 계약·현황·검증·미연결 한계 동기화. 기능표 제품 행의 ❌는 유지. |

세 경로의 상세 DTO와 HTTP/상태 표는 [구현 계약](04-infrastructure-integration.md#task-09-합성-내부-run-http-계약)을 따른다. `POST`는 202로 접수하고 GET에서 종료 상태를 확인한다. 모든 경로에 서비스 토큰이 필요하며 상태/취소에는 grant/thread 헤더도 필요하다. DTO 위조·추가 입력·중복 dispatch·만료/철회·타 thread 접근을 차단한다. 유효한 합성 작업도 필요한 Agent handler가 없으면 실패하며 성공 대역으로 자동 대체하지 않는다.

Scope·Query·prompt·plan·handler는 HTTP 입력이 아니다. 서버의 FixtureGrant에서 MainRequest를 복원한다. 전체 요청 DTO를 발급 fixture와 대조한 후 Content 대역의 현재 권한/manifest를 재검증한다. 기존 Query가 정확한 document/kind로 제한되어야 하고 해당 판본 집합이 targetRefs와 일치해야 한다. 실제 Content adapter는 fixture 경계에서 거부한다. 실제 SQL·Neo4j·MCP·네트워크 Content client를 만들지 않았다.

## TDD·검증 결과

모듈 없는 상태에서 새 단위 테스트를 먼저 작성해 `ModuleNotFoundError: app.runs.schemas` Red를 확인했다. 이후 최소 구현으로 단위 계약을 통과시켰다. 실제 Content adapter 접근 금지 테스트도 먼저 실패시킨 뒤 MockContentReadPort 제한으로 통과시켰다. HTTP 통합의 최초 실패는 1초 fixture 예산이 기존 ask DAG 예약 20초보다 작은 설정 때문이었다. 정상 fixture를 20초로 맞추고 별도의 20ms timeout·모델 예산 0회 거부를 검증했다. 기존 고정 계획을 예산에 맞춰 임의 변경하지 않았다.

초기 `uv run --locked --extra dev ...`는 샌드박스 uv 캐시 쓰기 오류로 실행되지 않았다. `.venv` 직접 실행에서는 Windows asyncio의 내부 `socketpair()`가 샌드박스 loopback 제한으로 멈췄다. faulthandler로 `_fallback_socketpair → accept` 위치를 확인해 대기 프로세스를 종료했고, 선택 테스트만 호스트 권한으로 실행했다. 실패/중단된 시도를 통과로 집계하지 않았다. uv 캐시는 저장소 내부의 자동 Git-ignore 경로 `.uv-task09-cache`로 분리했다.

최종 AI 서비스 디렉터리에서 실행한 명령:

```powershell
.venv/Scripts/python.exe -m pytest -p no:cacheprovider -o addopts= -q -m 'not integration' tests/test_run_service.py tests/test_task_runner.py tests/test_task_graph.py tests/test_routing.py tests/test_retrieval_coordinator.py tests/test_generation.py
```

**166 passed, 1 deselected**. 새 내부 서비스 14개와 직접 재사용한 실행·DAG·Router·검색·기존 생성 단위 152개. 기존 HTTP 1개는 이 명령에서 제외했다.

```powershell
.venv/Scripts/python.exe -m pytest -p no:cacheprovider -o addopts= -q -m integration tests/test_run_api.py tests/test_main_graph.py tests/test_generation.py tests/test_health.py
```

**40 passed, 2 deselected**. 새 HTTP 17개·기존 메모리 그래프 21개·기존 proposals HTTP 1개·health HTTP 1개. 사용자 TASK 09에서 요청한 HTTP/회귀 범위이며 전체 suite·시스템·브라우저·DB 통합을 확대한 것이 아니다. HTTP 통합 marker는 유지했다. 인증/비인증·위조 work/Fork/target·추가/잘못된 입력·동일 run·허용 인용·취소/재인가·timeout·거부/실패/partial/명확화·예산 차단을 확인했다.

```powershell
uv --cache-dir .uv-task09-cache lock --check --offline
uv --cache-dir .uv-task09-cache run --locked --offline --extra dev python -c "import sys; from importlib.metadata import version; print(sys.version.split()[0]); print({n:version(n) for n in ('fastapi','langgraph','langgraph-checkpoint','pydantic','pytest')})"
git diff --check
```

모두 통과. 잠금 환경은 Python 3.11.15, FastAPI 0.139.2, LangGraph 1.2.12, checkpoint 4.3.1, Pydantic 2.13.4, pytest 9.1.1이다. 의존성·lockfile 변경은 없다.

완료 전 ponytail-review 기준의 자체 과잉 설계 점검과 정확성 점검을 수행했다. 기존 계약·검증기·Runner·MainGraph를 재사용했고 범용 저장소/추상 provider/새 worker/외부 서비스를 추가하지 않았다. CodeRabbit은 설치 출처가 확인되지 않아 실행하지 않았다. 적용한 [code-review 스킬](C:/Users/rlarl/.agents/skills/code-review/SKILL.md)의 인증 지침은 “If the installation's source is uncertain, ask the user to confirm it; do not infer trust from location alone.”이라고 명시한다. 권장 외부 리뷰만 보류했으며 작업 완료를 막는 승인으로 해석하지 않았다. CI·빌드·전체 suite·실제 모델 품질·DB/MCP·화면·부하 테스트는 미실행이다.

## 영향·위험·결정·인수

| 항목 | 결과 및 추천/대안 |
|---|---|
| 보안·권한 | 서비스 토큰만으로 Scope를 만들 수 없다. 등록된 작업 위임과 현재 권한을 함께 확인한다. 요청 오류·실행 예외에 원고/키/grant를 싣지 않는다. MainState/체크포인트의 참조 전용 경계를 유지한다. 합성 인용 응답은 메모리 결과로만 보관한다. |
| 비용·성능·버전 | 실제 유료 호출 0회, production 의존성/DB migration 0개. 메모리 조회·claim이며 다중 worker/재시작 시 중복 방지를 보장하지 않는다. 장기 실행 환경에는 Content 영속 lease가 필요하고 이 단계에서는 단일 프로세스 fixture로 제한한다. |
| Mock/real | 기본 앱은 Run 미설정 503. 명시 주입된 fixture에서만 실행한다. grant의 최대 TTL·발급/서명·갱신·원격 철회는 실제 정책 미정이다. 추천은 #163에서 Content 소유 transport/위임을 확정한 후 별도 구현, 대안은 현 합성 검증만 유지다. |
| 판본·결과·적용 | 같은 문서/kind의 복수 판본은 거부한다. 원격 갱신·재개·SSE·승인·Content 저장은 없다. 합성 제안은 실제 원고에 적용할 수 없다. 기존 고정 계획보다 작은 예산은 실패로 표시한다. |
| Git·다음 단계 | #54 범위의 로컬 커밋 제목은 `feat: 내부 Run API와 합성 작업 위임 검증 연결`. push·PR 작성/갱신·병합·배포는 실행하지 않는다. 이전 PR 설명 미갱신 상태는 남는다. 다음 TASK는 새 사용자 요청에서만 착수하며 실제 Content 연결에는 위임 계약·담당자 합의가 선행되어야 한다. |
