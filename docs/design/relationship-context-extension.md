# 관계 시점·회차 Context 확장안 — #123 / #124

**미구현 검토안이다. 구현·migration 승인 문서가 아니다.** 2026-11-09 develop `51b7024a` 기준.

> 채택하려면 2026-11-05 사용자 결정(관계는 Neo4j 현재 상태 하나, 이력·과거 복원 없음 —
> [decisions](decisions.md) DEC-27·33 예외, [#132 계약](worldstudio-independent-schema.md))을 먼저 바꿔야 한다.
> 그 전까지 #132 현재 상태 CRUD가 유효하다. 초기 세계관 추출(#219/#225)은 이 결정과 무관하게 진행한다.

## 문제

원작 10화까지 관계를 고친 뒤 3화 기준 Fork나 3화 시점 AI 문맥을 만들면, 지금은 현재 관계만 있어 10화 정보가 섞인다.

## 현재 코드

| 위치 | 현재 | 확장 시 주의 |
|---|---|---|
| `Neo4jRelationshipRepository` | world UUID 단위 payload 교체, CAS `version` 증가, 이력 없음 | `version`은 동시성 counter다. 과거 조회 키로 쓰지 않는다 |
| `WorldStudioService` | PG 준비 → Neo4j 교체 → PG 완료, 미완료는 같은 요청 키로 재시도 | 이 패턴을 그대로 재사용한다 |
| `CheckpointEntity.graphStateRef` | nullable, 항상 비어 있음(`content_only`) | 관계 snapshot 참조를 넣을 자리. 빈 값을 현재 그래프로 채우지 않는다 |
| DEC-43 `publication_event` | 발행 = 회차 체크포인트 | 관계 snapshot은 발행 이벤트에 붙인다. 새 체크포인트 테이블은 만들지 않는다 |
| `WorldService`/`ForkService` | content world(String) 기반, WorldStudio UUID와 연결 없음 | 작품 ↔ Studio world 연결이 먼저 필요하다 |

content world와 WorldStudio world는 서로 다른 모델·트랜잭션이다. Fork 텍스트 복사를 Studio 관계 복사로 간주하지 않는다.

## 지켜야 할 결정

- **DEC-43**: Fork **원고**는 생성 시점의 1~기준 회차 발행본에 고정된다.
- **DEC-32/37**: Fork **세계관**은 최초 수정 전까지 원작을 따라간다. 10화 작업 중 고쳤어도 3화에 적용·공개되는 정정이면 3화 Fork에 반영한다.
  두 기준을 하나의 포인터로 합치지 않는다. 생성 당시 재현(exact)과 최신 정정 추종(following)은 조회 모드로 구분한다.
- **DEC-34/37**: 독립 후 원작 변경은 알림과 사용자 선택으로만 반영한다. 거절한 변경도 나중에 다시 반영할 수 있다.
- **DEC-36**: 적용 시점과 공개 시점은 서로 다른 값이다. 인물이 아는 것과 독자에게 공개된 것도 다르다. 기본은 비공개다.
- **DEC-41**: 범위·권한 판단은 Content가 한다. AI는 받은 문맥만 쓴다. #163 MCP는 나중에 전송 방식만 담당한다.

## 선택지

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A. 발행 시 snapshot (권장) | 회차를 발행할 때 그 회차 기준 관계를 Neo4j에 불변 snapshot으로 저장하고 ref를 `graphStateRef`에 기록 | 단순하다. 기존 발행 흐름에 붙는다. 발행은 횟수가 적다 | 발행 사이의 변경은 남지 않는다. 소급 정정은 재발행해야 반영된다 |
| B. 변경 이력 + replay | `GraphRevision`/`RelationshipChange`를 쌓고 baseline부터 지정 revision까지 재생 | 모든 시점을 조회할 수 있다 | 모델·복구·검증 범위가 크다. MVP 일정에 맞지 않는다 |

공통 규칙:
- 회차마다 그래프 전체를 복제하지 않는다.
- 도입 이전 시점은 `not_recorded`로 표시하고, 원고나 AI 결과로 추측 backfill하지 않는다.
- `graphStateRef`는 서버가 작품·world 소속을 대조한 뒤에만 사용한다. 클라이언트나 AI가 넘긴 ID로 조회 범위를 넓히지 않는다.

## Fork 흐름 (A안 기준)

1. Fork 생성: 원고는 1~3화 발행 이벤트에 고정한다. 세계관은 원작 snapshot 중 3화 적용·공개 범위만 참조한다.
2. 최초 수정 전: 원작이 3화 범위를 정정해 재발행하면 그 snapshot을 따라간다.
3. 최초 수정: 그 시점의 허용 범위를 Fork 전용 Studio world로 **한 번** 복사한다. PG와 Neo4j가 모두 끝나기 전에는 독립으로 표시하지 않는다. 재시도는 같은 ID로 한다.
4. 독립 후: 원작 변경은 알림만 보낸다. 반영·거절 기록을 남긴다.

## 실패·읽기 원칙

- 기존 Studio 패턴(요청 키·hash·미완료 상태)을 따른다. PG와 Neo4j를 하나의 트랜잭션으로 가정하지 않는다.
- 미완료 snapshot이나 미완료 독립은 완료 문맥으로 노출하지 않는다. 같은 키로만 재개한다. 자동 삭제나 repair는 하지 않는다.
- 문맥 조회가 불완전하면 `partial`/`unsupported`로 명시한다. 과거 시점 요청을 현재 상태로 대신 응답하지 않는다.
- 인물 시점에는 그 인물이 아는 관계만 준다. 숨긴 endpoint·설명·근거·개수도 함께 걸러낸다.
- migration은 추가만 한다. 기존 Neo4j 데이터·SQL은 수정하지 않는다.

## 미정 (사용자 결정 필요)

1. 11-05 결정을 바꿔 관계 시점 기능을 범위에 넣을지, 넣는다면 MVP 이후로 둘지
2. A/B 중 어느 안으로 갈지 (권장 A)
3. 적용 시점 단위: 회차 / 장면 (권장 회차)
4. 작품 ↔ Studio world 연결과 Fork ID 매핑 방식
5. 불완전한 문맥에서 AI 작업을 허용할지 (권장: 정확한 시점 요청은 거부)

결정 후 구현은 Studio 연결 → 발행 snapshot → Fork 독립 → 문맥 조회 순서로 별도 PR에서 진행한다.
