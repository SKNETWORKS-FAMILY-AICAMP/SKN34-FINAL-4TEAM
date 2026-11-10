# TASK 14 — Character Simulation Subgraph 인수 보고

2026-11-10. **합성 자료 기반 내부 구현·선택 단위 검증 완료, 외부 리뷰 대기.** 실제 모델/Content 연결과 제품 흐름 완료를 뜻하지 않는다.

## 시작 상태와 범위

| 항목 | 확인 결과 |
|---|---|
| 작업 브랜치·시작 HEAD | `feat/56-readonly-agents` · `43aa1db6a368856c32700b9821f8e1f96926e419` |
| 로컬 develop 참조 | `79855bf` 확인. checkout·강제 변경·재기반은 하지 않음 |
| 시작 dirty | TASK 05~10 인수/계약 문서 7건 삭제만 존재. 복구·stage·커밋하지 않고 그대로 보존 |
| 수행 | TASK 14 내부 Simulation, 선행 공백 인용 예외 수정, TASK 11~13 누락 인수 문서 보완, validation EOF 빈 줄 정리 |
| 미수행 | TASK 15 이후, 실제 모델·DB·색인·원고 전송·적용·공개 Run 자동 조립·UI·push·PR 생성/변경·배포·병합 |

첨부 공통 규칙과 TASK 14를 이번 요청의 개발 기준으로 적용했다. 필수 02·03·05·07 원문은 실제 저장소의 `docs/writing-ai-architecture/`에서 확인했다.

## 파일과 호출 계약

| 파일·영역 | 핵심 변경 |
|---|---|
| `backend/ai-service/app/agents/simulation.py` | DTO, Scenario Builder, Scheduler, Actor Projection, CharacterAgentPort, Validator, 임시 World Reducer, 결정적 Analyzer, run별 SimulationHandler |
| `app/runs/orchestrator.py` · `tests/test_task_graph.py` | simulation 고정 handler 등록과 stub 기대값 갱신. 기존 model_cap=14·호출자/후속 schema 유지 |
| `tests/test_simulation.py` | 합성 시나리오·무효/유효 대조쌍·시도 상한·시점/권한/인물 지식·중단·실행기 단위 54개 |
| `app/agents/story_context.py` · `tests/test_story_context.py` · `app/retrieval/validation.py` | 공백 정확 조회를 insufficient_evidence로 반환하는 2개 회귀, 해석의 공백 Claim 제외, EOF 빈 줄 1개 제거 |
| AI `AGENTS.md/README.md`, 설계 02·03·05·06, 기능표, `task11/12/13/14-handoff.md` | 내부 구현과 제품 미연결 상태, DTO·검증·한계 기록. 11~13은 과거 원문의 복원이 아닌 현재 코드 기반 문서 |

`SimulationInput`은 query/snapshot_ref, characters, active_ids, 1~2 scenarios, 선택 goal, constraints, turn_limit·남은 호출 수·호출별 timeout/토큰 상한을 받는다.
characters는 최대 두 명이고 active_ids 생략 시 전달한 인물이 순서대로 활성화된다. 기본 turn_limit은 3이다.
초기 위치·자원·이동 비용·금지 행동은 신뢰된 합성 호출자가 제공하는 **가상 조건**이다. 연결되지 않은 Content 정형 상태 추출이나 실제 세계 규칙 검증을 흉내 내지 않는다.
프로필·가치/동기·목표·감정·말투는 별도 자유문 대신 해당 인물에게 허용된 근거 refs로 전달한다. 초기 믿음·관찰은 외부 입력에서 주입할 수 없다.

호출은 `await simulation(request, content=mock_content, packet=verified_packet, model=character_port)`이다.
`CharacterAgentPort.act(ActorProjection)`는 `CharacterReply(action, input_tokens, output_tokens)`를 반환한다. 실제 OpenAI 어댑터는 만들지 않았다.
반환은 시나리오 순서의 `tuple[SimulationReport, ...]`이며, 비교 시에도 하나의 고정 `SimulationReport.v1` 작업 결과 참조를 사용한다.

`SimulationHandler(request, content=..., packet=..., model=...)`를 TaskRunner의 `handlers['simulation']`에 run별 명시 주입한다.
보고 본문은 `handler.reports` 메모리에만 보관하고 실행기에는 `simulation:{run_id}:{task_id}`·상태·mock 태그만 전달한다.
기존 Main 기본 계획은 Simulation 예산 1회를 그대로 유지한다. 이 내부 adapter로 기본 3턴을 검증한 테스트는 신뢰된 계획에서 6회·호출당 토큰 한도를 명시했다.
공개 Run의 허용 payload·동의·과금·예산 정책은 이번 작업에서 확정하거나 자동 연결하지 않았다.

## 실행·지식·근거 경계

`schedule → project → act → validate → reduce`를 LangGraph 1.2.12로 순차 실행한다. 무효 행동은 같은 배우·턴에서 한 번만 재생성한다.
시나리오별 상태는 독립이고 모델 시도 합계는 공유한다. 기본 6회, 기본 비교 12회, 절대 14회와 요청의 남은 호출 수 중 작은 값으로 제한한다.
TaskRunner 경유 시 호출 전 예약이 작업·run의 남은 호출/토큰 한도를 추가 검증한다. timeout·usage 미보고는 예약을 남기고 `usage_unknown=true`로 반환한다.

Action은 `actor_id/turn/kind/target_ids/text/used_fact_ids/disclosed_fact_ids`만 받는다. kind는 speak/move/observe/wait, 중복 ID와 추가 필드는 거절한다.
한 배우의 선택된 근거만 투영하며 knownBy는 Evidence의 주장 대신 Content 행에서 확인한다. 상대의 내면·비밀, 미래·다른 Fork, query 자유문, 검색 fact_or_relation 등 지시성 metadata는 전달하지 않는다.
Content의 행·권한·판본이 대기 중 바뀌면 결과를 닫는다. 비교 두 번째 실행에서 철회되어도 앞선 시나리오의 본문·인용까지 모두 제거한다.

허용 지식 ID·disclosure 부분집합, 실제 도달 가능한 상대, 위치 이동·자원·금지 행동과 반복을 결정적으로 검사한다.
발화는 disclosure ID 순서의 허용 근거 원문을 공백으로 연결한 문자열만 통과한다. 비공개 사실을 error 메시지에 넣지 않고 코드만 재시도 입력으로 전달한다.
이는 일반 자연어/의역의 누출을 검증하는 평가기가 아니다. 기존 source span을 조합하는 제한 구현이며 자유 생성 품질은 미검증이다.

Reducer는 `(scenario_id, turn)`을 한 번만 적용한다. 같은 장소의 명시 수신자에게만 발화 관찰과 믿음을 추가한다.
다른 인물에게 들은 내용은 speaker·learned_at을 가진 `claim`으로 보존하며 세계의 정본 사실로 승격하지 않는다.
Analyzer는 위치·자원·신규 믿음 차이와 발화→후속 지식 사용 인과를 모델 0회로 요약한다.

각 보고에는 `hypothetical=true`, `is_mock=true`, source ID·revision·UTF-16 span·SHA-256, 수용한 턴, 전후 결과·인과·안전한 검증 사유·한계·stop_reason·마지막 성공 턴·usage·partial_result를 담는다.
turn_limit·goal_reached·repeated_wait·characters_exhausted는 정상 유한 종료다. timeout·취소·한도 소진·검증 실패·근거 부족·의존성/모델 장애는 partial이다.
거절·미확인 모델 장애 뒤 비교를 추가 호출하지 않는다. 늦은 결과는 버린다. subgraph는 `compile(checkpointer=False)`로 부모 Saver도 상속하지 않는다.

## 설계와 이슈

[02 작업 명세·예산·실패 제어](02-ai-architecture.md), [03 §11](03-rag-simulation-design.md#11-simulation-실행과-행동-검증),
[05 구현 순서·A/B/G·실패 수용](05-implementation-roadmap.md), [07 근거·Fixture 계약](07-retrieval-contract-and-mocks.md),
[06 결정 9·10·15](06-design-decisions.md), 프로젝트 DEC-28·36·37·41과 [서비스 경계](../design/service-boundaries.md)를 확인했다.

[#58](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/58)은 open이며 사용자 안내 뒤 재조회해 Seongho-haru와 **kyo-135 공동 담당**을 확인했다.
[#59](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/59)도 open·kyo-135 담당이다. 두 이슈에 해당하는 내부 구성요소만 구현했고 이슈 편집·댓글·자동 종료는 하지 않았다.

## 검증

AI 서비스 디렉터리에서 최종 실행한 **선택 단위** 명령이다.

```powershell
uv run --offline --locked --extra dev python -m pytest -m 'not integration' tests/test_simulation.py tests/test_story_context.py tests/test_mechanical_review.py tests/test_template_recommendation.py tests/test_task_graph.py tests/test_task_runner.py tests/test_main_graph.py tests/test_retrieval_coordinator.py tests/test_mock_retrievers.py tests/test_retrieval_contract.py tests/test_canonical_read.py --tb=short
```

결과: **368 passed, 21 deselected in 7.98s**. Simulation 신규 54개·공백 인용 회귀 2개를 포함한다. 21개는 integration 표시 때문에 실행하지 않았다.
uv sandbox 캐시 접근은 실패했고, 승인된 명령 단위 호스트 실행으로 offline/locked 환경의 Python 3.11·LangGraph 1.2.12를 사용했다.

| Red → Green 증거 | 결과 |
|---|---|
| 공백 quote/attribute → Claim ValidationError | 명시적인 insufficient_evidence·gap, 본문·주장 없음 |
| Simulation 모듈 부재 | 3턴 순차 실행·인물 비밀 0노출·가상 보고·정본 불변 |
| 미선택 근거 투영·불명 모델 장애 후 비교 호출 | 선택 근거만 전달·불명 장애 뒤 추가 호출 0회 |
| 불필요한 근거 ID로 반복 우회 | actor/kind/대상/text 기준 반복 차단; 6/12/14회 한도 유지 |
| 비교 중 철회·잘못된 packet span | 모든 비교 본문·인용 폐기·안전한 denied, 미처리 ValidationError 없음 |

다른 대조쌍은 허용/금지 사실·듣지 못한 발화·claim/정본 구분·이동/자원/금지 규칙·중복 reducer·목표·turn limit·대기 반복·취소·timeout·늦은 출력·Run 예약/참조 전용 출력을 확인한다.
`git diff --check`와 변경 문서의 TASK 11~14 로컬 파일 링크를 검사한다. 기존 TASK 05~10 문서의 삭제/끊어진 링크는 사용자 상태로 보존한다.

`ponytail-review` 로컬 점검으로 별도 stop wrapper와 미사용 import를 제거했다. 새 의존성·추상 실행 프레임워크·인물별 서버는 추가하지 않았다.
CodeRabbit Inc.의 유효한 서명·authenticated=true를 확인했지만 외부 코드 전송은 **자동 승인 검토에서 거절**되어 실제 분석은 시작하지 않았다.
거절 이유는 이번 미커밋·신규 AI 소스를 CodeRabbit으로 보내는 payload/목적지의 명시적 사용자 승인 부재다. 외부 리뷰 지적 0건/완료로 간주하지 않는다.

## 영향·남은 결정

실제 유료 모델·DB/Neo4j/DDL·색인·원고 쓰기·정산·승인·배포는 0건이다. production 의존성·lockfile·`.env`·기존 공개 API는 바꾸지 않았다.
Mock 상태와 가상 기억은 실제 Content에 적용할 수 없다. 반복적인 Content 재검증 비용과 모델/검색 품질·실 부하는 측정하지 않았다.

| 남은 항목 | 추천 | 대안·결정 시점 |
|---|---|---|
| 자유 발화 | 원문 조합 제한 유지 | 별도 허용 corpus·누출 평가와 실 모델 동의/비용 계약을 확인한 뒤 의역 지원 |
| 실제 Content·Run | 현재 명시 mock 주입 유지 | 인물 ID·정형 상태·허용 전송·모델 동의·과금 계약 확정 후 별도 연결 |
| CodeRabbit | AI 서비스 변경 9개 파일(소스/테스트 7개·README/AGENTS 2개)을 범위로 CodeRabbit 전송을 사용자에게 승인받은 뒤 실행 | 현재 로컬 리뷰·단위 결과만 검토 자료로 사용. 외부 리뷰 완료 주장은 보류 |

## 로컬 커밋과 종료

범위별 로컬 커밋 메시지는 `fix: 공백 인용 응답과 누락 인수 문서 보완`, `feat: 인물 지식을 격리한 가상 시뮬레이션 구현`이다.
커밋에는 이번 변경만 명시 stage하고 기존 문서 삭제 7건은 제외한다. 외부 push·PR 생성/변경·병합·배포는 하지 않는다.
정확한 커밋 해시는 최종 채팅과 로컬 git log에서 확인할 수 있다.

TASK 14 합성 내부 수용 기준은 통과했으며 외부 리뷰는 승인 대기다. TASK 15는 새 요청·해당 md를 받아야 착수하며 자동 진행하지 않는다.
실 모델/DB·통합·브라우저·전체 테스트·빌드·hosted CI·운영 품질 검증은 미실행이다.
