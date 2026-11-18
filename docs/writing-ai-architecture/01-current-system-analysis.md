# 집필 AI: 개발 출발점 (이력)

**상태: 이력.** 2026-11-11 `develop`을 기준으로 개발을 다시 시작할 때의 출발점 기록이다. 현행 실행 구조는 [아키텍처](02-ai-architecture.md), 구현 순서와 상태는 [로드맵](05-implementation-roadmap.md)을 본다.

- 기존 집필 AI 스택은 [`chore/writing-ai-archive`](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/tree/chore/writing-ai-archive)에 보존되어 있다. 닫힌 PR #220, #230, #241, #244, #245, #279~#282의 코드와 인수 기록은 참고 자료이며, 구현이나 수용 결과로 취급하지 않는다.
- 당시 출발점:
  - 원고용 Elasticsearch 벡터 인덱스가 없었다. 이후 구현은 [원고 벡터 인덱스 v1](07-retrieval-contract-and-mocks.md#원고-벡터-인덱스-v1)에 있다.
  - WorldStudio 관계는 Neo4j에 현재 상태 하나만 저장했다(#132). 지금은 회차별 연결로 기록한다([DEC-51](../design/worldstudio-independent-schema.md#회차별-관계--dec-51)).
- 당시 정한 개발 단위: 기능 하나를 정하고 단위 테스트 Red → Green, 개발용 데이터와 실제 OpenAI 모델로 확인, 한계 기록 순으로 진행한다. 이 방식은 [로드맵의 작업 루프](05-implementation-roadmap.md#모든-단계의-작업-루프)로 이어진다. 첫 수직 단위는 세계관 관계 조회 → Story Context 질문 → 출처 있는 답변이었고, 다음은 원고 색인·검색이었다.

## 유지할 도메인 규칙

- 설정은 항목별 공개·비공개와 회차별 공개 범위를 따르며 기본은 비공개다(DEC-36).
- Fork는 기준 회차·버전을 보존하고, 최초 수정 전 추종과 독립 후 사용자 선택을 구분한다(DEC-37, DEC-43).
- 사용자 승인, Content의 실제 적용 영수증, AI의 생성 완료는 서로 다른 상태다.
- 미래 회차, 다른 인물만 아는 사실, 다른 작품/Fork의 자료를 모델 입력에도 넣지 않는다.
- 전체 RAG 목표와 도입 시점은 [검색 계약](07-retrieval-contract-and-mocks.md), 기능 순서는 [로드맵](05-implementation-roadmap.md)을 따른다.
