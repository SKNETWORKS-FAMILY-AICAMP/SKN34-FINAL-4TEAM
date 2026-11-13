# 작품 소식(공지) 계약

소설 상세(U04) 하단 카드의 **소식** 탭에 보이는 작품별 공지다. 사이트 전체 공지([운영 공지 계약](operations-notice-contract.md), 운영 서비스 소유)와 다르며,
작품에 딸린 콘텐츠이므로 [서비스 경계](service-boundaries.md)대로 **Content가 소유**한다.

## 결정 (2026-11-11 사용자 결정)

- 작성·수정·고정·삭제: **작품 소유자(작가)** 와 **운영자**(Core 인증 확인 결과 `operator=true`). 그 밖의 회원은 403, 익명은 401.
- 조회: 공개 작품(`WorkAccessService.published`)이면 익명도 목록을 본다. 비공개·운영 제한·소프트 삭제 작품은 404.
- 분류: `info`(안내)·`hiatus`(휴재)·`event`(이벤트). 고정(`pinned`)은 여러 개 가능하다.
- 삭제는 소프트 삭제(DEC-42): `deleted_at`만 기록하고 목록·수정·삭제에서 404로 제외한다.
- 등록·수정 시 회원 알림을 보내지 않는다. 예약 게시·첨부·댓글·조회 수는 범위 밖이다.
- 화면의 페이지 나눔(10개)은 클라이언트가 한다. 서버는 최대 200개를 돌려준다.

## 저장

`db/migration/work/V36__work_notice.sql`(열린 PR들이 V32~V35를 쓰므로 V36. 먼저 머지되는 쪽에 따라 병합 시 번호만 재조정한다.)

```sql
work_notice(
  id varchar(36) PK, work_id varchar(36) NOT NULL REFERENCES work(id), author_id varchar(200) NOT NULL,
  category text NOT NULL CHECK (category IN ('info','hiatus','event')),
  title text NOT NULL, body text NOT NULL, pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz
)  + INDEX (work_id) WHERE deleted_at IS NULL
```

## API

```text
WorkNoticeResponse = { id, workId, category: "info"|"hiatus"|"event", title, body, pinned, createdAt, updatedAt }   // 시각 UTC ISO-8601
WorkNoticeRequest  = { category, title, body, pinned }
```

| 메서드·경로 | 인증 | 동작 |
|---|---|---|
| `GET /api/v1/public/works/{id}/notices` | 익명 허용 | `{ "items": [WorkNoticeResponse] }` 고정 먼저, 그 안에서 `createdAt DESC, id DESC`, 최대 200개. 공개 작품이 아니면 404 |
| `POST /api/v1/works/{id}/notices` | 회원 + CSRF | 소유자·운영자만. 201 + `Location` + `WorkNoticeResponse`. 삭제된 작품 404 |
| `PUT /api/v1/works/{id}/notices/{noticeId}` | 회원 + CSRF | 전체 수정(고정 해제/설정 포함). `WorkNoticeResponse`. 다른 작품의 공지·삭제됨 404 |
| `DELETE /api/v1/works/{id}/notices/{noticeId}` | 회원 + CSRF | 204 소프트 삭제 |

- 검증(422, 권한·조회보다 먼저): 제목 1~200자, 본문 1~20,000자, 앞뒤 공백을 잘라 저장. 공백뿐(NBSP 포함)·U+0000 포함은 거절. 잘못된 `category` 422.
- 작품 소유자의 비공개 작품에도 쓸 수 있다(공개 전 준비). 공개 목록은 공개 작품에서만 보인다.
- 기존 보안 설정(`GET /api/v1/public/works/**` permitAll, `/api/v1/works/**` authenticated, CSRF)을 그대로 쓴다.
- 운영자 판정: Core `POST /internal/v1/auth/verify` 응답의 기존 `operator` 필드를 Content `VerifiedMemberResponse`가 함께 읽어 인증 객체에 담는다(Core 변경 없음).

## 화면 연결

- 실제 작품(`canonical`)의 소식 탭은 위 API를 쓴다(목록·작성·수정·고정/해제·삭제, 로딩·실패·재시도는 실제 응답과 일치, 실패 시 입력 유지).
  관리 버튼은 소유자(`isMine` 또는 `owner === memberId`)와 운영자(`role === 'admin'`)에게만 보이며 권한은 서버가 다시 확인한다.
- `--mode mockup`·메모리 데모 작품은 기존 메모리 소식 데모를 유지하고 "데모 소식" 안내를 둔다.
