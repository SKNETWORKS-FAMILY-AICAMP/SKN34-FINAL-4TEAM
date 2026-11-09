# 운영 공지 계약

기능표 운영 관리 서비스 **68 공지 게시·조회**의 MVP 계약이다. [서비스 경계](service-boundaries.md)대로 공지는 운영 서비스가 소유한다.
인증·관리자 권한은 [운영 회원·관리자·신고 계약](operations-member-report-contract.md)의 회원 Bearer·`admin_permission`을 그대로 쓴다.

## 결정

- **저장**: 기존 `operations.notice`(V1)와 `NoticeService`의 검증(제목 1~200자·본문 1~20,000자·공백만/U+0000 거절)을 재사용한다.
  새 컬럼·마이그레이션은 없다.
- **게시 상태**: 별도 발행·예약 상태를 두지 않는다. 관리자가 등록한 공지는 즉시 공개 공지다. 삭제하면 공개 목록에서도 사라진다.
- **관리자 권한**: Core `operator=true`이면서 운영 `admin_permission`의 `notices`(공지 게시) 권한이 있어야 한다.
- **독자 조회**: 인증 없이 누구나 목록·상세를 읽는다. 쓰기 경로는 없다.
- **알림**: 공지 등록 시 회원 알림을 보내지 않는다.
- **기존 서비스 토큰 API**: `/api/v1/operations/notices/**`는 그대로 두고 공개 진입점에 노출하지 않는다.
- **화면**: 관리자 "공지" 탭의 운영 레코드 메모리 패널과 legacy '공지 게시' 데모를 제거하고 실제 API 패널 하나로 바꾼다.
  회원 `/me/notice` 목록·상세도 공개 API로 바꾼다. `/me/event`는 데모로 남는다.

## 운영 공개 API (브라우저)

오류는 기존 `{ code, message }`다. 시각은 UTC ISO-8601이다.

```text
Notice = { id, title, body, createdAt, updatedAt }          // 기존 NoticeResponse
NoticeList = { items: Notice[], page, size, totalElements, totalPages }   // 기존 NoticeListResponse
```

관리자 `/api/v1/operations/admin/notices` (회원 Bearer, `operator` + `notices` 권한, 없으면 401/403)

| 메서드·경로 | 동작 |
|---|---|
| `GET /` | 최신순(`createdAt DESC, id DESC`) 최대 100개 `NoticeList` |
| `GET /{id}` | `Notice`, 없으면 404 |
| `POST /` | `{ title, body }` 등록, 201 + `Location` + `Notice`. 입력 오류 400 |
| `PUT /{id}` | `{ title, body }` 전체 수정, `Notice`. 없음 404·입력 오류 400 |
| `DELETE /{id}` | 204, 없음 404 |

독자 `/api/v1/operations/public/notices` (인증 없음, GET만)

| 메서드·경로 | 동작 |
|---|---|
| `GET /` | 최신순 최대 100개 `NoticeList` |
| `GET /{id}` | `Notice`, 없으면 404 |

형식이 틀린 id는 400이며 독자 화면은 404와 같이 "공지를 찾을 수 없어요"로 표시한다. GET 이외 메서드는 거절한다(403 또는 405). 서비스 토큰·Bearer가 있어도 의미가 바뀌지 않는다.

## 실행 연결

- 운영 서비스 `MemberSecurityConfig`의 회원 Bearer 경로 목록에 `admin/notices`를 추가한다.
- `/api/v1/operations/public/notices`와 하위 경로는 별도 SecurityFilterChain에서 GET만 `permitAll`, 나머지 거절한다.
  서비스 토큰 체인은 그대로 다른 모든 경로를 소유한다.
- nginx(`frontend/nginx.conf`, `infrastructure/nginx.dev.conf`)·Vite 프록시에 `/api/v1/operations/admin/notices`,
  `/api/v1/operations/public/notices`와 하위 경로만 운영 서비스로 추가한다. `/api/v1/operations/notices`는 열지 않는다.
- 프런트: 공지 전용 `NoticeRepository`·`NoticeUseCase`·`HttpNoticeRepository`를 두고 `registerAppServices`에 등록한다.
  `--mode mockup`은 `registerMockupServices`에 메모리 구현을 등록한다.

## ponytail 한계

- 목록은 최신 100개까지만 보인다. 페이지 이동은 공지가 늘면 추가한다.
- 동시 수정은 마지막 저장이 이긴다(응답에 버전이 없음). 충돌 감지가 필요하면 응답·요청에 `version`을 추가한다.
- 예약 게시·고정 공지·숨김 상태가 없다. 필요하면 `notice`에 상태 컬럼을 추가한다.
- 관리자 화면의 기존 운영 메모리 저장소(`OperationsUseCase`)에 남은 공지 메서드는 문의(#67) 작업과의 충돌을 피하려고 이번에 지우지 않는다.
  두 작업이 병합된 뒤 정리한다.
