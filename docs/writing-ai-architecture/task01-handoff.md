# TASK 01 — 인수 기록 재구성

> **2026-11-11 현행:** 실제 연결 여부와 남은 선행 조건은 최신 표를 따른다. [실연동 인수보고](live-rag-handoff.md) 참조. 아래 TASK별 결과는 당시 기록이다.

2026-11-10: 별도 인수 파일의 Git 이력은 발견하지 못했습니다. 기존 [검색 계약·구현 기록](07-retrieval-contract-and-mocks.md)의 해당 절을 그대로 보존해 재구성했습니다. 아래 검증·미연결·커밋 상태는 기록 당시의 내용이며 현재 재실행 결과가 아닙니다.

### TASK 01에서 사용할 Content 읽기 계약

[ContentReadPort와 CanonicalAdapter](../../backend/ai-service/app/retrieval/content_client.py)는 내부 Python 계약이다. 현재 호출 가능한 구현은 [합성 Content 대역](../../backend/ai-service/app/retrieval/mock_content.py)이다. 기존 이어쓰기 API는 기존 ContextService를 사용한다.

1. **발급.** Content가 Core에서 확인한 주체와 실행 목적에 대해 작품 소유·공개·Fork 체크포인트를 검사하고 특정 작업의 grant와 manifest를 고정한다. 호출자는 작품 ID나 관점을 바꿔 위임 범위를 넓힐 수 없다. 서버 측 포트는 작업에 바인딩된 위임을 매번 확인한다. `scope_digest`는 응답 혼선을 검출하는 값이며, 권한의 근거는 Content의 위임 기록이다.
2. **검색 전.** `manifest(scope)`는 허용된 회차와 `(출처 작품 ID, 자료 종류, 문서 ID, 판본)`만 반환한다. Fork 자체 자료와 상속 원본의 고정판을 구분한다. 대역은 작가에게만 자체 초안을 열고, 인물 시점에는 해당 시점에 공개되고 `known_by`가 명시된 자료 단위만 연다. 공개 범위나 인물 지식이 섞인 본문은 Content가 분리·검증한 단위가 생길 때까지 목록에서 제외한다.
3. **검색 후.** 검색 결과의 판본과 UTF-16 구간, 인용이 있으면 원문 UTF-8 SHA-256을 `read`에 넘긴다. Content가 읽는 시점의 위임·판본·구간을 함께 재검사한다. 소비자는 모든 후보가 확인된 뒤 검증된 원문만 모델 입력에 넣는다. 검색기가 돌려준 원문, Scope 및 grant는 모델 입력에서 제외한다.
4. **실패.** 만료·철회·위조·비허용 판본이나 잘못된 구간은 `denied`, 전송 장애는 `unavailable`이다. 유효한 위임으로 요청해도 현재·과거 Studio 관계 읽기는 `unsupported`다. 조회 결과가 없는 경우는 빈 허용 목록이다. 합성 원문에는 항상 `is_mock=true`가 붙는다.

실제 전송은 [#163](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/163)에서 내부 HTTP 또는 읽기 전용 MCP와 서비스 인증·위임 만료/철회를 확정한 뒤 연결한다. 작품과 독립 Studio world의 연결은 [#109](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/109), 관계의 현재 상태 한정은 [#132](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132)를 따른다.
