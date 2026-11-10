# TASK 16 — 전개 인사이트·BeatPlan 인수

2026-11-10 후속 보완: 반응 재현이 필요해도 Simulation opt-in이 없거나 호출 예산이 0이면 adapter는 예외 대신
`blocked` BeatPlan 참조를 반환한다. 실행기는 partial이며 모델 0회·task_failed 없음이다. 신규 2개 실행기 경계를
Red→Green으로 확인했고, 선행 보완 선택 단위는 433 passed, 21 deselected다.

2026-11-10. Mock 내부 수용 완료. 실제 창작 품질·제품 연결 완료를 뜻하지 않는다.

## 시작·범위

브랜치 `feat/56-readonly-agents`, 시작 HEAD `07cd4b4`, 로컬 develop 참조는 기존 `79855bf`다. 강제 checkout·재기반은 하지 않았다.
시작 dirty는 TASK 05~10 문서 삭제 7건이며 복구·stage·커밋하지 않았다. TASK 15 인수·현재 코드와 공통 규칙·TASK 16을 읽었다.
이번 범위는 네 모드의 Mock 계획·선택 Simulation·출처/개수 검증·run별 adapter다. TASK 17 이후는 시작하지 않는다.

## 파일·계약

`backend/ai-service/app/agents/development.py`에 DevelopmentRequest/Input/Reply, Insight, Beat, BeatPlan, development, development_tasks, DevelopmentHandler를 추가했다.
`runs/orchestrator.py`의 development를 실제 DTO handler로 등록하고 `tests/test_task_graph.py`의 stub 기대값을 갱신했다.
`tests/test_development.py`에 신규 15개 단위를 작성했다. AI AGENTS/README·설계 02/03/05·기능표·이 문서를 보완했다.

요청은 query·mode·count와 선택 hook_refs/conti_refs/plot_refs/character_refs, reaction_required·simulation_input, 호출별 토큰 상한을 받는다.
모드는 next_insights/alternative_plot/next_episode_planning/expand_conti다. expand_conti는 선택된 콘티 ref가 필수다.
분류·미회수 여부·현재 인물 상태의 선택은 신뢰된 합성 호출자의 명시 ref이며 자유문에서 자동 추출하지 않는다. 각 ref는 실제 선택 문맥에 있어야 한다.
전체 허용 회차 coverage와 직전 회차 근거가 있어야 생성한다. 부족한 coverage는 partial, 필수 ref 누락·잘못된 출력은 blocked다.
실제 Content 대신 임의 Mock fallback을 사용하지 않는다. 현재 함수는 명시 MockContentReadPort만 지원한다.

모델 seam은 `model.develop(DevelopmentInput) -> DevelopmentReply`다. 모델·실제 transport는 구현하지 않았다.
인사이트는 idea/character_reaction/scene/impact/risk/unresolved_hook/refs, Beat는 goal/action/dialogue/cause/refs를 반환한다.
요청 count와 정확히 일치하고 아이디어/목표의 정규화된 이름이 서로 달라야 한다. 반대 종류 출력·알 수 없는 refs·Text/Patch 추가 필드는 거절한다.
모든 결과는 hypothetical=true, is_mock=true다. sources·coverage를 포함하며 Simulation refs와 정본 근거 refs는 별도 필드다.
자유 창작문은 모델 대역이 공급하는 제안이다. 문자열 구별이 의미적 독창성이나 사실 충실도를 입증하지 않는다.

`development_tasks(request, context_task=...)`는 context→development 또는 context→선택 Simulation→development를 만든다.
호출자는 같은 packet의 SimulationHandler와 DevelopmentHandler를 run별로 TaskRunner에 주입한다. 실제 TASK 14 함수를 별도 모델 예산으로 실행한다.
TASK 15의 `_simulation_context`를 재사용해 가상 표시·시도 수·판본·span·hash를 검사하고 기존 reducer로 행동을 재생 검증한다.
이 private helper와의 내부 결합은 현재 두 모듈의 제한이다. 공통 추상화나 새 서버는 추가하지 않았다.
DevelopmentHandler.plan 본문은 메모리에 두고 실행기에는 development:{run_id}:{task_id} 참조·상태만 전달한다.
Writing/Editing Task·Text/Patch·Content 저장·승인·정산은 호출하지 않는다. 실제 Main/공개 Run 자동 조립은 미연결이다.

## 설계·이슈

[02 실행·예산](02-ai-architecture.md), [03 §10 전개·§11 Simulation](03-rag-simulation-design.md#10-story-development와-다음-회차),
[05 시나리오 G](05-implementation-roadmap.md), 기존 DEC-36·37·41과 AI 서비스 지침을 따른다.
2026-11-10 조회: [#61](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/61)은 open·kyo-135,
[#58](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/58)은 open·Seongho-haru/kyo-135 공동 담당이다. 이슈 변경·자동 종료는 하지 않았다.

## 검증

AI 서비스 디렉터리에서 실행했다.

```powershell
uv run --offline --locked --extra dev python -m pytest -m 'not integration' tests/test_development.py tests/test_semantic_review.py tests/test_simulation.py tests/test_task_graph.py tests/test_task_runner.py tests/test_retrieval_coordinator.py tests/test_mock_retrievers.py --tb=short
```

결과 **236 passed in 11.88s**. 신규 Development 15개 포함. 모듈 부재와 development_tasks 부재의 Red를 확인한 뒤 Green으로 구현했다.
시나리오 G 3개·요청 개수·중복·위조 refs·추가 patch·필수 복선 누락·coverage 부족·모델 장애·timeout·권한 철회를 검사했다.
실제 메모리 TaskRunner에서 기본 모델 1회, 선택 Simulation 2회+계획 1회, Writing/Editing Task 0개와 본문 없는 결과 참조를 확인했다.
검증은 합성 Content·AsyncMock의 단위 증거다. uv 캐시 권한 제한 때문에 승인된 명령 단위 호스트 실행을 사용했다.
로컬 diff·문서 파일 링크를 검사하고 ponytail-review 관점에서 기존 Simulation 검증 재사용·새 의존성 없음·후속 쓰기 없음으로 점검했다.
CodeRabbit은 이전 외부 전송 승인 대기 상태를 유지하며 이번에는 전송하지 않았다.

## 영향·위험·종료

실 모델·DB·Neo4j·인덱스·원고 저장은 0건이다. 의존성·lockfile·.env·기존 공개 API를 변경하지 않았다.
실 품질·누출률·부하·비용은 미평가다. 추천은 명시 합성 refs·Mock 모델 유지이며, 대안인 실제 모델/상태 공급은 권리·허용 전송·비용 계약과 품질 평가 후 별도 연결한다.
콘티/플롯/미회수 복선의 자동 추출·정형 상태 계약도 후속 결정이 필요하다. 현재 원문 ref 선택의 단위 증거만 제공한다.
로컬 커밋 메시지: `feat: 가상 전개 인사이트와 장면 계획 구현`(Refs #61, #58). 정확한 해시는 최종 채팅·git log에 기록한다.
push·PR 생성/변경·병합·배포는 하지 않는다. TASK 17은 새 요청·해당 md 전까지 진행하지 않는다.
미실행: 통합·시스템·브라우저·전체 테스트·빌드·실 모델/DB·hosted CI·배포·외부 리뷰.
