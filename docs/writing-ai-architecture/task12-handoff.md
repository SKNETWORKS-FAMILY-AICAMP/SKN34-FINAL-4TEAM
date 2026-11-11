# TASK 12 — Mechanical Review 인수 계약

> **2026-11-11 현행:** [TASK별 실제 구현·미구현 근거와 개발 방법](implementation-status.md)을 우선한다. 아래 내용은 당시 인수 기록이다.

2026-11-10 현재 코드 기준으로 누락 링크를 보완했다. 최초 구현은 `83f8065`이며 과거 인수 원문의 복원이 아니다.
연결 이슈는 [#59](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/59)이며 자동 종료하지 않는다.

## 호출·반환

`app/agents/review.py`의 `ReviewRequest(query, target, checkTypes, names, numbers, spelling_rules)`를
`mechanical_review(request, content=...)`에 전달한다. `target`·정본 기준은 revision·UTF-16 span·SHA-256을 가진 `ExactSource`다.
검사 종류는 `names/numbers/repetition/spelling`만 허용하며 `check_types` 별칭도 지원한다.

`NameCheck`는 선택 span·정식 명칭·명시 별칭, `NumberCheck`는 선택 span·기대 설정 값·기준 회차를 받는다.
수치는 같은 회차 기준의 명시 숫자만 비교한다. 인접 중복 어절과 요청의 잘못된 표기/교정 쌍만 기계적으로 검사한다.
미등록 명칭·강조 반복·제한 맞춤법 후보를 확정 오류로 승격하지 않는다.

`Findings`는 checked_types·findings·sources·gaps·상태·`is_mock`를 반환한다.
각 Finding에는 issue 종류, 원문 위치·판본·인용, 근거 refs, confirmed/suspected, 설명·수정 제안을 담는다.

## Run·한계

`REGISTRY['mechanical']`와 run별 `MechanicalReviewHandler`를 사용한다. 모델·Simulation·원문 쓰기는 0회다.
Findings 본문은 메모리에 남기고 실행기에는 참조·실제 상태와 확정 지적 여부만 반환한다.
자동 기준 추출·포괄적 한국어 교정·의미/개연성 검수·실제 Content 공급·공개 API 자동 조립은 미연결이다.

## 검증

`tests/test_mechanical_review.py`의 40개 단위 대조쌍으로 검사 선택·숫자 시점·명칭·중복·제한 맞춤법·근거 변조·상태·무호출을 확인한다.
현재 재실행 명령·결과는 [TASK 14 검증 기록](task14-handoff.md#검증)에 기록한다.
설계 근거: [03 §8](03-rag-simulation-design.md#8-review), [05 검사 F](05-implementation-roadmap.md), DEC-36·37·41.
