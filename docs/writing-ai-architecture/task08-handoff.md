# TASK 08 — MainState·Main LangGraph StateGraph 인수 기록

2026-11-09. **실제 LangGraph StateGraph의 메모리 조립을 완료했다.** 1~3화 합성 질의를 검색→테스트 Agent→검증된 citation의 결정적 응답으로 연결했다. 실제 모델·승인·정본 쓰기·새 DB·frontend·공개 API는 연결하지 않는다.

## 기준과 범위

| 항목 | 확인 |
|---|---|
| 브랜치·HEAD | `feat/54-canonical-read-scope`, `6072fc098edafa9d1388dc0a427d35f2c9a409e7`. 기준 develop이나 fetch·병합·브랜치 전환 없음. |
| 시작 dirty | TASK 05~07의 AGENTS/README·설계 02/05/06·기능표·runs 패키지·라우팅/DAG/Runner 테스트·인수 문서가 미커밋이었다. 이를 보존했다. |
| 입력·선행 | Downloads의 `00_COMMON_RULES.md`, `09_TASK_08_main_stategraph.md`, [TASK 07 인수](task07-handoff.md). 선행 내부 Runner·검색 계약은 구현됐고 실제 Agent/Saver/HTTP는 미연결이었다. |
| 근거 | [02 Main StateGraph/Registry/비용](02-ai-architecture.md), [05 구현 및 A~G](05-implementation-roadmap.md), [07 검색 계약](07-retrieval-contract-and-mocks.md), 루트/AI AGENTS, 프로젝트 설계·결정·서비스 경계·유스케이스. |
| 이슈 | [#55](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/55)·[#57](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57)를 재조회했다. 모두 open, 담당 kyo-135. 내부 실행 조립의 부분 구현이며 전체 이슈 완료/변경은 아니다. |

## 변경 파일과 의존성

| 파일 | 변경 |
|---|---|
| `backend/ai-service/app/runs/state.py` | MainRequest·MainState·ScopeRef·Citation·GraphResponse·GraphResult DTO. |
| `backend/ai-service/app/runs/graph.py` | 실제 StateGraph, Scope 복원·Router·고정 계획·TaskRunner·검색 조립, citation 검증·결정적 응답·메모리 checkpoint/중복 run 차단. |
| `backend/ai-service/tests/test_main_graph.py` | 사용자 TASK 08이 명시 요청한 메모리 그래프 조립 통합 21개, integration marker. HTTP/DB/모델 없는 합성 데이터와 Agent 대역. |
| `backend/ai-service/pyproject.toml`, `uv.lock` | 요청에 필요한 `langgraph==1.2.12`와 18개 전이 의존성 추가. 기존 package 버전은 변경하지 않았다. |
| 서비스 AGENTS/README·설계 02/05/06·기능표·이 문서 | 채택 범위와 검증을 동기화하고 제품 관련 ❌를 유지했다. |

새 production 의존성은 구현 전에 사용자에게 알렸다. `uv add --no-sync --python <설치된 Python312> langgraph==1.2.12`로 잠금을 생성했다. resolver가 함께 바꾼 기존 certifi를 원래 버전으로 제한해 되돌렸으며 최종 HEAD 대비 **기존 package version 변경 0건**을 TOML 비교로 확인했다. 실제 lock은 LangGraph 1.2.12·langgraph-checkpoint 4.3.1·langchain-core 1.7.2·OpenAI 3.3.1이다. LangGraph 전이 의존성에 LangSmith SDK가 포함되지만 계정·추적 서비스·모델 연결은 구성하지 않았다.

API는 [공식 Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)·[Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)와 설치/lock 버전의 실제 테스트로 확인했다. StateGraph·조건부 edge·compile(checkpointer)·ainvoke·get_state_history·InMemorySaver.get_tuple을 사용한다.

## 흐름과 상태

Scope 복원→규칙 Router→고정 계획 검증→dispatch(TaskRunner)→merge→출력 검증→조회/제안 분기→respond→END 순서다. 복원/분류/계획 실패는 조건부 edge로 respond에 바로 종료한다. TaskRunner의 ready 선택·동시 dispatch·조건/실패 skip·결과 merge·종료 루프를 재사용하며 LangGraph 안에 중복 스케줄러를 만들지 않았다. 동적 LLM planner나 실제 모델을 호출하지 않는다.

기본 plan은 Router가 분류한 등록 capability만 연결한다. context는 그래프가 소유하고 검색 Coordinator를 호출한다. 다른 handler는 신뢰된 서버가 기존 Registry operation에만 주입한다. 미연결 handler는 실제 실패이며 합성 성공으로 자동 대체하지 않는다. plans·request·handler는 내부 조립 인자이며 공개 클라이언트의 인가나 모델 선언으로 사용하면 안 된다.

MainState는 thread/run/request 참조, messages 참조, summary_ref, scope, security_ref, classification, task_plan/results, evidence_refs, coverage, simulation/generated/change_set/approval/response 참조, execution_status, budget_usage, usage_unknown, errors를 가진다. scope는 실제 grant가 아닌 digest·manifest·기준 회차의 ScopeRef다. messages와 summary는 검증된 불투명 참조만 받는다. 실제 요청문·Query·grant·원고/인용 본문은 노드 closure의 일시 자료이며 StateGraph state에 넣지 않는다.

InMemorySaver를 기본 checkpointer로 compile하고 외부 checkpointer를 주입할 수 있다. 키는 thread+Scope digest+run이며 중간 노드 경계의 참조 상태를 저장한다. history도 현재 Content 권한과 thread/scope를 다시 검사한다. 체크포인터 저장 바이트에도 요청문·원고·grant가 없는지 검사했다.

같은 wrapper의 중복 run과 같은 InMemorySaver를 공유한 새 wrapper의 기존 run 재호출을 거부해 재dispatch를 막는다. 새 run은 모든 분류·결과·예산·제안·승인 상태를 초기화하고 서버가 전달한 대화 참조만 받는다. 여러 프로세스 동시 claim·영속 lease·장애 재개는 구현하지 않았고, 저장된 checkpoint를 실제 resume API로 노출하지 않는다. TaskRunner dispatch 내부의 개별 Task/attempt마다 LangGraph checkpoint하는 기능도 아직 없다. 향후 실제 Saver와 재개 계약 단계에서 이 경계를 확정한다.

오류·거부·명확화·partial·취소는 각각 failed/denied/clarification/partial/cancelled로 종료한다. 변경 결과 참조가 있어도 proposal로 종료하며 approval_ref는 None이다. 모든 근거가 합성이므로 실제 Content 적용은 금지다. 실제 승인·interrupt/resume·불변 제안 저장·Apply를 실행하지 않는다.

## 출력 검증과 합성 응답

검색 직후와 최종 응답 전 ContextPacket을 다시 검증한다. manifest/Scope·basis/viewpoint·스키마·mock 태그, citation source version·문서·작품/Fork·회차·공개 시점·knownBy·UTF-16 span·UTF-8 hash·원문 일치를 검사한다. 합성 Content의 row 메타데이터와 citation 회차도 대조하므로 3화 원고를 1화로 표시하는 위조를 차단한다. 이 row 대조는 기존 합성 Coordinator/MockContent 범위이며 실제 Content transport 계약을 새로 만들지 않았다. 현재 그래프의 citation은 wiki/manuscript/canonical 원문 근거만 지원한다. 현재 관계/템플릿의 별도 CAS·라이선스 출력 조립은 해당 후속 전문 기능에 남긴다.

full_context/review는 요청 범위의 manifest 회차와 Coverage를 비교한다. 누락·stale·상충·inferred/hypothetical 근거·예산 잘림은 완전 성공으로 표시하지 않는다. 검사 실패 시 citation을 비우고 거부/실패하며, 실행 중 권한 철회도 이전 인용을 내보내지 않는다. source 버전/시점/인물별 실제 최종 인가는 Content가 유지한다.

답변은 검증된 citation을 source version/span으로 중복 제거한 고정 템플릿이다. 인용 본문은 별도 GraphResponse에만 담고 StateGraph checkpoint에는 response_ref만 넣는다. 합성 자료라는 표시, 부족한 근거, 실패/취소/명확화, 적용 불가 제안을 실제 상태대로 표시한다. semantic Q&A의 자유 생성·Agent 결과 본문 DTO·실제 생성 문장은 이 단계에서 구현하지 않았다.

## TDD와 실제 검증

모듈 부재 Red를 먼저 확인했다. 최초 그래프 통합 16개 통과 후 회차 위조 테스트를 강화해 partial로 잘못 반환되는 실패를 확인했고, 정본 row 회차 대조로 수정했다. 권한 철회·저장 바이트·공유 체크포인터 재호출·잘못된 계획/Agent 출력 타입을 추가 확인했다.

AI 서비스 디렉터리의 잠금 환경에서 실행:

```powershell
uv run --locked --extra dev python -m pytest -p no:cacheprovider -o addopts= -q -m integration tests/test_main_graph.py
```

**21 passed**. TASK 문서가 명시 요청한 메모리 StateGraph 조립 통합만 선택 실행했다. 로컬 HTTP·DB·시스템·브라우저 통합을 확대한 것이 아니다. 허용 1~3화 citation·미래/타 Fork 비노출·위조/누락·확정 보류·중복 run·새 턴 초기화·명확화/거부/취소·합성 제안 종료를 확인했다.

```powershell
uv run --locked --extra dev python -m pytest -p no:cacheprovider -o addopts= -q -m 'not integration' tests/test_task_runner.py tests/test_task_graph.py tests/test_routing.py tests/test_retrieval_coordinator.py tests/test_generation.py
```

**152 passed, 1 deselected**. 직접 재사용한 실행·DAG·Router·검색·기존 proposals 생성 단위 회귀다. 기존 proposals HTTP 통합 1개는 제외했다. 기존 `app/main.py`·`generation/router.py`와 공개/내부 URL은 변경하지 않았다. 서버 실행 경로에 MainGraph를 등록하지 않았다.

```powershell
uv lock --check --offline
```

**통과**. 앞선 단계에서는 Python 3.11이 없었으나 이번 `uv run`이 CPython 3.11.15와 로컬 .venv를 구성해 실제 lock 환경에서 검증했다. 설치된 글로벌 Python3.12·LangGraph checkpoint4.2.0에서의 초기 시험과 최종 lock 환경을 구분한다. 최종 위 두 명령은 Python3.11.15·checkpoint4.3.1로 통과했다.

완료 전 ponytail-review와 정확성 자체 점검을 수행했다. 기존 Runner·Coordinator·Contract를 재사용하고 새 Agent·서버·DB·승인·tracing 설정을 만들지 않았다. CodeRabbit 외부 리뷰는 설치 출처 미확인 및 OpenAI 전용 모델 요청을 고려해 미실행이다. 전체 suite·빌드·hosted Required CI·실 모델 품질/비용·실제 데이터/부하·HTTP/frontend·DB/Saver/승인 재개는 미실행이다.

## 남은 결정·Git·다음 단계

| 항목 | 추천·대안 |
|---|---|
| 전문 기능 | 다음 TASK의 실제 결과 DTO·인가된 context slice와 해당 handler를 고정 Registry에 연결한다. 현재 합성 seam과 참조 출력만으로 제품 완료를 표시하지 않는다. |
| 승인/재개 | 불변 제안·현재 권한 재확인·영속 lease·원자 claim·실제 Saver의 checkpoint 보존/삭제·참조 자료 수명 계약 후 연결한다. 현재는 proposal 종료와 중복 거부만 유지한다. |
| 품질/현재 관계·카탈로그 | 실제 모델·검색·관계/CAS·템플릿 권리를 해당 단계에서 별도 검증한다. 합성 원문 인용 시험을 실제 생성 품질이나 전체 도메인 지원으로 표현하지 않는다. |
| Git | 기존 TASK 05~07 dirty 보존. 새 커밋 없음. 제안: `feat: 메인 StateGraph와 근거 검증 흐름 연결`(#55·#57). push·PR·병합·배포·이슈 변경 없음. |
| 다음 단계 | TASK 08 내부 메모리 조립 인계 가능. TASK 09 이후는 새 요청·해당 문서가 필요하며 자동 시작하지 않는다. 실제 모델·승인/저장·영속 복구·HTTP/화면·Required CI는 현재 완료 범위 밖이다. |
