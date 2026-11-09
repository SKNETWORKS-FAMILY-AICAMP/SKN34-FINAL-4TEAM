# 독서 관리 계약 (기능 20·21-A·21-B·21-C)

[서비스 경계](service-boundaries.md) · [기능표](../feature-roadmap.md) · [UC-01](../usecase-spec/UC-01.md) · [알림 사건 계약](../notification-event-contract.md)

기능 20(공개 열람)·21-A(작품 좋아요)·21-B(관심 작품)·21-C(독서 기록)를 서로 다른 PR로 병렬 구현할 때의 유일한 정본이다.
네 PR은 같은 `origin/develop`에서 갈라지며 서로를 기다리지 않는다.

## 결정 (2026-11-09 사용자 확정)

| 기능 | 결정 |
|---|---|
| 20 | 9개 세부 행을 API·화면 기준으로 점검하고 빈 곳만 보완한다. 작가명은 `work.author_name`을 읽지 않고 소유자 Core 닉네임을 응답 때마다 일괄 조회해 채운다(API Composition). |
| 21-A | 좋아요는 회원만, 작품당 1회. 수는 공개(익명 포함), 누른 사람은 공개하지 않는다. 자기 작품 좋아요도 허용한다. |
| 21-B | 관심 작품은 좋아요와 **분리**한다. 작품 화면에 관심 등록 버튼을 추가하고 서재 '관심 소설'은 관심 등록한 작품만 보여 준다. 목록은 본인만 본다. 관심 작품에 새 회차가 발행되면 Core 사이트 알림(UC-27)을 보낸다. |
| 21-C | 이어 읽기 위치는 **회차 번호만** 저장한다. 로그인 회원이 회차를 열면 서버에 '마지막으로 연 회차'(최댓값이 아니라 최근에 연 회차, UC-01 A4)와 읽은 회차를 기록한다. 비회원은 기록하지 않는다. 서재에서 이어 읽기 기록을 삭제할 수 있다. |

공통: 대상은 공개 작품(`publiclyVisible()`)뿐이다. 비공개·없는 작품은 404, 미발행 회차는 404, 비로그인 쓰기는 401이다.
상속 회차(Fork가 원작에서 물려받은 회차)도 Fork 작품 기준으로 기록한다(`EpisodeCurrentRepository.findByWorkIdAndSequence(id, n)?.publishedVersionId` 재사용).

## 저장 (Content Flyway)

각 PR은 `db/migration/work/` 아래에 develop 최댓값 다음 번호 **V17**을 쓴다(현재 develop 최댓값 V16). 열린 PR #221·#228도 V17을 쓰므로
나중에 병합되는 PR이 내용 불변으로 다음 번호로 바꾸고 마이그레이션 수 기대값을 함께 올린다(번호를 미리 건너뛰면 연속 버전 단언이 실패한다).

| PR | 테이블 | 핵심 제약 |
|---|---|---|
| 21-A | `work_like(work_id, member_id, created_at)` | PK(work_id, member_id) |
| 21-B | `work_interest(work_id, member_id, created_at)`, `content_event_outbox(id uuid PK=eventId, type, recipient_id, target_type, target_id, occurred_at, published_at null)` | PK(work_id, member_id) |
| 21-C | `reading_record(member_id, work_id, last_episode, updated_at)`, `reading_episode(member_id, work_id, episode_number, read_at)` | PK(member_id, work_id) / PK(member_id, work_id, episode_number) |

회원 탈퇴 시 삭제(UC-22)는 이번 범위 밖이다(ponytail 한계).

## 공개 API (Content, 기존 Security·nginx 규칙 안)

기존 규칙(`GET /api/v1/public/works/**` 익명 허용, `/api/v1/works/**` 인증)을 그대로 쓰므로 Security·nginx·Vite 변경이 없다.
`/api/v1/works/interests`·`/api/v1/works/reading`은 리터럴 경로라 `/works/{id}`보다 우선한다.

| PR | 메서드·경로 | 응답 |
|---|---|---|
| 20 | `GET /api/v1/public/works`, `/ranking`, `/{id}` 와 소유자 `GET /api/v1/works`, `/{id}` | `WorkResponse.authorName` = 소유자 Core 닉네임. 응답에 없는 ID는 `탈퇴한 회원`. Core 실패는 503(임의 이름 fallback 금지). 작가 검색(`f=author`)도 조회한 닉네임으로 매칭 |
| 21-A | `PUT /api/v1/works/{id}/like` · `DELETE /api/v1/works/{id}/like` | 200 `{ "likes": <수>, "liked": <bool> }`, 멱등 |
| 21-A | 공개 목록·랭킹·상세 | `WorkResponse.likes: Long`(수). 상세 `GET /api/v1/public/works/{id}`는 Bearer가 오면(`Principal?`) `liked: Boolean`, 익명은 false |
| 21-B | `PUT /api/v1/works/{id}/interest` · `DELETE /api/v1/works/{id}/interest` | 204, 멱등 |
| 21-B | `GET /api/v1/works/interests` | 200 `{ "workIds": [...] }` 최근 등록순, 본인 것만. 지금은 비공개가 된 작품은 제외 |
| 21-C | `PUT /api/v1/works/{id}/reading/{number}` | 204. `last_episode = number`, 읽은 회차에 `number` 추가 |
| 21-C | `GET /api/v1/works/reading` | 200 `{ "records": [{ "workId", "lastEpisode", "readEpisodes": [...오름차순], "updatedAt" }] }` 최근순, 본인 것만. 지금 공개가 아닌(비공개·운영 제한) 작품은 제외하되 행은 남긴다 |
| 21-C | `DELETE /api/v1/works/{id}/reading` | 204. 그 작품의 이어 읽기·읽은 회차 기록 삭제, 멱등 |

## 내부 API·사건

- **20 — Core `POST /internal/v1/members/nicknames`**: 요청 `{ "ids": [uuid...] }`(1~200개), 응답 `{ "nicknames": { "<id>": "<닉네임>" } }`(없는 회원은 맵에서 제외).
  `X-Content-Service-Token`만 허용한다(`/internal/v1/auth/verify`와 같은 신뢰 판정, `InternalAuthSecurityConfig`). Content는 응답 하나를 만들 때 소유자 ID를 모아 **한 번만** 호출한다(N+1 금지).
- **21-B — 사건 `content.episode.published`**: Content가 공개 작품의 회차를 발행하면 같은 트랜잭션에서 관심 등록한 회원마다(작가 본인 제외) `content_event_outbox`에 한 행을 쓰고,
  스케줄 발행기가 [알림 사건 계약](../notification-event-contract.md) 형식(`target.type = "work"`, `target.id = 작품 id`)으로 `storyfork.events`에 보낸 뒤 `published_at`을 채운다.
  Core는 `NoticeEventType`에 `EPISODE_PUBLISHED("content.episode.published", READING, "관심 작품에 새 회차가 올라왔어요", "work")`를 추가한다.
  Content에 `spring-boot-starter-amqp`(Core가 이미 쓰는 의존성)와 compose RabbitMQ 연결 설정을 추가한다.

## Frontend

- 20: 기존 Http 저장소·화면을 점검만 하고 필요한 곳만 고친다.
- 21-A: `toggleLike`·작품 상세 `liked`·좋아요 수를 서버로. `ReadingProgress.liked` 필드는 서재가 아직 쓰므로 21-A는 지우지 않는다.
- 21-B: 작품 화면 관심 등록 버튼(로그인 회원만 활성, 비회원은 로그인 안내), `LibraryUseCase.getRead().liked`를 관심 목록 기준으로 바꾼다. 21-B가 서재에서 `progress.liked` 사용을 없앤다.
- 21-C: `ReadingUseCase`의 `last`·`read`(홈 이어 읽기, 작품 읽음 표시, 회차 열기 기록)와 서재 `recent`를 서버 기록으로. 서재 읽는 중 목록에 기록 삭제 버튼. `seen`은 메모리 그대로 둔다.
- 각 PR은 새 기능 전용 Repository interface·Http 구현 파일을 만들고, 공유 파일(`ReadingUseCase`·`LibraryUseCase`·`registerAppServices`·`WorkPage`)은 자기 기능 부분만 바꾼다.
  나중에 병합되는 PR이 인접 줄 충돌을 양쪽 의도를 보존해 푼다.

## ponytail 한계

- 회원 탈퇴 시 좋아요·관심·독서 기록 삭제는 하지 않는다.
- 좋아요 수는 요청 때 `count`로 계산한다(집계 칼럼 없음).
- `ReadingProgress.liked`의 최종 제거는 21-A·21-B가 모두 병합된 뒤 나중 PR이 한다.
- 알림 발행기는 단일 인스턴스 스케줄 폴링이며 실패 행은 다음 주기에 다시 보낸다(같은 eventId라 Core가 중복을 거른다).

## 21-C 구현 메모 (독서 기록)

- **Content**: `ai.storyfork.content.reading`(`ReadingService`)이 V18 두 테이블을 맡는다. nativeQuery 없이 처리하므로 쓰기는 서비스 트랜잭션 없이 저장소 호출마다 독립 트랜잭션이고,
  위치의 첫 행이 겹치면 한 번 더 시도해 갱신하며 연 회차의 중복은 무시한다. 삭제는 작품 공개 여부와 무관하게 본인 행만 지운다.
- **Frontend**: 새 `ReadingRecordRepository`(`list`·`record`·`remove`)를 실서비스는 `HttpReadingRecordRepository`, 목업·테스트는 `mockDb.progress`를 정본으로 쓰는 `InMemoryReadingRecordRepository`로 등록한다.
  `ReadingUseCase`는 로그인 회원(`role`)일 때만 기록을 읽고 쓰며(비회원은 호출하지 않음), 작가가 자기 비공개 작품을 미리 읽을 때는 서버가 404로 거절하므로 기록하지 않는다.
  회차 열람 기록은 기다리지 않고 회차를 먼저 돌려주며(서버가 느려도 표시가 늦어지지 않는다), 결과의 `recording` Promise가 실패하면 뷰어가 토스트로 알려 성공으로 보이지 않게 한다. 홈·작품·서재의 기록 조회 실패는 빈 기록으로 숨기지 않고 화면 조회 실패로 알린다.
- **남은 것**: 캐릭터 챗 목업의 읽은 회차 기준은 아직 메모리 진행 상태(`ReadingProgress.last`)를 읽는다. 목업·테스트에서는 같은 상태라 맞지만 실서비스 기록과는 이어지지 않는다.

