# TASK 19 — 다음 화 초안·콘티 복합 DAG

> **2026-11-11 현행:** 실제 연결 여부와 남은 선행 조건은 최신 표를 따른다. [실연동 인수보고](live-rag-handoff.md) 참조. 아래 TASK별 결과는 당시 기록이다.

2026-11-10. **합성 Content·모델 대역의 내부 수용 완료**다. 실제 모델의 창작 품질이나 제품의 공개 Run·원고 저장 연결 완료를 뜻하지 않는다. TASK 20 이후는 시작하지 않았다.

## 시작 상태·범위·근거

시작 브랜치는 `feat/62-writing-editing`, 기준 커밋은 `7804d243b31192f147e7a6437c9025ec4a2584e5`다.
시작 시 작업 트리는 clean이었다. TASK 18의 로컬 커밋과 인수보고를 확인하고
`feat/61-next-draft-conti`를 생성했다. 로컬 develop 참조는 `79855bfc6ac180dbd87109f340b0471e78c30e3e`다.
develop으로 강제 변경하거나 fetch/rebase하지 않았다. TASK 18까지의 구현 위에서 이번 범위만 추가했다.

사용자가 지정한 Downloads의 `00_COMMON_RULES.md`와 `20_TASK_19_next_draft_conti.md`,
[TASK 18 인수](task18-handoff.md), 실제 저장소의 [02](02-ai-architecture.md)의 Registry·DAG·예산,
[03 §6·9·10·11](03-rag-simulation-design.md)의 Coverage·Writing·다음 회차·Simulation,
[05 B·콘티 회귀·실패 수용](05-implementation-roadmap.md)을 확인했다.
루트/AI AGENTS, 프로젝트 설계·DEC-36·37·41·서비스 경계·유스케이스·로컬 단위 검증 규칙을 적용했다.
TASK 문서의 가능한 통합 검증은 저장소의 로컬 단위 제한에 따라 이번 로컬 실행에서 제외했다.

2026-11-10 GitHub 연결 도구로 확인한 [#61](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/61)은
콘티 구체화·다중 문서 변경 후보, [#62](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/62)는
문체·말투·문장 생성이며 둘 다 **open / kyo-135**다. TASK 19에서는 두 이슈의 초안·콘티 체인만 다룬다.
#61의 다중 정본 일괄 변경·승인 연결 전체를 완료했다고 표시하지 않는다. 이슈 변경·댓글·자동 종료는 없다.

## 변경 파일·실행 계약

| 파일 | 변경 |
|---|---|
| `backend/ai-service/app/agents/next_draft.py` | NextDraftRequest, ContinuityResult, next_draft_tasks, run별 NextDraftHandler |
| `backend/ai-service/app/agents/development.py` | 이미 검증한 packet 재사용과 현재 관계의 작가 문맥 전달 |
| `backend/ai-service/app/agents/writing.py` | typed beats·Simulation·현재 관계·필수 문구 입력, 기존 단일/편집 경로 호환 |
| `backend/ai-service/app/runs/routing.py` | next_draft·expand_conti의 Context→Development→Writing→Mechanical 등록 |
| `backend/ai-service/tests/test_next_draft.py` | 신규 합성 단위 29개 |
| `backend/ai-service/AGENTS.md` | 새 체인의 책임·입력·한계 기록 |
| `docs/writing-ai-architecture/02-ai-architecture.md` | DAG·명시 주입 상태 동기화 |
| `docs/writing-ai-architecture/03-rag-simulation-design.md` | 문맥 축소·연속성 규칙·품질 한계 기록 |
| `docs/writing-ai-architecture/05-implementation-roadmap.md` | B·콘티 수용의 실제 범위 기록 |
| `docs/feature-roadmap.md` | 내부 수용 상태 추가, 제품 완료 표시는 기존 ❌ 유지 |
| 이 인수보고 | 시작 상태·검증·남은 작업 기록 |

`NextDraftRequest`는 동일 Query를 가진 DevelopmentRequest와 draft WritingRequest,
`draft_requested`, `current_relationships_required`를 받는다. 전개 모드는 next_episode_planning 또는 expand_conti다.
원문 편집은 이 체인의 범위가 아니다. 콘티 전용과 저장 요청이 함께 들어오면 계약 오류다.

`next_draft_tasks(request, context_task=root)`는 기존 development_tasks/writing_tasks를 재사용한다.
Context→필요·opt-in 시 Simulation→Development BeatPlan→Writing→Mechanical 연속성 검사 순서다.
Simulation은 별도 Task/예산이며 필요하지만 입력·예산이 없으면 생성 전 중단한다.
`draft_requested=false`는 BeatPlan에서 종료하며 Writing·GeneratedText·연속성 Task를 만들지 않는다.

TaskRunner에는 같은 run별 handler를 context/simulation/development/writing/mechanical에 명시 주입한다.
MainGraph를 조립할 때는 기존 Main이 context를 소유하므로 전문 작업에만 handler를 주입하고,
`plan_factory`에서 root와 next_draft_tasks를 반환한다. 첫 전문 작업이 동일 준비 검증을 수행한다.
Simulation을 포함하는 Main 요청은 허용 작업에도 simulate가 있어야 한다.
공개 Run의 실제 모델/원문 자동 조립은 구현하지 않았다. 기존 Main 자체의 통합 실행은 이번 로컬 검증 범위가 아니다.

본문·BeatPlan·Simulation은 handler 메모리에 두고 TaskOutput/체크포인트에는 참조와 실제 상태만 전달한다.
run 재사용·임의 Task 참조/예산/작업 혼합은 거부한다. Simulation의 timeout은 deadline까지 남은 시간으로
생성되므로 재조립 시각에 따라 달라지는 timeout 값만 비교에서 제외하며 실제 deadline/TaskRunner 제한은 유지한다.

## 문맥·연속성·무저장 경계

Coverage는 1~N화의 존재·판본·원문 검증을 확인하며, manifest 자체의 순번 구멍이나 요청 구간 축소도
완전한 다음 화 생성으로 처리하지 않는다. 모델에는 직전 회차와 요청한 복선·콘티·플롯·인물 근거,
명시된 추가 정확 문맥·Simulation 원문 및 출처 의존만 전달한다. 호출자의 context_refs를 조용히 버리지 않고
검증된 검색 근거와 연결하거나 생성 전에 차단한다. 전체 회차 검증과 모델 입력의 작은 범위를 구분한다.

현재 관계는 기존 MockRelationshipGraphRetriever/Coordinator로 조회하고 CAS/현재 자료를 단계 전후 재조회한다.
Development/Writing의 작가 문맥에만 제공하며 과거 관계·인물의 습득 사실로 승격하지 않는다.
Simulation의 인물 입력은 기존 Content knownBy 투영을 유지하며 관계에 임의 knownBy를 만들지 않는다.
관계 변경·철회·회차 원문/판본 변경·deadline·Simulation 실패는 의존 작업을 차단한다.

BeatPlan의 refs는 정확 source version/span/hash로 재조회할 WritingSource ID로 변환한다.
지정 화자가 계획 문맥을 모르면 Writing 전에 중단한다. 말투 예문은 기존 같은 작품·허용 판본·knownBy 검사를 따른다.
공통 Writing 모델 계약의 추가 필드 금지·사용량·권한·판본·UTF-16 검사와 원고 길이 제한도 유지한다.

연속성 검사는 모델 0회다. 장면 goal/action/dialogue/cause와 명시된 복선·인물 근거 및 말투 예문의 원문 문구를
`required_phrases`로 Writing에 주고 실제 반환 본문에서 모두 포함됐는지 검사한다.
필수 문구는 허용 출처나 검증된 Beat에서 나온 것만 Writing 입력으로 허용한다.
단순 used_refs 선언만으로 통과하지 않으며 누락·의역은 보수적으로 차단한다.
검사 방법은 `literal_plan_and_source_checks`, `semantic_quality_verified=false`, `is_mock=true`로 명시한다.
문구 포함은 자유문 전체의 의미적 연속성·인물 지식 누설 없음·문학적 말투 품질을 증명하지 않는다.
지정 화자가 없는 요청은 기존 owner/narrator 문맥이며 자동으로 대사 화자를 판별하지 않는다.

Writing 성공분은 검사 전 내부 후보에만 두며 handler의 성공 result는 연속성 통과 후 공개한다.
실패 시 generated_text와 document_create_proposal이 없는 blocked 결과 또는 미완료 상태만 반환한다.
명시 저장 요청은 합성 Content 호출자가 준 CreateTarget에 대한 Mock 문서 생성 제안까지만 반환한다.
실제 Content 예약/prepare/승인/apply·DB 쓰기·발행·현재 관계 갱신은 **0건**이다.
TASK 22의 승인/실 transport와 연결하지 않았으며 Mock 후보를 real로 바꾸지 않는다.

## TDD·실행 증거·리뷰

모듈 부재 collection Red 후 구현했다. 추가로 호출자의 context_refs가 덮어써지는 실패를 assertion Red로 잡아
검증 후 문맥에 포함/거부하도록 수정했다. Main 소유 context의 전문 handler 주입과 required_phrases 모델 입력도
각각 assertion Red→Green을 확인했다. 시나리오 B fixture의 세 번째 중복 행동은 기존 Simulation 검증 규칙에 맞춰
별도 관찰 행동으로 수정했다. Simulation Task의 시간 의존 timeout 비교도 원인을 확인해 수정했다.

AI 서비스 디렉터리에서 최종 실행한 선택 단위 명령:

```powershell
uv run --offline --locked --extra dev python -m pytest -m 'not integration' tests/test_next_draft.py tests/test_writing.py tests/test_development.py tests/test_semantic_review.py tests/test_simulation.py tests/test_task_graph.py tests/test_task_runner.py tests/test_routing.py tests/test_generation.py --tb=short
```

최종 결과는 **311 passed, 1 deselected**다. TASK 19 신규 29개를 포함한다.
uv sandbox 캐시 쓰기 권한 오류로 최초 실행은 테스트 수집 전 중단됐고, 명령 단위 host 실행에서 offline/locked를 유지했다.
통합 marker 1개는 로컬 규칙에 따라 제외했다. 전체 suite·Main LangGraph/HTTP 통합·시스템·브라우저·빌드·hosted CI는 미실행이다.

B는 1~10화 Coverage 10/10, 현재 관계 revision 7, 두 인물 세 행동, Development 1회·Writing 1회로
대역 모델 총 **5회**를 확인했다. 생성 제안 대상은 11화이며 hypothetical/is_mock다. 입력 원문은 보존됐다.
콘티 전용 종료/콘티→원고, 근거 부족·Simulation 미동의/예산 0/실패·provider 장애·stale 원문·현재 관계 CAS 변경,
목표/행동/대사/원인/복선/말투/지식 근거 문구의 실제 본문 누락, manifest 구멍·구간 축소·잘못된 Beat refs·화자 경계를 검사했다.
기존 Writing 편집·Development·Simulation·TaskRunner·Router·단일 이어쓰기 대역 회귀도 포함했다.

로컬 diff 검토와 ponytail-review로 기존 Coordinator·SimulationHandler·development/writing 함수·TaskRunner를
재사용하는지 점검했다. 새 provider·capability·production 의존성·lockfile·API를 만들지 않았다.
CodeRabbit CLI의 경로는 확인했으나 이번 변경의 외부 전송 승인이 없어 외부 리뷰는 실행하지 않았다.
과거 TASK 18의 외부 전송 승인을 이번 새 변경에 확대 해석하지 않았다. 미실행을 지적 0건으로 기록하지 않는다.
graphify query는 새 Agent 탐색에 필요한 최신 연결을 제공하지 않아 실제 코드·호출자·테스트로 교차 확인했다.

## 영향·남은 결정·커밋·다음 단계

실제 유료 API·사용자 원고 전송·운영 DB/DDL·외부 계정 변경·추가 비용은 없다.
현재 관계의 재검증 조회는 모델 호출과 별개이며 합성 대역에서만 실행했다. 실 검색/모델 latency·비용·한국어 생성 품질은 측정하지 않았다.
실제 `.env`·키·새 의존성·기존 단일 이어쓰기 HTTP 계약을 변경하지 않았다. 기능표 제품 완료 체크는 그대로다.

추천은 현재의 Mock/read-only 내부 체인을 유지하는 것이다. 실제 창작 품질을 평가하려면 사용권·동의가 확인된 corpus,
허용 모델 payload/비용과 의미 평가 기준을 별도 확정해야 한다. 문구 보존 방식은 의역도 거부하는 제한이 있다.
대안인 의미 Review 추가는 별도 모델 예산과 평가 계약이 필요하며 이번 단계에서 임의 활성화하지 않았다.
실제 저장은 후속 Content prepare/승인/apply 연결·현재 권한/판본/Mock 정책 확인 전까지 금지다.

로컬 커밋 메시지: `feat: 다음 화와 콘티 복합 생성 체인 연결` (Refs #61, #62).
push·PR 생성/변경·병합·배포는 미실행이다. 후속 TASK는 새 사용자 요청에서만 시작한다.
다음 단계의 Mock 내부 작업은 이번 단위 수용을 근거로 착수 가능하지만, 실제 모델/저장/운영 수용의 완료 근거로 사용할 수 없다.
