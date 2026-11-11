# TASK 06 — 고정 Registry·Task DTO·DAG Validator 인수 기록

> **2026-11-11 현행:** [TASK별 실제 구현·미구현 근거와 개발 방법](implementation-status.md)을 우선한다. 아래 내용은 당시 인수 기록이다.

2026-11-09. **실행 전 계획 검증 모듈을 구현했다.** Agent 실행·LangGraph·외부 planner·모델 호출·정본 쓰기는 연결하지 않았다.

## 기준과 범위

| 항목 | 결과 |
|---|---|
| 브랜치·기준 | `feat/54-canonical-read-scope`, HEAD `6072fc098edafa9d1388dc0a427d35f2c9a409e7`. 기준 개발 대상은 develop. fetch·병합·브랜치 전환은 하지 않았다. |
| 시작 dirty | TASK 05의 서비스 AGENTS/README·기능표·설계 02/06 수정, `app/runs/`·`test_routing.py`·TASK 05 인수 문서가 미커밋이었다. 이를 보존하고 새 모듈/테스트/인수 기록 및 설계·기능표의 TASK 06 설명만 추가했다. |
| 입력·설계 | Downloads의 `00_COMMON_RULES.md`, `07_TASK_06_registry_dag_validator.md`; [TASK 05 인수 기록](task05-handoff.md); [02 Registry/비용](02-ai-architecture.md#registry와-작업-상태-계약), [05 A~G](05-implementation-roadmap.md#a~g-기능-수용-시나리오), [06 결정](06-design-decisions.md), 프로젝트 설계·결정·서비스 경계·유스케이스·AI 서비스 지침. |
| 이슈 | [#55](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/55)를 다시 조회했다. open, 담당 kyo-135. 고정 작업·가드레일의 부분 구현이며 이슈 전체 완료가 아니다. 이슈는 변경하지 않았다. |
| 선행 상태 | TASK 05 내부 분류/대상 모듈은 완료, 실제 Content 후보·HTTP 연결·유료 모델 품질은 대기다. TASK 06의 순수 계획 검증에는 실제 연결이 필요하지 않아 진행했다. |

## 변경 파일

| 파일 | 변경 |
|---|---|
| `backend/ai-service/app/runs/orchestrator.py` | 불변 Registry·Task/InputRef/PatchTarget/Budget/RetryPolicy/PlanLimits/ConditionFacts DTO, 조건 판정 함수, `validate_plan`. |
| `backend/ai-service/tests/test_task_graph.py` | A~G 합성 task 패턴과 정상·악성 계획·분기·예산·Patch 단위 테스트 41개. |
| 이 문서, `02-ai-architecture.md`, `05-implementation-roadmap.md`, `docs/feature-roadmap.md` | 단계별 구현·계약·검증·남은 경계를 기록했다. 실제 제품 관련 ❌는 유지한다. |

기존 단일 이어쓰기 API·TASK 05 Router·검색 모듈·lockfile·환경 변수·DB·migration·production 의존성은 변경하지 않았다.

## 계약과 동작

Registry는 `context/qa/mechanical/review/simulation/development/writing/editing/world_plot/template`을 `handler, reads, input_schema, output_schema, allowed_successors, model_cap`에 고정 매핑한다. `MappingProxyType`과 frozen 명세로 등록 변경을 막고, 모든 handler는 명시적인 `NotImplementedError` stub이다. 검증기는 handler를 호출하지 않는다. 임의 Agent·함수·URL·파일·DB 쓰기 작업은 등록할 수 없다.

Task는 `task_id, operation, scope_digest, depends_on, input_refs, run_if, output_schema, retry_policy, timeout_ms, budget, status, patches`를 가진다. 신규 계획의 status는 pending만 허용한다. 다른 실행 상태와 결과는 후속 실행 계층의 범위다. `InputRef`는 부모 task ID와 고정 `output_schema`만 참조한다. 원문·코드·실행 경로는 입력할 수 없다. Schema 이름은 **참조 포트 타입 태그**이며 실제 Findings/BeatPlan 등 결과 본문의 검증은 해당 Agent DTO 구현 단계에 남긴다.

`validate_plan`은 Content가 승인한 Scope·manifest와 서버의 allowed_operations를 인자로 받는다. Task를 model_dump 후 다시 검증해 model_copy/model_construct 우회도 거부한다. 중복 ID·cycle·없는 의존·의존 없는 출력 참조·입출력 타입 불일치·허용되지 않은 후속 작업·ContextPacket 누락·scope 혼합·잘못된 manifest·Patch revision을 검사한다. 출력은 task ID의 결정적 위상 순서다. 독립 작업의 순서는 ID 정렬로 고정하며 실제 병렬 스케줄링은 하지 않는다.

`run_if`는 `always/has_confirmed_findings/simulation_required/draft_requested`만 허용한다. 조건은 서버 검증 결과인 StrictBool `ConditionFacts`로 평가하며 문자열 코드를 실행하지 않는다. confirmed 분기의 writing/editing은 Findings 참조가 있어야 한다. simulation_required는 simulation, draft_requested는 writing에만 허용한다. 사실의 출처 검증·수정 요청 여부·누락/partial/skipped 결과 전파는 후속 실행 계층이 담당해야 하며, 모델이 선언한 boolean을 승인 사실로 사용하면 안 된다.

Budget은 task 한 번의 최대 모델 호출·누적 입력/출력 토큰 예약이다. 재시도는 최대 1회까지 표현하고 최악 시도 횟수로 예약량을 곱한다. 이미 사용한 `used` 예산도 합산한다. 조건부 작업은 실행 여부와 무관하게 전부 예약한다. model_cap은 task 시도당 상한, simulation은 재시도 포함 절대 14회도 검사한다. 모델이 필요한 작업의 0회 선언과 모델 호출 시 토큰 한도 누락을 거부한다. context·mechanical은 모델 0회, QA 정확 조회·template 고정 랭킹은 0회도 가능하다.

기본 PlanLimits는 설계 02의 **실험값**인 task 12개·모델 20회·입력 48k·출력 12k·120초다. 제품 과금 정책이나 실측 모델 한도로 확정한 값이 아니다. 호출자는 더 작은 예산을 전달하고 분류 등에 쓴 양을 used에 포함해야 한다. 시간은 재시도 포함 timeout의 합으로 보수적으로 검사한다. 병렬화 절약·실시간 deadline·원자 예산 예약·실 사용량 정산·중단 재개는 구현하지 않았다. 재시도 DTO는 재호출 실행을 승인하지 않으며 모델 수신 불명 시 자동 재호출 금지 계약을 유지한다.

PatchTarget은 Content manifest에 포함된 SourceVersion과 UTF-16 반개구간 span을 참조한다. 같은 문서의 revision 불일치나 겹침은 `patch_selection_required`로 반환하고 자동 합치기·순차 적용을 하지 않는다. 붙어 있는 구간은 허용한다. 아직 생성되지 않은 Patch의 겹침과 실제 원문 길이/hash는 생성 후 Content 검증이 다시 필요하다.

## A~G 표현 범위

| 패턴 | 합성 계획 |
|---|---|
| A | context → mechanical → 조건부 simulation → review → confirmed이면 editing |
| B | context → simulation → development → 초안 요청 시 writing → mechanical 연속성 검사 |
| C | context → world_plot 영향/변경 제안 |
| D | context → 문체·말투를 묶은 editing 하나 |
| E | context → template 고정 추천 |
| F | context → mechanical 수치·고유명 검사 |
| G | context → simulation → development 아이디어 |

이는 테스트 전용 합성 계획이다. `review → confirmed이면 writing`도 별도 테스트한다. 실제 문장 생성·coverage 평가·인물별 투영·조건부 부모가 skipped일 때의 결과 처리는 실행한 것으로 표현하지 않는다. 검색 Evidence나 Mock 원고 변경을 실제 Content에 반영하지 않는다.

## 검증 결과

TDD: 테스트를 먼저 작성해 orchestrator import 부재 Red를 확인했다. 최초 구현 35개 통과 후 모델 0회/토큰 누락 예약의 실패 4개를 확인하고 최소 검사로 수정했다. 참조 필드명을 output_schema로 바꾸어 Pydantic schema 메서드 충돌 경고를 없앴다.

AI 서비스 디렉터리에서 실행:

```powershell
python -B -m pytest -p no:cacheprovider -o addopts= -q -m 'not integration' tests/test_task_graph.py tests/test_routing.py
```

**104 passed**: 신규 41개 + 직접 재사용한 TASK 05 계약 63개. 승인된 호스트 Python 3.12에서 실행했다. 단위 테스트는 실제 모델·네트워크·DB를 사용하지 않는다. 전체 suite가 아니다.

```powershell
uv run --offline --no-cache --locked --extra dev python -m pytest -m 'not integration' tests/test_task_graph.py
```

Python 3.11 부재로 실행 실패. 잠금 환경 재현·hosted Required CI는 대기다. 새 라이브러리 API는 사용하지 않고 기존 Pydantic과 표준 graphlib의 위상 정렬을 사용했다. 모델 제공사 결정은 기존 OpenAI 전용을 유지한다.

완료 전 ponytail-review와 정확성 자체 점검을 수행했다. 외부 CodeRabbit 리뷰는 이전 단계의 설치 출처 미확인과 OpenAI 전용 모델 요청을 고려해 미실행이다. 통합·시스템·브라우저·빌드·성능/부하·유료 모델 검증은 로컬 범위 밖이므로 실행하지 않았다.

## 인계와 남은 일

| 항목 | 추천·대안 |
|---|---|
| 실제 실행 | 다음 TASK에서 검증을 통과한 순서와 필요한 slice만 사용하고, Content 위임·판본과 결과 타입을 재검증한다. 현재 stub은 실행 실패가 정상이며 성공 대역으로 숨기지 않는다. |
| 조건·예산 | 서버가 생성한 ConditionFacts만 사용하고 실제 결과 누락/skip을 전파해야 한다. 현재는 보수적 전체 예약을 유지하며 실제 동시성/시간 실측 후 스케줄러에서 정교화한다. |
| Patch | 충돌이면 하나의 편집 제안으로 재생성하거나 사용자가 대안을 고르게 한다. 실제 저장·승인 API는 이 단계에서 연결하지 않는다. |
| Git | 기존 dirty 보존을 위해 새 로컬 커밋은 만들지 않았다. 제안: `feat: 고정 작업 레지스트리와 DAG 검증 구현`(#55). push·PR·병합·배포·이슈 변경 없음. |
| 다음 단계 | TASK 06 내부 검증 모듈 인계 가능. TASK 07 이후는 새 요청·해당 문서를 받은 뒤 진행하며 자동 착수하지 않는다. 실제 실행 연결·locked/CI 검증은 현재 완료에 포함하지 않는다. |
