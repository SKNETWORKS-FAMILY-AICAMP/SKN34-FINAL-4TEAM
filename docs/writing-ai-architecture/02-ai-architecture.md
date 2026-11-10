# 작업 계획과 LangGraph 실행

2026-11-10 TASK 21: MainGraph의 명시적 resume/비동기 이력과 전용 AsyncPostgresSaver를 연결했다.
노드 경계는 sync durability, dispatch 내부는 별도 RunnerJournal에 완료 결과·active attempt·호출 전 예약을 저장한다.
현재 Content 인가/manifest·원래 요청/한도·문맥 digest를 재검증하고 불명 호출을 재실행하지 않는다.
실제 Content/모델 조립·승인·자동 재전달/운영 채택은 미완료다. [수용·경계](task21-handoff.md).

2026-11-10 TASK 19: `next_draft`·`expand_conti`의 고정 capability는 Context→Development→Writing→Mechanical이다.
`next_draft_tasks`는 요청 DTO의 명시적 필요·opt-in에만 Simulation을 별도 예산으로 추가하며,
콘티 전용은 Development에서 종료한다. run별 `NextDraftHandler`는 검증된 BeatPlan/시뮬레이션/현재 관계를
Writing에 넘기고 연속성 검사 후에만 성공 후보를 공개한다. Main context 소유권은 유지하고
명시적 plan_factory/전문 handler 주입을 사용한다. 실제 공개 Run의 자동 조립은 미연결이다.
[입력·검증·한계](task19-handoff.md).

**권장 구조는 하나의 Python StateGraph가 검증된 작업 DAG를 실행하는 방식이다.** 예를 들어 “3화의 카이를 검수하고 문제가 있으면 고쳐 줘”는 검수 결과가 있어야 수정 여부가 정해진다. Router는 의도와 가능한 작업을 분류하고, Python이 선행 조건과 비용을 검사하며, 근거 있는 지적이 있을 때만 편집 작업에 원문 구간을 넘긴다. 새 서버는 필요하지 않다.

모든 흐름도의 파란 사각형은 모델 호출 0회, 노란 육각형은 조건부 호출, 빨간 둥근 노드는 실행 시 모델 호출, 회색 마름모는 결정적 분기다. 점선은 조회 도구·선택적 의존·이벤트를 뜻한다.

### 1. 시스템 경계

TASK 16의 `development`는 `BeatPlan.v1` 참조를 반환하는 run별 handler로 구현했다. 선택 Simulation→Development 계획은 `development_tasks`로 명시 조립하며 Writing 후속은 등록하지 않는다. [계약·검증](task16-handoff.md).

```mermaid
flowchart LR
    subgraph Product[기존 제품]
      UI[집필실] --> Web[공개 진입점] --> C[Content 인가 및 정본]
      C --> Auth[Core 세션 확인]
      C --> PG[콘텐츠 PostgreSQL]
      C --> Neo[현재 관계 Neo4j]
    end
    subgraph AI[기존 내부 Python 서비스의 확장안]
      R{{Router}}:::optional --> O[Task Orchestrator]
      O -->|선택한 역할만| A{{Specialists}}:::optional
      A -.-> T[공통 검색 및 근거 조립]
      O -.-> S[Saver 실행 상태]
    end
    C --> R
    T -.-> C
    T -.-> B[Wiki 및 Vector 또는 Fixture]
    A --> P[결과 또는 고정 제안]
    P --> C
    classDef default fill:#dbeafe,stroke:#2563eb,color:#111827
    classDef optional fill:#fef3c7,stroke:#b45309,color:#111827
```

### 2. Main StateGraph 상세

2026-11-09 TASK 08: `runs/state.py`·`graph.py`에서 실제 LangGraph 1.2.12 StateGraph와 참조 전용 InMemorySaver를 연결했다. Scope 확인·Router·고정 계획·기존 TaskRunner·합성 검색/Agent·출력 검증·제안 종료를 조립한다. 아래 목표 흐름 중 승인/적용·SSE·영속 재개는 아직 없다. TaskRunner의 ready/dispatch/merge 루프는 dispatch 노드 안에서 재사용하고 StateGraph는 그 바깥 노드 경계를 checkpoint한다. [상세 계약·증거](task08-handoff.md).

```mermaid
flowchart TD
    I[Content 인증 및 ACL] --> S[대상과 thread 복원]
    S --> R{{의도 분류}}:::optional --> D[계획 작성 및 검증]
    D --> V{실행 가능}:::gate
    V -->|대상 모호| Q[확인 질문]
    V -->|예| O[준비된 작업 선택]
    O --> A{{선택된 Specialist}}:::optional
    A -.-> T[권한 제한 Retrieval]
    A --> M[결과 병합 및 검증]
    M --> K{남은 작업}:::gate
    K -->|예산 내| O
    K -->|없음| P{변경 제안}:::gate
    P -->|있음| H[불변 제안 기록 및 interrupt]
    H -->|승인| C[Content Apply 및 영수증 검증]
    H -->|거절| F[최종 응답]
    C --> F
    P -->|없음| F
    A -->|오류 또는 취소| E[의존 작업 중지 및 부분 결과]
    E --> F
    O -.-> CP[단계별 checkpoint]
    M -.-> SSE[고정 진행 이벤트]
    classDef default fill:#dbeafe,stroke:#2563eb,color:#111827
    classDef optional fill:#fef3c7,stroke:#b45309,color:#111827
    classDef gate fill:#e5e7eb,stroke:#4b5563,color:#111827
```

### 3. Main StateGraph 간단 버전

```mermaid
flowchart LR
    R{{Router}}:::optional --> O[작업 계획]
    O -->|조건부 선택| A{{전문 작업}}:::optional
    A -.-> T[공통 조회]
    A --> V[결과와 근거]
    V --> G{수정 요청}:::gate
    G -->|예| H[승인 후 적용]
    G -->|아니오| F[답변]
    classDef default fill:#dbeafe,stroke:#2563eb,color:#111827
    classDef optional fill:#fef3c7,stroke:#b45309,color:#111827
    classDef gate fill:#e5e7eb,stroke:#4b5563,color:#111827
```

### 4. Task Orchestrator 내부

```mermaid
flowchart TD
    R[의도와 허용 역할] --> T{등록된 패턴}:::gate
    T -->|예| P[DAG 템플릿]
    T -->|없고 정책 허용| L(구조화 계획 1회):::model
    L --> V[Python DAG Validator]
    P --> V
    V --> N[의존성 및 예산 예약]
    N --> J{준비된 작업}:::gate
    J -->|있음| F[Send로 독립 작업 분배]
    F --> A{{등록된 역할 실행}}:::optional
    A --> B[task_id별 결과 병합]
    B --> C{허용된 후속 조건}:::gate
    C -->|추가 작업| V
    C -->|기존 계획 계속| N
    J -->|완료 또는 실패| X[결과 또는 부분 실패]
    classDef default fill:#dbeafe,stroke:#2563eb,color:#111827
    classDef optional fill:#fef3c7,stroke:#b45309,color:#111827
    classDef model fill:#fee2e2,stroke:#b91c1c,color:#111827
    classDef gate fill:#e5e7eb,stroke:#4b5563,color:#111827
```

## 라우팅과 대상 식별

`RouterPort.classify(request, allowed_operations, ui_mode) → Classification`. `Classification` 필드는 `in_scope, risk_flags, primary_intent, task_pattern, capabilities[], missing_slots[], wants_change, approval_intent`. 명시적인 기능 버튼·단순 숫자/명칭 점검은 Python 규칙으로 분류한다. 자유문이 모호하면 선택한 분류기 한 곳에만 요청한다. 독자 피드백 유형은 사용자의 선택을 유지한다. 대화에서 “승인”을 인식해도 승인 화면과 인증된 결정 API를 거친다.

| 방식 | 한국어 복합 요청·유연성 | 비용·지연 | 안전·테스트·복구 |
|---|---|---|---|
| 등록 규칙만 | 단일 의도·명시 패턴은 명확. 예상 밖 조합에 약함 | 모델 0회 | 재현 쉬움. 등록되지 않은 입력은 명확화 |
| 자유형 LLM planner | 표현 폭 넓음. 임의 작업명·잘못된 순서 가능 | 계획 생성 매회 | 형식과 의미 검증 부담. 재계획 복구 어려움 |
| Specialist 직접 호출형 Supervisor | 중간 결과를 보고 유연하게 위임 | 단계마다 분류 가능, 중복 호출 위험 | 호출 경로·권한·비용을 한곳에서 제한하기 어려움 |
| **등록 DAG + 제한 분류·계획** | 알려진 복합 의도는 패턴, 결과 기반 분기. 낯선 조합은 허용 집합 내 계획 또는 질문 | 고정 경로 0회, 모호한 분류 최대 1회, 별도 planner는 평가 뒤 활성화 | 권한·예산·승인은 결정적 검사. 역할 추가 시 I/O·의존 조건·평가 예제 등록 |

**분류 제공사 선택.** `RuleBasedRouter`를 기준선으로 둔다. `JEVRouterAdapter`는 state 한 개에 예컨대 지원 여부(noul), 의심 신호(noul), 주 의도(choice), 복합 패턴(choice), 명확성(score), 변경 요청(noul)의 **6문항**을 묶는다. 역할 조합·승인 절차는 코드로 도출한다. 지시서의 8문항 한도 안에서 동작한다. TypeSafe 원 API는 Choice·Score·Noul과 이미지 Box를 문서화하고 공식 예제에는 13문항 일괄 호출도 있다. 8을 모든 endpoint의 고정 제품 사양으로 전제하지 않고 도입할 endpoint와 버전을 재확인한다. [TypeSafe API](https://docs.typesafe.ai/api/system-one) · [공식 병렬 질문 예제](https://docs.typesafe.ai/cookbooks/parallel_questions)

`OpenAIDecisionsRouterAdapter`는 `POST /v1/decisions`의 정형 분류·점수 결과를 같은 enum으로 매핑한다. `ResponsesRouterAdapter`는 구조화된 복합 출력이나 제한 후보 선택이 필요할 때의 대안이다. refusal·incomplete·미등록 값은 명확화 또는 실패다. 기존 OpenAI 연결 재사용 이점이 있지만 모델 지원·계정 권한·한글 성능·가격은 별도 검증 대상이다. 제공사 우열은 동일한 블라인드 한국어 세트로 판단한다. [Decisions](https://developers.openai.com/api/reference/resources/decisions/methods/create) · [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

Slot Resolver는 인증된 UI 대상 → 같은 scope의 이전 대상 → 회차·이름 parser → Content의 허용 후보 → 후보 내 선택 → 필요 시 구조화 추출 → 사용자 확인 순으로 진행한다. “5화”와 UI의 “3화”가 다르면 명시한 범위를 Content에서 다시 확인한다. 다른 작품·Fork나 동명이인은 확인 전 실행을 멈춘다. 검색 문구는 인가 정보나 tool 이름으로 해석하지 않는다.

**2026-11-09 TASK 05 구현 결정.** 사용자 요청으로 공급자를 OpenAI로 선택했다. 명시 UI·등록 단일/복합 표현은 규칙으로 0회, 나머지 입력은 `OpenAIDecisionsRouterAdapter`의 `gpt-6-luna` 선택형 질문 1회로 분류한다. 실제 승인·저장 요구는 실행하지 않는다. 등록 복합 enum은 위 검수→조건부 수정 예제의 `review_then_edit`만 구현하며, 다른 조합은 `clarify`다. 대상 확인은 별도 `SlotResolver`에서 Content 후보를 매번 재검증한다. 서버 API·DAG 실행·Content 실제 후보 transport는 이 단계에 연결하지 않았다. [계약·검증·사용 예](task05-handoff.md).

## Registry와 작업 상태 계약

2026-11-10 TASK 18: writing/editing에 `agents/writing.py`의 동일 DTO handler와 run별 WritingHandler를 등록했다.
기존 GeneratedText.v1/ChangeSet.v1·model_cap=1을 유지한다. writing_tasks는 Context→생성/편집 한 Task를 만들고
선택 범위를 기존 PatchTarget에 고정한다. 실제 Content 준비/승인·모델·공개 Run 자동 조립은 추가하지 않았다.
[입출력·투영·단위·한계](task18-handoff.md).

2026-11-10 TASK 13: 고정 `template` capability에 `agents/template_recommendation.py`의 DTO handler와 run별 adapter를 연결했다. 기본 계획의 모델 0회는 유지하며 명시 맞춤 설명에는 별도 1회 예산이 필요하다. 공개 Content 입력과 카탈로그 권리·판본을 Python에서 재확인한다. [실제 계약·단위 검증·미연결 범위](task13-handoff.md).

2026-11-09 TASK 12: `mechanical`에 `agents/review.py`의 DTO handler와 run별 TaskRunner adapter를 구현했다. model_cap=0을 유지하고 검사 종류별 규칙만 실행한다. 확정 불일치가 있을 때만 `has_confirmed_findings=true`이며 `simulation_required`는 false다. [Finding·입력 기준·검증](task12-handoff.md). 의미 Review·실제 provider·원고 쓰기는 연결하지 않았다.

2026-11-09 TASK 11: `qa`의 DTO handler를 `agents/story_context.py`에 구현해 Registry에 등록했다. TaskRunner 호출 계약에는 run별 `StoryContextHandler`를 명시 주입한다. 정확 조회는 Content 대역에서 0회 모델로 확인하고 해석은 검증된 문맥과 모델 대역 1회만 사용한다. 다른 capability stub과 실제 원문/모델의 미연결 경계는 유지한다. [입출력·연결·검증](task11-handoff.md).

2026-11-09 TASK 06: `runs/orchestrator.py`에 불변 Registry·참조 타입 Task DTO·위상 검증·보수적 예산 예약 검사를 구현했다. 모든 handler는 미연결 stub이며 LangGraph·Agent·저장 실행은 없다. 겹치는 Patch는 사용자 선택 오류로 거부한다. [상세 계약과 검증](task06-handoff.md).

| capability | 허용 입력 → 출력 | 허용 후속 조건 |
|---|---|---|
| context / QA | Scope·질문 → ContextPacket 또는 Answer | Evidence가 부족하면 제한된 보강 또는 partial |
| mechanical / review | 고정 원문·설정·검사종류 → Findings | 행동 개연성에만 simulation. 수정 요청과 유효 지적이 함께 있으면 editing |
| simulation | 격리된 인물별 packet·상황 → SimulationReport | review·development·writing·world가 가상 결과로 참조 |
| development / writing | Coverage·콘티·가상 결과 → BeatPlan 또는 Text/Patch | 초안 모드만 writing, 생성 후 연속성 점검 |
| world_plot / template | 정본 대상·영향 범위 또는 라이선스 필터 → ChangeSet 또는 Recommendations | 수정 요청만 승인으로 이동. 추천은 조회로 종료 |

2026-11-10 TASK 14: `simulation`에 인물 투영·순차 LangGraph·행동 검증·임시 reducer·결정적 Analyzer를 연결했다. `SimulationHandler`는 run별 명시 주입하며 호출마다 TaskRunner의 예약·사용량·취소 경계를 사용한다. 보고 본문은 메모리에만 두고 `SimulationReport.v1` 결과 참조만 Main에 반환한다. 실제 모델·공개 Run 자동 조립·의미 Review 연결은 미연결이다. [계약·검증·한계](task14-handoff.md).

2026-11-10 TASK 15: `review`에 Semantic DTO handler·run별 adapter를 등록했다. `semantic_review_tasks`는 신뢰된 요청의 재현 필요/opt-in으로 Simulation 선행 Task를 선택한다. Review의 model_cap=1과 Simulation의 독립 예산은 유지하며, 수정 요청·완전 검수·확정 지적일 때만 기존 TaskRunner의 1회 확장으로 editing Task를 등록한다. 이미 계획된 수정 후속은 중복 등록하지 않는다. 공개 Main 기본 계획·실 모델·Writing 구현은 변경하지 않았다. [계약·단위 결과](task15-handoff.md).

Registry는 Python 고정 매핑 `operation → handler, reads, input_schema, output_schema, allowed_successors, model_cap`. 모델이 임의 함수·URL·쿼리·파일 경로를 선택할 수 없다. `run_if`는 `always / has_confirmed_findings / simulation_required / draft_requested` 같은 enum이다. 코드 실행식은 허용하지 않는다.

```yaml
task_id: edit-1
agent_type: writing
operation: patch_dialogue
input_refs: [review-1.findings, context-1.source_span]
depends_on: [review-1, context-1]
run_if: has_confirmed_findings
output_schema: ChangeSet.v1
budget: {model_calls: 1, max_output_tokens: 1200}
retry_policy: {max_extra_attempts: 0}
timeout_ms: 30000
execution_status: pending
evidence_refs: []
result: null
```

검증기는 위상 정렬로 cycle·중복 ID·미등록 참조·출력 타입 불일치·의존 없는 결과 접근을 거부한다. 모든 대상은 동일 허용 scope의 고정 버전에 속해야 한다. 동일 문서의 겹치는 범위는 한 편집에 합치고, 순서에 따라 결과가 달라지면 대안을 사용자에게 돌려준다. 단순 순차화로 오래된 patch를 적용하지 않는다.

`MainState`에는 `thread_id/run_id, request_ref, messages(허용된 최근 참조), conversation_summary_ref, scope, security_decision_ref, classification, task_plan, task_results, evidence_refs, coverage, simulation_ref, generated_content_ref, change_set_ref, approval_ref, response_ref, execution_status, budget_usage, errors`를 둔다. task는 pending → running → succeeded/partial/failed/cancelled/skipped. `Send`는 필요한 읽기 전용 slice만 전달한다. reducer는 `(run_id,task_id,attempt)`로 중복 병합을 방지하고 고정된 task 순서로 결과를 조립한다. 병렬 작업끼리 messages를 덮어쓰지 않는다. `Command`는 검증된 다음 노드와 일부 상태만 갱신한다. [LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)

## 비용·실패 제어

2026-11-09 TASK 07: `runs/runner.py`에 ready Task 실행·동시 상한 2·조건/실패 skip·Send용 참조 slice·lease/attempt reducer·호출 전 예약과 사용량 미확인 보존·취소/deadline·1회 확장 제한을 구현했다. 선택적 SimulationReport의 조건 skip만 optional 참조로 허용한다. 실제 Agent·LangGraph·모델·Saver·승인은 연결하지 않았다. [계약·합성 검증](task07-handoff.md).

새 채팅 턴은 같은 thread에서 최근 대상 참조와 승인된 대화 요약만 복원한다. 이전 턴의 분류, 선택 에이전트, 시뮬레이션, 승인 및 비용 예약은 새 run의 초기값으로 재사용하지 않는다. 동일 run의 장애 복구에서는 반대로 이미 사용한 예산·완료 task를 유지한다.

초기 **실험값**은 run당 DAG 작업 12개, 동시 2개, dynamic 확장 1회, 전체 모델 시도 20회(분류·재시도 포함), 누적 입력 48k·출력 12k 토큰, 실행 시간 120초다. 승인 대기 시간은 실행 deadline에서 분리한다. 실제 모델 문맥 길이와 사용자 한도 중 작은 값을 쓴다. 다음 호출의 최대 출력을 먼저 예약한 뒤 실제 사용량으로 정산한다. 타임아웃·사용량 미보고는 0원으로 집계하지 않는다.

| 상황 | 처리 |
|---|---|
| 독립 검색·작업 | 필요한 경로만 병렬화. task 시작 전에 공통 예산 원자 예약. 다른 분기 결과·쓰기 권한에 접근 불가. |
| 일시적 장애 | 조회만 deadline 안에서 jitter를 둔 1회 재시도. 연속 장애 시 해당 제공사 회로를 열고 냉각 후 1개 probe. 모델 수신 여부 불명은 자동 재호출 금지. |
| 누락·모순 | 필수 근거 실패는 후속 쓰기 차단. 선택적 원문 예시만 누락되면 경고와 확보한 근거로 partial. 충돌은 출처와 버전을 함께 제시. |
| 취소·재시작 | 실행 lease와 attempt로 중복 스케줄 차단. 매 경계와 모델 호출 전 취소 검사. 진행 중 비용 기록, 늦게 온 결과 폐기. 적용 결과는 Content 영수증으로 대조. |
| 긴 문맥 | 회차 manifest는 전체 확인, 모델 입력은 관련 사건·가까운 회차·원문 구간 순으로 선택. 잘린 범위 표시. 권한·revision 키가 같은 run에서 공통 ContextPacket을 재사용. |

응답 합성은 기본 결정적 템플릿이다. Output Validator가 citation 대상·권한·시점·원문 일치·simulation 태그·생성 스키마를 확인한 결과만 내보낸다. 사용자에게 보일 근거가 부족한 판단은 `insufficient_evidence`로 표시한다. [기능별 흐름](03-rag-simulation-design.md) · [승인과 재개](04-infrastructure-integration.md)
