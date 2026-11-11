# TASK 15 — Semantic Review 인수 보고

> **2026-11-11 현행:** [TASK별 실제 구현·미구현 근거와 개발 방법](implementation-status.md)을 우선한다. 아래 내용은 당시 인수 기록이다.

2026-11-10 후속 보완: 공백 원문·기계 검사의 공백 설정 기준은 권한 거부 대신 `partial/unverified`로 반환한다.
Mechanical 3개·Semantic 2개 경계 회귀를 Red→Green으로 확인했고, 선행 보완 선택 단위는 433 passed, 21 deselected다.

2026-11-10. **Mock 내부 구현·선택 단위 수용 완료.** 실 모델·제품 흐름·외부 리뷰 완료를 뜻하지 않는다.

## 시작 상태·범위

| 항목 | 확인 결과 |
|---|---|
| 브랜치·시작 HEAD | `feat/56-readonly-agents` · `de02ff64fec04b5ecbd1f467411bed08c476920e` |
| 기준 참조 | 로컬 `develop=79855bf` 확인. checkout·재기반·브랜치 강제 변경 없음 |
| 시작 dirty | TASK 05~10 인수/계약 문서 7건 삭제. 복구·stage·커밋하지 않고 보존 |
| 수행 | Mock Semantic DTO/handler, 근거·판정 검증, 조건부 Simulation 소비·수정 Task 등록, 선택 단위·설계/기능표 보완 |
| 미수행 | TASK 16 이후, 실제 모델/Content/DB·색인·공개 Run 자동 조립·Writing 구현·원고 적용·UI·push·PR·배포·병합 |

첨부 `00_COMMON_RULES.md`와 TASK 15를 개발 기준으로 읽었다. 선행 [TASK 14 인수](task14-handoff.md)와 실제 코드·테스트를 확인했다.
TASK 14는 합성 내부 수용을 통과했으며 CodeRabbit 외부 전송은 승인 대기다. 이 요청을 외부 코드 전송 승인으로 해석하지 않았다.

## 변경 파일

| 파일·영역 | 변경·영향 |
|---|---|
| `backend/ai-service/app/agents/semantic_review.py` | 요청·모델 입력/판정 DTO, 의미 검수 함수, Simulation 보고 재검증, 고정 Task 구성, run별 adapter |
| `app/agents/review.py` | Finding에 의미 검사 종류·반대 근거·비확정 이유·판정 근거·Simulation refs 추가. Findings에 coverage·complete 추가. Mechanical 입력 checkTypes·검사 알고리즘 유지 |
| `app/runs/orchestrator.py` · `tests/test_task_graph.py` | `review` handler 연결·stub 기대값 갱신. 기존 schema·model_cap=1·허용 후속 유지 |
| `tests/test_semantic_review.py` | 신규 43개 단위: 시나리오 A·7개 의미 범주·근거 변조·지식 격리·Simulation·수정 등록·실패/부분 결과 |
| AI `AGENTS.md/README.md`, 설계 02·03·05·06, 기능표, 이 문서 | 실제 내부 계약·검증·제약과 제품 미연결 상태 기록. 제품 완료 체크는 승격하지 않음 |

## DTO·검수 계약

`SemanticReviewRequest`는 `query`, `target: ExactSource`, `check_types`, 선택 `mechanical_request`,
`reaction_required=False`, 선택 `simulation_input: SimulationInput`, 호출당 입력/출력 토큰 상한을 받는다.
검사 종류는 `knowledge/causality/emotion/world_rule/foreshadowing/dialogue_timing/character_behavior`다.
Mechanical 요청을 함께 제공하면 같은 target·scope여야 한다. Simulation도 같은 Content Scope여야 하며 재현 필요는 행동·감정·인과 검사에서만 허용한다.

`await semantic_review(request, content=..., coordinator=..., model=..., simulation_reports=())`는 기존 `Findings`를 반환한다.
모델 seam은 `await model.review(SemanticModelInput) -> SemanticAssessment`다. production 구현체·유료 호출은 추가하지 않았다.
고정 지시와 원문 자료를 별도 필드에 둔다. 모델은 검사 목록과 `SemanticCandidate`의 종류·대상 ExactSource·근거/반대 근거 ref·판정 근거 종류·Simulation ref만 반환한다.
임의 confirmed·실행 명령·수정문·새 자유문 설명은 schema에서 거절한다. 설명은 검증된 원문 인용과 고정 문구로 구성한다.

모델 판정 근거는 `source_interpretation/hypothetical/creative_judgment/insufficient_evidence`이며 모두 suspected다.
정본+원문으로 같은 회차의 수치 차이가 입증된 기존 Mechanical 결과만 confirmed 후보로 재사용한다.
의도적 변경이나 반대 근거가 그 확정 지적의 span과 겹치면 수치 차이는 남기되 오류 판정을 suspected로 낮춘다.
지식 습득 경로가 없다는 사실만으로 “그 인물은 몰랐다”를 확정하지 않는다. 일반 의미 충돌의 결정적 확정 규칙은 구현하지 않았다.

Findings의 각 지적에는 위치·판본·UTF-16 span·선택 원문 SHA-256, evidence_refs, counter_evidence_refs,
non_confirmation_reason, confidence_basis, simulation_refs가 들어간다. 모델의 알 수 없는 ref·대상 밖 span·구판·위조 hash·검사 종류·가상 ref는 거절한다.
원문의 사실·정본 비교·해석·가상 반응은 구분한다. `complete=true`는 요청 검사 완료를 뜻하며 “문제가 확정됐다”는 뜻이 아니다.

전체 Wiki coverage·critical gap·선택 근거·인과 참조가 충족되어야 모델 검수를 시작한다.
검수 대상 회차와 Content Scope의 basis가 다르면 unsupported로 닫는다. 과거 장면은 Content에서 해당 회차로 승인한 Scope를 받아야 한다.
이는 미래 자료를 과거 인물의 지식으로 사용하지 않기 위한 현재 단일 대상 검수의 제한이며, 다중 대상/회차별 Scope 자동 분할은 구현하지 않았다.
부족한 검색·불완전 검사 목록·미확인 모델 출력·모델 미연결/장애는 partial, 기한 초과는 timeout이다.
권한·판본·knownBy 변경과 중복 Content 판본은 denied로 닫고 본문·출처를 제거한다. 빈 지적만으로 완전 검수를 표시하지 않는다.

## 조건부 Simulation·실행기

재현 필요는 신뢰된 합성 호출자가 `reaction_required`로 명시한다. `simulation_input` 제공을 opt-in으로 사용하며 둘이 함께 있어야 Simulation을 등록한다.
기본 의미 검수는 Simulation 0회다. 필요하지만 opt-in·호출 예산이 없으면 완전 검수를 보류한다. 자동 필요성 분류기는 추가하지 않았다.

TaskRunner는 다음 형태로 구성한다. `context_task`는 기존 고정 context Task이며 packet·모델은 합성 대역이다.

```python
tasks = (context_task, *semantic_review_tasks(request, context_task=context_task))
simulation_handler = SimulationHandler(request.simulation_input, content=content,
    packet=packet, model=actor_model)  # 재현 필요·opt-in이 있는 요청에서만 주입
review_handler = SemanticReviewHandler(request, content=content, coordinator=coordinator,
    model=semantic_model, simulation_handler=simulation_handler)
handlers = {"context": context_handler, "simulation": simulation_handler, "review": review_handler}
```

`semantic_review_tasks`는 필요할 때만 `context → semantic-simulation → semantic-review`를 만들고, 기본은 `context → semantic-review`다.
Simulation은 TASK 14의 실제 typed `SimulationHandler`로 실행한다. Review 안에서 Simulation 모델을 중첩 호출하지 않아 Registry의 model_cap=1을 유지한다.
두 Task는 각각 기존 CallContext로 호출을 예약하며 전체 계획·호출·토큰·시간 한도는 기존 Python validator가 검증한다.
필수 Simulation의 partial/실패는 의존 검수를 실행하지 못하게 한다. 사용하지 않는 Simulation 입력만 제공한 경우 Actor 호출은 0회다.

보고를 소비할 때 source revision/span/hash와 `hypothetical/is_mock`, 시나리오·턴·시도 수를 확인한다.
TASK 14의 Scenario Builder·Reducer로 행동을 다시 검증해 actor·지식·수신자·위치·자원·반복 제약을 재사용한다.
의미 모델에는 검증된 행동과 가상 표시만 투영하며 보고의 임의 자유문·비공개 상태를 전달하지 않는다. Simulation만으로 confirmed를 만들 수 없다.

`SemanticReviewHandler`는 result를 메모리의 `handler.findings`에 두고 실행기에는 `findings:{run_id}:{task_id}`·상태·확정 여부만 전달한다.
`wants_change`·완전 검수·확정 지적·허용 editing capability가 모두 있어야 TaskRunner의 기존 1회 확장으로 `semantic-editing`을 등록한다.
target의 version/span을 patches로 고정하고 `run_if=has_confirmed_findings`를 적용한다. 이미 계획된 해당 수정 후속은 중복 등록하지 않는다.
문제 없음·해석/가상만 있음·반대 근거/의도적 변경·근거 부족·수정 요청 없음이면 새로운 수정 Task와 호출은 0회다.
`editing`은 기존 Writing 계열의 ChangeSet 제안 작업명이다. 실제 Writing 구현·저장·승인·공개 Main 기본 계획은 추가/변경하지 않았다.

## 설계·이슈

필수 원문은 실제 `docs/writing-ai-architecture/`의 [02 작업 명세·예산·조건부 후속](02-ai-architecture.md),
[03 §8 Review·§11 Simulation](03-rag-simulation-design.md#8-review), [05 시나리오 A·F·실패 수용](05-implementation-roadmap.md)에서 확인했다.
프로젝트 설계·DEC-28·36·37·41, [서비스 경계](../design/service-boundaries.md), 유스케이스·AI 서비스 지침도 확인했다.

2026-11-10 GitHub 재조회: [#59](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/59)는 open·kyo-135,
[#58](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/58)은 open·Seongho-haru/kyo-135 공동 담당이다.
두 이슈에 해당하는 합성 내부 구성요소만 구현했다. 이슈 생성·수정·댓글·자동 종료는 하지 않았다.

## 검증

AI 서비스 디렉터리에서 다음 선택 단위 명령을 실제 실행했다.

```powershell
uv run --offline --locked --extra dev python -m pytest -m 'not integration' tests/test_semantic_review.py tests/test_simulation.py tests/test_story_context.py tests/test_mechanical_review.py tests/test_template_recommendation.py tests/test_task_graph.py tests/test_task_runner.py tests/test_main_graph.py tests/test_retrieval_coordinator.py tests/test_mock_retrievers.py tests/test_retrieval_contract.py tests/test_canonical_read.py --tb=short
```

결과: **411 passed, 21 deselected in 9.29s**. Semantic 신규 43개를 포함하며, integration 표시 21개는 실행하지 않았다.
기존 uv 캐시 접근 제한 때문에 승인된 명령 단위 호스트 실행을 사용했다. offline/locked 환경·합성 Content·AsyncMock만 사용했고 실제 모델/DB는 호출하지 않았다.

| Red → Green | 확인 결과 |
|---|---|
| Semantic 모듈 부재 | 7개 의미 범주·3화 카이/리나 지식 충돌을 근거·비확정 이유로 반환 |
| 위조 보고에 유효한 원문 ref로 미지 지식 주입 | 기존 Simulation reducer 재검증으로 Actor 미지 지식 거절, 의미 모델 0회 |
| 과거 대상에 미래 basis 사용 | unsupported·모델 0회·본문/출처 없음 |
| 의도적 변경/반대 근거가 있어도 수치 오류 자동 수정 | 겹친 확정을 보류하고 수정 등록·호출 0회 |
| 중복 Content 판본·일반 모델 RuntimeError | denied/partial로 명시 반환, 미처리 비공개 예외 없음 |

시나리오 A는 문제 없음·지식 충돌 의심·입증된 수치 불일치와 수정 요청 유무를 대조한다.
추가 단위로 대상/hash/ref/반대 근거 변조, 인물·미래·타 Fork·비공개 격리, 원고 내 지시문, coverage·검사 목록 부족,
모델/검색 실패·timeout·권한 철회, typed Simulation·가상 판정, 근거 부족 상태의 수정 차단을 확인했다.
수정 실행 증거는 메모리 TaskRunner의 fixture handler 호출 횟수이며 실제 원고 변경 증거가 아니다.

`ponytail-review` 로컬 점검에서 중복 import·중복 예외 항목을 제거하고 별도 행동 검증기를 만드는 대신 기존 reducer를 재사용했다.
`git diff --check`와 신규 인수 문서/설계의 로컬 파일 링크를 검사한다. 시작부터 삭제된 TASK 05~10 문서 링크는 사용자 상태로 보존한다.
CodeRabbit 외부 전송은 앞선 TASK 14의 자동 승인 검토 거절 후 사용자가 승인하지 않아 이번에는 시도하지 않았다. 외부 리뷰 완료/지적 0건으로 표시하지 않는다.

## 영향·남은 결정

Mock 근거는 `is_mock=true`, Simulation은 `hypothetical=true`로 유지한다. 실제 원고·DB·Neo4j·권한·발행·정산·승인은 변경하지 않았다.
production 의존성·lockfile·`.env`·기존 공개 API·역할별 서버는 추가/변경하지 않았다. checkpoint에는 refs·상태만 전달한다.
실제 의미 탐지율·자유문 해석 품질·누출률·비용·부하는 미평가다. 원문 재검증과 보고 재생의 실제 지연도 측정하지 않았다.

| 남은 항목 | 추천 | 대안·조건 |
|---|---|---|
| 실제 의미 모델·필요성 분류 | 현재 Mock 정형 판정·명시 재현 필요 입력 유지 | 허용 corpus·모델 동의·비용 계약·한국어/누출 평가 후 별도 연결 |
| 의미 충돌의 confirmed 확대 | 현재 기계 수치 입증만 확정 후보로 유지 | 정본 필드·시점·의도적 변경의 결정적 비교 계약을 먼저 합의 |
| 실제 제품 조립·외부 리뷰 | 공개 Run/Writing/저장은 후속 요청, CodeRabbit은 전송 승인 후 실행 | 현재 내부 DTO·단위 증거만 인수 자료로 사용 |

## 커밋·종료

로컬 커밋 메시지: `feat: 근거와 가상 반응을 구분하는 의미 검수 구현`(Refs #59, #58). 이번 파일만 명시 stage하며 기존 삭제 7건은 제외한다.
정확한 해시는 최종 채팅·로컬 git log에서 확인한다. push·PR 생성/변경·병합·배포는 하지 않는다.
TASK 15의 합성 내부 수용은 통과했다. TASK 16은 새 요청·해당 md가 있어야 착수하며 자동 진행하지 않는다.
미실행: 통합·시스템·브라우저·전체 테스트·빌드·실 모델/DB·hosted CI·배포·병합·CodeRabbit 외부 리뷰.
