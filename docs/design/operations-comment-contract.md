# 운영 댓글 조회·조치 계약

기능표 운영 관리 서비스 **75 운영 댓글 조회·조치**의 MVP 계약이다. [서비스 경계](service-boundaries.md)대로 댓글 정본·실제 숨김은
Content가, 관리자 업무 권한은 운영 서비스가 소유한다. 구조는 [운영 작품 조회 계약](operations-work-contract.md)과 같고,
댓글 자체는 [회차 댓글 계약](episode-comment-contract.md)을 따른다.

## 결정 (2026-11-10 사용자 결정)

- **조회 범위**: 소프트 삭제(DEC-42)되지 않은 전체 댓글(공개·숨김 모두). 비공개·운영 제한 작품의 댓글도 포함하고, 소프트 삭제된 작품의 댓글은 뺀다.
- **조치 = 운영 숨김/게시 복구**: Content `episode_comment.hidden`(새 칸, 기본 `false`)을 켜고 끈다. 삭제가 아니라 언제든 복구할 수 있다.
  신고 사건·이력은 만들지 않는다. Content 호출이 성공한 뒤에만 [관리자 활동 기록](operations-admin-activity-contract.md)에
  `COMMENT_HIDE`·`COMMENT_UNHIDE`(대상 `COMMENT`·댓글 ID, 내역 = 작품 제목, 본문 저장 안 함)를 남기고, 실패한 요청은 기록하지 않는다.
  화면의 '숨김'은 확인 창을 거치고 '게시 복구'는 바로 보낸다.
- **숨긴 댓글의 독자 표시**: 목록·상세에서 빼지 않고 자리표시로 남긴다. 공개 응답은 `hidden: true`이고 `body`는 `""`,
  `quote`는 `null`로 내려 원문을 노출하지 않는다. 화면은 `운영 정책으로 숨겨진 댓글입니다.`를 보여 준다.
  숨긴 댓글의 수정·좋아요/취소는 409(본문 `{ detail, code: "COMMENT_HIDDEN" }`; `code`는 코드가 있는 실패에만 붙고 다른 Content 오류 응답은 그대로), 작성자 본인 삭제는 그대로 허용한다.
- **필터·검색·정렬**: 서버는 전체 목록을 한 번에 주고, 작품별 필터, 댓글 내용·작품명·작성자 검색, 공감(좋아요) 많은순·적은순 정렬은
  화면(기존 관리자 표 로직)이 계산한다. 공감 수 = `episode_comment_like` 행 수.
- **작성자 표시**: Core 최신 닉네임(없으면 `탈퇴한 회원`), 회차 댓글과 같은 일괄 조회(`CoreNicknameService`)를 쓴다.
- **관리자 권한**: Core `operator=true`이면서 운영 `admin_permission`의 `comments` 권한(V4 시드에 이미 있음). 권한 확인은 Content 호출 전에 한다.

## 저장

`backend/content-service/src/main/resources/db/migration/work/V30__episode_comment_hidden.sql`

```sql
ALTER TABLE episode_comment ADD COLUMN hidden boolean NOT NULL DEFAULT false;
```

## Content 공개 댓글 API 변경

`CommentResponse`에 `hidden: boolean`을 더한다. 기존 필드·경로는 그대로다. 숨긴 댓글은 `body: ""`, `quote: null`이고 나머지 값(작성자·공감 수·`mine` 등)은 그대로다.

## Content 내부 API (서비스 토큰)

`X-Operations-Service-Token`만으로 인증한다(기존 `/internal/v1/**` 체인). 공개 진입점에 열지 않는다.

```text
OperationsComment = { commentId, workId, workTitle, episodeNumber, authorId, authorName,
                      body, likeCount, hidden: boolean, createdAt }
OperationsCommentList = { items: OperationsComment[] }
```

| 메서드·경로 | 동작 |
|---|---|
| `GET /internal/v1/comments` | 위 조회 범위의 전체 댓글 `OperationsCommentList`, `createdAt DESC, id ASC`. 원문 `body`를 그대로 준다(숨김 포함). 공감 수·작품 제목은 일괄 조회(N+1 금지) |
| `PUT /internal/v1/comments/{id}/hidden` | 숨김. 이미 숨김이면 그대로(멱등). 해당 `OperationsComment` 반환. 없는·삭제된 댓글·삭제된 작품 댓글은 404 |
| `DELETE /internal/v1/comments/{id}/hidden` | 게시 복구. 응답·404 규칙 동일 |

`authorId`는 varchar 그대로 `String`이다(UUID가 아닐 수 있음).

## 운영 공개 API (브라우저)

`/api/v1/operations/comments` (회원 Bearer, `operator` + `comments` 권한, 없으면 401/403). 오류는 기존 `{ code, message }`, Content 실패는 502,
없는 댓글은 404. 경로 끝에 슬래시를 붙이지 않는다.

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v1/operations/comments` | Content 목록을 그대로 `OperationsCommentList`로 반환 |
| `PUT /api/v1/operations/comments/{id}/hidden` | 숨김. `OperationsComment` 반환 |
| `DELETE /api/v1/operations/comments/{id}/hidden` | 게시 복구. `OperationsComment` 반환 |

운영 DTO는 `commentId`·`workId`·`authorId`를 모두 `String`으로 받는다(목록 한 행의 비 UUID 값이 전체 502를 만들지 않게).
경로의 `{id}`도 UUID 검사 없이 Content에 넘기므로 형식이 틀린 ID는 400이 아니라 404다(작품 API는 400).

## 실행 연결

- 운영 `MemberSecurityConfig` 경로 목록에 `comments`를 추가한다.
- `frontend/nginx.conf`·`infrastructure/nginx.dev.conf`에 `/api/v1/operations/comments`(정확 일치·하위)만 운영 서비스로 추가하고,
  Vite 프록시 정규식에 `comments`를 넣는다. `infrastructure/ci/test_ci.py`의 고정 단언도 함께 고친다.
- 관리자 `/admin?tab=comments`는 실제 API를 쓰고 `LIVE_TABS`에 `comments`를 넣어 데모 표기를 없앤다. 표는 댓글·작품·작성자·공감·상태(게시/숨김)·조치
  (숨김/게시 복구)이며 조치 후 목록을 다시 조회한다. `--mode mockup`은 메모리 구현을 등록한다.
- 실제 작품 회차 댓글 목록은 `hidden` 댓글을 자리표시로 그리고, 그 댓글의 수정·좋아요 버튼을 숨긴다(작성자 삭제 버튼은 유지).

## ponytail 한계

- 페이지네이션이 없다. 댓글이 많아지면 서버 필터·페이지(`workId`·`q`·`sort`·`page`)로 옮긴다.
- 운영 댓글 목록도 Core 닉네임 조회에 의존한다(캐시 없음, Core 장애 시 Content 503/504/502).
- 작성자 알림·유해 필터(F-FBK-13) 자동 숨김은 범위 밖이다.
- Flyway는 V30이다(전역 V1~V30, V24만 결번).
- 관리자 대시보드 등 다른 탭이 쓰는 데모 `AdminUseCase` 댓글 데이터는 그대로 둔다. 댓글 탭의 데모 `toggleComment`는 화면 호출만 끊고,
  다른 사용처가 없으면 그 메서드와 테스트를 지운다.
