# TASK 07 — Task Orchestrator·Send slice·Reducer·예산 인수 기록

> **2026-11-11 현행:** [TASK별 실제 구현·미구현 근거와 개발 방법](implementation-status.md)을 우선한다. 아래 내용은 당시 인수 기록이다.

2026-11-09. **메모리 기반 TaskRunner와 합성 실행 검증을 완료했다.** 실제 Agent/OpenAI 모델·LangGraph graph·Postgres Saver·승인·정본 적용·공개 API는 연결하지 않았다. 다음 TASK는 진행하지 않는다.

## 기준·권한·선행 상태

| 항목 | 확인 |
|---|---|
| 브랜치·시작 HEAD | `feat/54-canonical-read-scope`, `6072fc098edafa9d1388dc0a427d35f2c9a409e7`. 기준 개발 대상 develop, fetch·병합·브랜치 전환 없음. |
| 시작 dirty | TASK 05·06의 AGENTS/README·기능표·설계 02/05/06, runs 패키지·라우팅/DAG 테스트·인수 기록이 미커밋이었다. 기존 변경을 보존했다. |
| 입력 | Downloads의 `00_COMMON_RULES.md`, `08_TASK_07_orchestrator_send_budget.md`, [TASK 06 인수 기록](task06-handoff.md), 현재 코드·단위 테스트. 선행 단계는 내부 계획 검증 완료, 실제 실행 연결은 대기였다. |
| 설계 | [02 Registry·작업 상태·비용/실패](02-ai-architecture.md#registry와-작업-상태-계약), [05 A~G·실패 검증](05-implementation-roadmap.md#a~g-기능-수용-시나리오), 저장소/AI AGENTS와 기존 DEC-36·37·41의 Content 정본·인가 경계. |
| 이슈 | [#55](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/55)·[#57](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57)를 다시 조회했다. 모두 open, 담당 kyo-135. 실행·턴 격리 기반의 부분 구현이며 이슈 전체 완료가 아니다. 이슈 수정/댓글 없음. |

## 파일과 계약

| 파일 | 변경 |
|---|---|
| `backend/ai-service/app/runs/runner.py` | ExecutionLimits·TaskOutput/Result/Slice·ModelReply·RunResult DTO, ResultReducer·CallContext·TaskRunner. |
| `backend/ai-service/app/runs/orchestrator.py` | InputRef에 StrictBool optional 추가. 선택적 SimulationReport 참조만 허용하며 Context/Findings 등 필수 근거를 optional로 바꿀 수 없다. |
| `backend/ai-service/tests/test_task_runner.py` | 새 실행/취소/예산/병합 단위 테스트 21개. TASK 06의 합성 Scope·manifest·Task 생성 helper를 재사용한다. |
| 이 문서·설계 02/05·기능표 | 구현 범위와 검증 증거를 동기화했다. 제품 관련 ❌는 유지한다. |

`TaskRunner`는 생성 시 전체 계획을 기존 validate_plan으로 재검증한다. handler 매핑은 신뢰된 서버가 기존 Registry operation에만 바인딩하는 내부 seam이다. 모델이나 공개 클라이언트가 handler를 등록할 수 없다. 미등록 operation·새 URL/함수/파일 실행 경로는 허용하지 않는다. 미연결 handler는 명시적 failed이며 성공 Mock으로 자동 대체하지 않는다.

ready는 모든 depends_on 결과가 종결된 Task다. 기본 동시성은 2이며 1로 낮출 수 있고 3 이상은 거부한다. Task는 pending에서 running을 거쳐 succeeded/partial/failed/cancelled/skipped로 전이하고, retry는 attempt를 증가시킨다. 상태 전이는 RunResult.transitions에 참조 ID와 상태만 남긴다. 원문이나 예외 메시지는 기록하지 않는다.

실패·취소·partial 선행은 후속 Task를 skip한다. 선택적 시뮬레이션만 `InputRef(optional=True)`로 선언할 수 있으며, 해당 부모가 **조건 미충족으로 skipped인 경우만** 결과 없이 검수를 계속한다. 시뮬레이션 장애나 필수 근거 누락을 성공으로 바꾸지 않는다. 이를 명시하기 위해 TASK 06 참조 계약을 같은 작업에서 보완했다.

confirmed와 simulation_required는 해당 Task가 직접 참조한 Findings 결과의 서버 검증 ConditionFacts에서만 취한다. draft_requested와 wants_change는 신뢰된 서버 입력이다. 문자열 boolean은 거부한다. 수정/집필/세계관 변경은 wants_change가 없으면 skip하고, 조건 미충족 Writing은 handler/모델 호출 0회다. 향후 handler가 모델 선언만으로 ConditionFacts를 만들지 않도록 Findings·근거의 검증이 필요하다.

TaskSlice는 run/task/attempt/lease·operation·출력 타입과 명시한 입력 참조만 제공한다. 전체 Scope·grant·원문·messages 상태를 포함하지 않는다. `slice.model_dump()`가 향후 LangGraph Send arg의 준비 DTO이며, 이번 단계에는 LangGraph 의존성·실제 Send 객체/graph를 추가하지 않았다. 명시한 참조를 실제 원문으로 해석할 때는 Content 인가·판본·인물별 투영을 재확인해야 한다.

ResultReducer는 `(run_id,task_id,attempt)`와 현재 lease를 대조해 중복·다른 run·오래된 lease의 결과를 버린다. RunResult.results는 계획의 위상 순서, 독립 작업은 task ID 순서로 조립한다. message_refs는 그 순서로 누적하며 병렬 messages 덮어쓰기는 없다. 결과 본문은 이번 단계에서 보관하지 않고 output_ref만 전달한다.

## 예산·실행 수명

ExecutionLimits는 PlanLimits(기존 실험값 12 tasks·20 모델 시도·입력48k/출력12k·120초), concurrency=2, dynamic_expansions=1을 분리해 테스트할 수 있다. 실제 운영/과금 정책으로 확정한 값이 아니다. 기존 검증기의 최악 예약(조건부 작업·재시도 포함, timeout 합산)을 유지한다.

CallContext.call_model은 모델 요청당 Budget(model_calls=1,input_tokens,output_tokens)를 받아 task와 run의 남은 예산을 검사한다. 동일 event loop에서 await 전에 검사·예약을 완료하므로 동시 예약도 한도를 넘지 않는다. invoke는 예약 한도를 전달받고 실제 모델 구현 시 이 한도에 맞춰 출력을 제한해야 한다. 현재 invoke는 모두 테스트 대역이다.

정상 usage는 예약에서 실제 입력/출력 토큰으로 정산한다. 모델 시도 1회는 소모한다. usage 미보고·오류·timeout·취소·진행 중 응답은 예약을 유지하고 usage_unknown=true다. 이는 보수적 **예산 회계**이며 확정 청구액이나 Core 크레딧 정산이 아니다. provider가 예약보다 큰 usage를 보고하면 보고량을 보존하고 해당 CallContext를 실패 상태로 잠가 추가 호출/성공 결과를 차단한다.

자동 retry는 명시적 RetryableTaskError, 모델 호출 전의 읽기 작업, 등록 retry_policy의 최대 1회만 허용한다. 모델 요청을 한 번이라도 시작했거나 변경 작업이면 재시도하지 않는다. 오류 일반·timeout은 자동 재시도하지 않는다. 현재 재시도에는 네트워크 회로 차단·jitter를 추가하지 않았으며 실 제공사 연결 단계에서 읽기 실패의 재시도 가능성 계약을 확인해야 한다.

cancel은 실행 대기에서도 깨우며 Task 시작·모델 호출 직전·호출 완료·결과 완료 때 lease/취소/deadline을 검사한다. 실행 제한 120초는 run 시작부터이며 승인 대기는 이 단계에 없다. 취소한 작업의 lease로 돌아오는 결과는 병합하지 않고 진행 중 호출 예산도 남긴다. 협조하지 않는 Python handler를 프로세스 수준에서 강제 종료하는 기능은 없다. 취소를 무시한 외부 요청의 비용도 0으로 간주하지 않는다. 서버 handler는 비동기 취소와 CallContext seam을 준수해야 한다.

extend는 신뢰된 서버가 추가하는 Task만 대상으로 기존+신규 계획 전체를 재검증하고 최대 1회만 반영한다. 실패한 확장은 계획을 변경하지 않는다. 기존 Task 교체·무한 재계획·외부 LLM planner는 없다. 같은 TaskRunner.run을 다시 호출하면 거부하며 새 턴은 새 실행기로 초기화한다. 실제 장애 복원/영속 lease·분산 원자 예약은 미구현이다.

독립 성공 후 다른 작업이 실패하면 성공 참조를 유지해 partial로 반환한다. partial 출력 자체도 partial로 보존하고 필수 후속은 막는다. cancel은 cancelled, 사용 가능한 결과 없이 실패하면 failed다. 실패 원문·실 사용자 원고·키는 RunResult에 넣지 않는다.

## TDD·검증

모듈 부재 Red를 먼저 확인했다. 최초 실행 테스트에서 반환 스키마 중복 전달을 수정했고, 선택 시뮬레이션 skip·취소 중 사용량 미확인·partial 단독 집계·보고 usage 초과 후 계속 호출의 추가 실패 테스트를 확인한 후 수정했다. 이벤트 동기화로 실제 독립 작업 중첩과 동시 상한을 검증했다.

AI 서비스에서 실행한 선택 단위:

```powershell
python -B -m pytest -p no:cacheprovider -o addopts= -q -m 'not integration' tests/test_task_runner.py tests/test_task_graph.py tests/test_routing.py
```

**125 passed**: TASK 07 21개 + TASK 06 41개 + TASK 05 63개. 승인된 호스트 Python 3.12에서 실행했다. 모델·DB·HTTP·전체 suite는 실행하지 않았다. timeout 시험은 합성 coroutine의 20ms 제한이며 실제 제공사 지연/성능 증거가 아니다.

```powershell
uv run --offline --no-cache --locked --extra dev python -m pytest -m 'not integration' tests/test_task_runner.py
```

Python 3.11 부재로 실패했다. 잠금 환경·hosted Required CI는 대기이며 lockfile을 바꾸지 않았다. 기존 Pydantic과 표준 asyncio를 사용하고 새 production 의존성·환경 변수·DB/DDL·실제 모델 전송·원고 반영·배포 변경은 없다. 모델 제공사는 기존 OpenAI 전용 결정을 유지한다. 합성 결과는 is_mock=true이며 실제 Content 적용 근거로 사용할 수 없다.

완료 전 ponytail-review와 정확성 자체 점검을 수행했다. 외부 CodeRabbit은 설치 출처 미확인 및 OpenAI 전용 모델 요청을 고려해 실행하지 않았다. 통합·시스템·브라우저·빌드·실 모델 비용/품질/부하·Saver·승인/재개는 미실행이다.

## 남은 일·Git·다음 단계

| 항목 | 추천·대안 |
|---|---|
| 실행 연결 | 다음 단계별 handler를 기존 operation에 서버가 연결하고 실제 결과 타입·인가·근거를 검증한다. 그전에는 현재 합성 seam만 사용한다. |
| 모델/예산 | OpenAI 연결은 별도 승인된 합성 호출로 출력 상한·usage 계약을 검증한 뒤 진행한다. 현 예산은 보수적 실험 상한이며 실제 청구/정산은 Core 계약이 필요하다. |
| 수명/분산 | 단일 event loop에서만 예약이 원자적이다. 실제 다중 worker·복원은 Saver/lease 소유권·취소 전파 계약을 먼저 확정한다. 현재 객체를 재개 API로 노출하지 않는다. |
| Git | 기존 TASK 05·06 dirty를 보존했다. 새 커밋 없음. 제안: `feat: 작업 DAG 실행과 예산 예약 및 취소 구현`(#55·#57). push·PR·병합·배포·이슈 변경 없음. |
| 다음 단계 | TASK 07 내부 실행 모듈 인계 가능. TASK 08 이후는 새 요청과 해당 문서를 받은 후 진행한다. 실제 Agent·LangGraph·Content·운영 모델·locked/CI 검증은 완료 범위에 포함하지 않는다. |
