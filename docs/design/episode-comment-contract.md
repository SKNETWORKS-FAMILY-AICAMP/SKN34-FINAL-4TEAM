# 회차 댓글 CRUD 계약 (기능 22)

기능표 22(댓글 작성·상세·목록·수정·삭제·스포일러·좋아요/취소)를 Content 공개 API와 실제 작품 회차 화면에 연결하는 MVP 계약이다.
댓글은 [DEC-41](service-boundaries.md) 기준 Content 책임이고, 작성자 표시명의 정본은 Core 닉네임이다.
피드백 정책은 [UC-14](../usecase-spec/UC-14.md)를 따른다.

## 결정 (2026-11-09 사용자 결정)

- 작성·수정·삭제·좋아요는 로그인 회원만, 목록·상세는 익명도 볼 수 있다.
- 대상: 공개 작품(`WorkAccessResult.publiclyVisible()`)의 **발행 회차**(`episode_current.published_version_id`가 있는 회차)만.
  댓글은 작품 ID + 회차 번호 + **작성 시점 발행 버전 ID**를 고정 저장한다. 이후 발행본이 바뀌어도 댓글의 버전 ID는 바뀌지 않는다.
- 선택 인용 문장(`quote`)을 작성 시 저장하며 수정할 수 없다.
- 수정·삭제는 작성자만(타인 403). 작품 소유자도 남의 댓글을 지울 수 없다. 수정 가능 필드는 본문·스포일러 여부다.
- 삭제는 소프트 삭제(DEC-42): `deleted_at`만 기록하고 목록·상세·수정·좋아요에서 404로 제외한다.
- 정렬: `latest`(기본, 작성 최신순)·`likes`(좋아요 수 내림차순, 동점은 최신순).
- 작성자 표시명: Core `POST /internal/v1/auth/verify` 응답에 `nickname`을 추가하고 Content가 **작성 시 스냅샷**으로 저장한다.
- 범위 밖: 1차 유해 필터·신고·숨김/복원(UC-14 A6·A7, DEC-22), 답글, 페이지네이션, 메모리 데모 댓글의 서버 이관.

## Core 변경

`VerifiedMemberResponse(memberId, operator, nickname)` — 기존 필드 유지, `nickname`(회원 닉네임) 추가.
호출자(Content·Operations)는 알 수 없는 필드를 무시하므로 기존 호출자는 영향이 없다.

## Content 인증 변경

- `auth/client`의 `VerifiedMemberResponse(memberId: UUID, nickname: String? = null)`로 받는다.
- Principal 이름은 지금처럼 회원 UUID 문자열을 유지한다. 닉네임은 인증 객체 `details`(String)에 담는다.
- 닉네임이 없거나 빈 값이면 댓글 작성자 표시명은 `독자`다.

## 저장

`backend/content-service/src/main/resources/db/migration/work/V17__episode_comment.sql` (전역 다음 번호. 새 경로를 만들지 않아 `MIGRATION_LOCATIONS` 변경 없음)

```sql
CREATE TABLE episode_comment (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_number integer NOT NULL CHECK (episode_number > 0),
    published_version_id varchar(36) NOT NULL REFERENCES episode_version(id),
    author_id varchar(200) NOT NULL,
    author_name text NOT NULL,
    body text NOT NULL,
    quote text,
    spoiler boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz
);
CREATE INDEX episode_comment_episode ON episode_comment (work_id, episode_number, created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE episode_comment_like (
    comment_id varchar(36) NOT NULL REFERENCES episode_comment(id),
    member_id varchar(200) NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (comment_id, member_id)
);
```

좋아요 취소는 좋아요 행의 하드 삭제다(사용자 결과물이 아닌 토글 상태).

## 공개 API

모든 응답 본문은 `CommentResponse`다.

```json
{ "id": "uuid", "workId": "…", "episodeNumber": 3, "publishedVersionId": "…",
  "authorName": "닉네임", "body": "…", "quote": "선택 문장 또는 null", "spoiler": false,
  "likeCount": 2, "liked": false, "mine": false, "edited": false,
  "createdAt": "2026-11-09T01:23:45Z", "updatedAt": "2026-11-09T01:23:45Z" }
```

`liked`·`mine`은 Bearer가 있으면 그 회원 기준, 익명이면 `false`다. `edited`는 `updatedAt > createdAt`이다.

| 메서드·경로 | 인증 | 동작 |
|---|---|---|
| `GET /api/v1/public/works/{id}/episodes/{number}/comments?sort=latest\|likes` | 익명 허용(Bearer 선택) | `{ "items": [CommentResponse] }` 최대 200개. 잘못된 sort 422 |
| `GET /api/v1/public/works/{id}/episodes/{number}/comments/{commentId}` | 익명 허용 | 상세. 다른 작품·회차의 댓글이거나 삭제됨이면 404 |
| `POST /api/v1/works/{id}/episodes/{number}/comments` | 회원 | 본문 `{ body, quote?, spoiler? }` → 201 + `Location`(공개 상세 경로) + `CommentResponse` |
| `PUT /api/v1/works/{id}/episodes/{number}/comments/{commentId}` | 작성자 | 본문 `{ body, spoiler }` → 200 `CommentResponse` |
| `DELETE /api/v1/works/{id}/episodes/{number}/comments/{commentId}` | 작성자 | 204(소프트 삭제) |
| `PUT /api/v1/works/{id}/episodes/{number}/comments/{commentId}/like` | 회원 | 204, 이미 좋아요면 그대로 204(멱등) |
| `DELETE /api/v1/works/{id}/episodes/{number}/comments/{commentId}/like` | 회원 | 204, 좋아요가 없어도 204(멱등) |

- 비공개·제한·삭제 작품은 404(`공개 작품을 찾을 수 없어요.`, 기존 `WorkAccessService.published` 재사용), 발행되지 않은 회차는 404(`공개 회차를 찾을 수 없어요.`)다. 자기 작품 댓글도 허용한다.
- 검증 순서: 입력 검증(422)을 접근 판정(404/403)보다 먼저 한다. 본문·인용은 앞뒤 공백을 제거해 저장하고, 공백뿐인 인용은 `null`, 수정 요청에서 `spoiler`를 생략하면 `false`다.
- 입력 검증(저장 전 422): `body`는 앞뒤 공백 제거 후 1~500자이며 Kotlin `isNotBlank()`로 판정(NBSP 공백만인 값 거절),
  `quote`는 0~500자, 두 필드 모두 U+0000 거절. 잘못된 입력의 수정은 기존 값을 바꾸지 않는다.
- 기존 보안 설정의 `GET /api/v1/public/works/**` permitAll과 `/api/v1/works/**` authenticated를 그대로 쓰므로
  Security·nginx·Vite 라우팅 변경은 없다. 쓰기는 기존 CSRF(`X-CSRF-TOKEN`) 계약을 따른다.

## 화면 연결

- 실제 Content 작품(`canonical`) 회차 열람 화면의 댓글 영역이 위 API를 쓴다: 목록(최신/좋아요 정렬 전환), 작성(스포일러 체크·선택 문장 인용),
  내 댓글의 수정·삭제, 좋아요/취소, 스포일러 댓글 펼치기. 익명은 목록만 보고 작성·좋아요는 로그인 안내다.
- 로딩·실패·완료 표시는 실제 응답과 일치시키고, 실패 시 입력을 지우지 않는다.
- 메모리 데모 작품(`--mode mockup`·비 canonical)의 기존 데모 댓글 경로는 그대로 둔다.
- 실제 작품 본문의 문장 선택 팝업은 `댓글 달기`만 연다(피드백·공유는 실제 API가 없어 숨김). 500자를 넘는 인용 문장은 클라이언트가 거절한다.
- 작성·수정·삭제·좋아요 뒤에는 목록 전체를 다시 조회한다. 늦게 도착한 목록 응답은 기존 `useAsyncData`가 버리고, 로그인 계정이 바뀌면 목록을 다시 조회한다.
  익명이 작성을 시도하면 서버를 호출하지 않고 로그인 안내로 보낸다.
- 현재 `/read/:id/:n` 라우트가 로그인 필수라 익명 목록 열람은 화면에서 도달할 수 없다(API는 익명 허용). 비회원 공개 열람 라우트 정책은 이 기능 범위 밖이다.

## ponytail 한계

- 닉네임은 작성 시 스냅샷이라 이후 닉네임 변경이 기존 댓글에 반영되지 않는다. 필요하면 Core 회원 조회 API로 표시 시점 조회로 바꾼다.
- 목록은 최대 200개 고정이고 `likes` 정렬은 서비스 메모리에서 한다. 댓글이 많아지면 페이지네이션·DB 정렬로 바꾼다.
- 유해 필터·신고·숨김이 없어 등록 즉시 공개된다(DEC-22 MVP 범위).
