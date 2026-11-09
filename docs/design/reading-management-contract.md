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
| 21-C | `GET /api/v1/works/reading` | 200 `{ "records": [{ "workId", "lastEpisode", "readEpisodes": [...], "updatedAt" }] }` 최근순, 본인 것만 |
| 21-C | `DELETE /api/v1/works/{id}/reading` | 204. 그 작품의 이어 읽기·읽은 회차 기록 삭제, 멱등 |

## 내부 API·사건

- **20 — Core `POST /internal/v1/members/nicknames`**: 요청 `{ "ids": [uuid...] }`(1~200개), 응답 `{ "nicknames": { "<id>": "<닉네임>" } }`(없는 회원은 맵에서 제외).
  `X-Content-Service-Token`만 허용한다(`/internal/v1/auth/verify`와 같은 신뢰 판정, `InternalAuthSecurityConfig`). Content는 응답 하나를 만들 때 소유자 ID를 모아 **한 번만** 호출한다(N+1 금지).
  구현 메모: Core 회원 ID는 UUID라 UUID가 아닌 소유자(레거시·테스트 행)는 Core에 묻지 않고 `탈퇴한 회원`으로 본다. 한도(200개)를 넘는 소유자 수만 200개씩 나눠 보낸다(응답 하나가 분할 호출 중 하나라도 실패하면 전체 503).
  Core 실패(연결·시간 초과·상대 오류·빈/잘못된 응답)는 인증 확인의 504·502 구분 없이 모두 503이며 재시도·캐시·임의 이름 대체가 없다.
- **21-B — 사건 `content.episode.published`**: Content가 공개 작품의 회차를 발행하면 같은 트랜잭션에서 관심 등록한 회원마다(작가 본인 제외) `content_event_outbox`에 한 행을 쓰고,
  스케줄 발행기가 [알림 사건 계약](../notification-event-contract.md) 형식(`target.type = "work"`, `target.id = 작품 id`)으로 `storyfork.events`에 보낸 뒤 `published_at`을 채운다.
  Core는 `NoticeEventType`에 `EPISODE_PUBLISHED("content.episode.published", READING, "관심 작품에 새 회차가 올라왔어요", "work")`를 추가한다.
  Content에 `spring-boot-starter-amqp`(Core가 이미 쓰는 의존성)와 compose RabbitMQ 연결 설정을 추가한다.

## Frontend

- 20: 기존 Http 저장소·화면을 점검하고 빈 곳만 고친다. `/read/:id`·`/read/:id/:n`의 로그인 가드를 풀어 비회원도 공개 회차를 읽게 하고(UC-01, 세션 복원이 끝난 뒤 열기),
  포크 등 회원 전용 동작은 해당 화면의 로그인 안내를 그대로 두고, 데모 작품 회차 화면의 댓글·댓글 좋아요·피드백도 비회원이 누르면 로그인 안내로 보낸다. 서버 작품의 작품 상세(최신 공개 회차 기준 카드)와 회차 화면(그 회차 기준 시트, 화면 ID U44)에
  `readWorld`가 채운 `Work.wiki`(서버가 기준 회차까지 공개한 설정만 준다)를 읽기 전용 패널로 보여 주고, 비어 있으면 "공개된 설정이 없어요"를 보인다. 새 API·서버 변경은 없다.
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
