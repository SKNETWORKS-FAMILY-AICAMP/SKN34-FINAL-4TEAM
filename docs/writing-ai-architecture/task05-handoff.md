# TASK 05 — Intent Router·Slot Resolver 인수 기록

> **2026-11-11 현행:** 실제 연결 여부와 남은 선행 조건은 최신 표를 따른다. [실연동 인수보고](live-rag-handoff.md) 참조. 아래 TASK별 결과는 당시 기록이다.

2026-11-09. TASK 05의 내부 분류·대상 식별 모듈을 구현했다. 실제 모델 품질·HTTP 실행 연결·Content 후보 transport는 검증/구현하지 않았다. TASK 06 이후는 진행하지 않는다.

## 기준과 권한

| 항목 | 확인 결과 |
|---|---|
| 시작 브랜치·HEAD | `feat/54-canonical-read-scope`, `6072fc098edafa9d1388dc0a427d35f2c9a409e7`. 시작 dirty 없음. 기존 작업 checkout을 유지했다. 기준 개발 대상은 develop이나 새 fetch·병합은 하지 않았다. |
| 읽은 입력 | Downloads의 `task04-handoff.md`, `00_COMMON_RULES.md`, `06_TASK_05_intent_router_slot_resolver.md`. TASK 04 구현과 선택 단위 테스트도 확인했다. |
| 설계 근거 | [02 라우팅과 대상 식별/Registry](02-ai-architecture.md#라우팅과-대상-식별), [06 실행과 모델](06-design-decisions.md#실행과-모델), [07 검색 계약](07-retrieval-contract-and-mocks.md), [03 Review/Writing](03-rag-simulation-design.md), [04 operation 계약](04-infrastructure-integration.md), [DEC-28·36·37·41](../design/decisions.md), [서비스 경계](../design/service-boundaries.md), [유스케이스](../usecase.md). |
| 문서와 요청의 차이 | TASK의 공급자 인터페이스만 구현·제공사 미선정 권고는 사용자의 최신 요청으로 변경했다. 모델 호출은 모두 OpenAI API, 라우터는 Decisions로 선택했다. 실제 유료 호출·운영 데이터 전송은 하지 않는다. |
| 이슈 | [#55](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/55), [#54](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54), [#57](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57)를 이번 작업 중 조회했다. 모두 open, 담당 kyo-135. #55 분류, #54 허용 범위, #57 이전 대상 격리의 부분 구현이며 이슈 전체 완료는 아니다. 이슈 수정·댓글·자동 종료는 하지 않았다. |

## 파일과 동작

| 파일 | 책임 |
|---|---|
| `backend/ai-service/app/runs/__init__.py` | 내부 실행 준비 패키지. HTTP router를 등록하지 않는다. |
| `backend/ai-service/app/runs/routing.py` | Pydantic `RoutingRequest`·`Classification`, `RouterPort.classify`, `RuleBasedRouter`, `OpenAIDecisionsRouterAdapter`, 안전한 `RoutingFailure`. |
| `backend/ai-service/app/runs/slots.py` | `Target`·`SlotRequest`·`SlotResult`, `TargetContentPort.allowed_targets`, `SlotResolver.resolve`. 실제 Content 호출 구현은 #163의 후속 계약에 남긴다. |
| `backend/ai-service/tests/test_routing.py` | 명시/복합/오타·승인·실행 신호·모델 실패·회차 충돌·동명이인·Scope 변경·철회 단위 테스트. |
| 서비스 `AGENTS.md`·`README.md`, 설계 02·06, 이 기록, `docs/feature-roadmap.md` | 사용자 모델 선택, 단계 범위와 남은 검증을 동기화했다. 전체 제품 완료 표시는 유지하지 않고 관련 ❌를 유지했다. |

`Classification`은 `in_scope, risk_flags, primary_intent, task_pattern, capabilities, missing_slots, wants_change, approval_intent`를 제공한다. `ask/review/edit/simulate/next_draft/next_insights/expand_conti/world_plot_change/recommend_template/auto`를 표현하며 `auto`는 실제 실행 작업이 아니다. capabilities는 Python 고정 매핑으로 도출한다. 인가 정보인 `allowed_operations`와 `ui_mode`는 서버가 검증한 값이어야 하며 모델이나 공개 클라이언트가 확정하지 않는다.

등록된 UI 모드·단일 표현·회차/조사로 제한한 대상 접두어·검수 후 조건부 수정 표현은 모델 0회다. 복합 enum은 설계 예제의 `review_then_edit` 한 개만 구현했다. 해당 enum은 검수와 수정이 모두 허용되어야 반환된다. 다른 조합·오타는 규칙 기준선에서 `clarify`와 `missing_slots=(intent,target)`를 반환한다. 모델 어댑터를 지정하면 미해결 자유문만 선택형 질문 1회에 전달하며, `clarify/out_of_scope/unsafe/approval`도 선택할 수 있다. 미등록 값·누락·중복 답변·refusal·공급자 오류는 `RoutingFailure`이고 다른 모델이나 Mock으로 성공 대체하지 않는다.

분류 성공은 대상 확정이나 실행 승인이 아니다. Router의 missing_slots는 의도 미확정 상태이고 대상 누락은 별도 SlotResult에서 확인한다. `wants_change=true`는 수정/생성 **제안** 요청이며 저장 권한이 아니다. 자연어 승인·저장·발행은 capabilities를 비우고 `approval_intent=true`로 차단한다. 등록 함수·URL·경로·SQL 실행기는 추가하지 않았다. 위험 문자열 검사는 제한된 규칙이며 포괄적인 프롬프트 인젝션 방어로 검증된 것은 아니다.

Slot Resolver는 매번 Content 후보를 조회한 뒤 UI 대상 → 현재 Scope와 같은 이전 대상 → 회차·허용 이름 파서 순으로 좁힌다. Scope digest가 다른 작품·Fork·사용자·grant·manifest면 이전 대상을 사용하지 않는다. 모든 반환 후보의 digest·기준 회차·중복 ID도 검사한다. UI와 문장이 충돌하면 명시된 회차/이름의 허용 후보를 제시하며 확정하지 않는다. 확인은 해당 후보를 새 인증 UI 대상으로 다시 제출하는 방식이다. 중복 이름·여러 회차·미등록 이름·작품 변경 표현은 확인을 요구한다. 이름 파서는 허용 이름의 경계 일치와 `이름 + 검수/검토/수정/시뮬레이션`의 제한 문법이며 자유문 전반의 개체 추출기가 아니다. 후보 1개라도 명시 단서나 확인 없이 자동 선택하지 않는다. Content 장애는 unavailable/denied/unsupported로 보존한다.

## OpenAI 연결과 사용

[공식 Decisions 가이드](https://developers.openai.com/api/docs/guides/decisions)와 [Create reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)를 2026-11-09 확인했다. 지원 모델 `gpt-6-luna`, `POST /v1/decisions`, `questions[type=choice,name,choices]`와 `answers[type,name,choice]` 계약을 사용한다. SDK의 특정 Decisions resource 추가 시점에 의존하지 않도록 기존 `OpenAI.post`와 내부 응답 DTO를 사용하고 응답을 다시 검증한다. API 확신 점수에 검증되지 않은 임계값을 도입하지 않았다.

```python
from app.runs.routing import OpenAIDecisionsRouterAdapter, RoutingRequest

# 서버의 허용 작업만 전달한다. 명시 UI 경로에서는 키/모델을 호출하지 않는다.
router = OpenAIDecisionsRouterAdapter()
classification = router.classify(RoutingRequest(text="검수해줘"), ("review",), "review")
assert classification.primary_intent == "review"
```

명시 UI가 아닌 자유문을 위 어댑터에 전달하면 실제 OpenAI 호출이 발생할 수 있다. 서버의 기존 `OPENAI_API_KEY`만 사용하고 `https://api.openai.com/v1`·timeout 15초·자동 재시도 0회·고정 선택지를 사용한다. `OPENAI_MODEL`은 기존 이어쓰기용이며 이 라우터 모델을 변경하지 않는다. 키·Scope·grant·이전 대화·검색 원고를 분류 payload에 넣지 않는다. 다만 사용자가 prompt에 붙인 문장은 전송될 수 있으므로 실 원고 전송·유료 검증 전에는 해당 데이터와 비용 범위를 별도로 승인받아야 한다. 현재 테스트는 합성 문장과 monkeypatch만 사용한다.

새 production 의존성·lockfile·환경 변수·DB/DDL·데이터 변경은 없다. 기존 생성 API·Content 인가·검색 계약·원고 채택 경로는 바꾸지 않았다. 모델 결과는 어떤 tool도 실행하지 않는다.

## TDD와 검증

`tests/test_routing.py`를 먼저 작성하고 `app.runs` 모듈 부재 Red를 확인했다. 이후 공급자 대역의 context manager 오류, 회차/이름 접두어와 미등록 이름 확인의 실패를 확인하고 최소 구현으로 수정했다. 이름 정규식의 범위를 재검토해 회차를 먼저 제거한 제한 문법으로 줄였다.

AI 서비스 디렉터리에서 실행한 선택 단위 명령:

```powershell
python -B -m pytest -p no:cacheprovider -o addopts= -q -m 'not integration' tests/test_routing.py tests/test_generation.py tests/test_canonical_read.py
```

결과: **105 passed, 1 deselected**. TASK 05 63개와 기존 생성/Scope 42개이며 HTTP 통합 1개를 제외했다. sandbox의 Python 실행이 출력 없이 대기하여 승인된 호스트 Python 3.12·OpenAI SDK 2.54.0에서 실행했다. 선택 단위에서 원격 API·DB는 호출하지 않았다.

지침의 `uv run --offline --no-cache --locked --extra dev ...`는 sandbox 캐시 접근 거부 후 호스트에서도 Python 3.11 부재로 실패했다. 프로젝트 lock의 OpenAI 3.3.1 환경 재현은 대기이며 lockfile을 바꾸지 않았다. 단위 통과는 실제 Decisions 접근 권한·한국어 분류 정확도·p95·가격·운영 품질의 증거가 아니다.

완료 전 ponytail-review·정확성 자체 점검을 수행했다. 새 실행기·DAG·Agent·캐시·전역 설정·의존성을 추가하지 않았다. CodeRabbit CLI 후보 경로는 확인했으나 설치 출처가 미확인이라 외부 리뷰를 실행하지 않았다. 사용자의 OpenAI 전용 요청을 고려해 다른 제공사의 리뷰 모델도 사용하지 않았다. 통합·시스템·브라우저·전체 suite·빌드·hosted Required CI·유료 API 검증은 미실행이다.

## 남은 경계와 인계

| 항목 | 추천·대안 |
|---|---|
| 모델 계정·한국어 품질·비용 | 승인된 합성 평가 세트로 실제 Decisions 검증 후 runtime 연결을 권장한다. 그전에는 `RuleBasedRouter()`로 명시 경로와 확인 요청만 사용할 수 있다. 모델 호출 실패를 규칙 성공으로 대체하지 않는다. |
| Content 후보·UI 연결 | #163의 서비스 위임과 인증 transport가 정해진 후 `TargetContentPort`를 연결한다. 현재 테스트 대역은 실제 권한으로 취급하지 않는다. 문서 revision·구간·실행 직전 인가는 후속 실행 계층/Content에서 다시 확인해야 한다. |
| 패턴·파서 확장 | `review_then_edit` 외 패턴과 다중 회차·자유문 개체 추출은 사용자 확인으로 남긴다. 제품 요구가 정해지면 enum·I/O·단위 예제를 함께 등록한다. |
| 커밋·외부 변경 | 로컬 커밋 제안: `feat: OpenAI Decisions 의도 분류와 대상 확인 구현`(#55·#54·#57). 이번 작업은 미커밋으로 남겼다. push·PR 생성/병합·배포·이슈 변경은 하지 않았다. |
| 다음 단계 | TASK 05 내부 모듈 인계 가능. TASK 06 이후는 새 요청과 해당 문서를 받은 뒤 착수한다. 실제 run 연결·Content 후보·모델 검증은 현재 완료에 포함하지 않는다. |
