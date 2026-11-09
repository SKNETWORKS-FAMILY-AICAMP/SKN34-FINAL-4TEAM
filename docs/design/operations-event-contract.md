# 운영 이벤트 계약

기능표 운영 관리 서비스 **69 이벤트 안내·운영**의 MVP 계약이다. [서비스 경계](service-boundaries.md)대로 이벤트는 운영 서비스가 소유한다.
인증·관리자 권한은 [운영 회원·관리자·신고 계약](operations-member-report-contract.md)의 회원 Bearer·`admin_permission`을 그대로 쓴다.
구조는 [운영 공지 계약](operations-notice-contract.md)과 같다.

## 결정

- **저장**: 기존 `operations.event`(V2)와 `EventService`의 검증(제목 1~200자·본문 1~20,000자·공백만/U+0000 거절·
  종료가 시작보다 빠르면 400·기간 선택)을 재사용한다. 새 컬럼·마이그레이션은 없다.
- **진행 상태**: 상태 컬럼·전이 API가 없다. 프런트 Domain 순수 함수가 `startsAt`·`endsAt`과 현재 시각으로 계산한다.
  - 둘 다 없음 → `상시`(always)
  - `startsAt`이 있고 현재 < `startsAt` → `예정`(upcoming)
  - `endsAt`이 있고 현재 ≥ `endsAt` → `종료`(ended)
  - 그 밖 → `진행 중`(ongoing)
  - 관리자가 이벤트를 끝내려면 종료 시각을 수정한다(별도 '종료' 버튼 없음).
- **관리자 권한**: Core `operator=true`이면서 운영 `admin_permission`의 `events` 권한이 있어야 한다.
- **독자 조회**: 인증 없이 누구나 목록·상세를 읽는다. 종료 이벤트도 상태와 함께 보인다. 쓰기 경로는 없다.
- **게시**: 별도 발행·예약 상태가 없다. 등록 즉시 공개, 삭제 즉시 공개 목록에서도 사라진다. 알림은 보내지 않는다.
- **기존 서비스 토큰 API**: `/api/v1/operations/events/**`는 그대로 두고 공개 진입점에 노출하지 않는다.
- **화면**: 관리자 "이벤트" 탭의 운영 레코드 메모리 패널(`OperationsEvents`)과 legacy '이벤트' 데모(`LegacyEvents`)를
  실제 API 패널 하나로 바꾼다. 회원 `/me/event` 목록·상세도 공개 API로 바꾼다.

## 운영 공개 API (브라우저)

오류는 기존 `{ code, message }`다. 시각은 UTC ISO-8601이다.

```text
Event = { id, title, body, startsAt|null, endsAt|null, createdAt, updatedAt }   // 기존 EventResponse
EventList = { items: Event[], page, size, totalElements, totalPages }          // 공통 PageResponse<Event>
EventInput = { title, body, startsAt?|null, endsAt?|null }                     // 기존 EventRequest
```

관리자 `/api/v1/operations/admin/events` (회원 Bearer, `operator` + `events` 권한, 없으면 401/403)

| 메서드·경로 | 동작 |
|---|---|
| `GET /` | 최신 등록순(`createdAt DESC, id DESC`) 최대 100개 `EventList` |
| `GET /{id}` | `Event`, 없으면 404 |
| `POST /` | `EventInput` 등록, 201 + `Location` + `Event`. 입력 오류 400 |
| `PUT /{id}` | `EventInput` 전체 수정(생략한 기간은 비움), `Event`. 없음 404·입력 오류 400 |
| `DELETE /{id}` | 204, 없음 404 |

독자 `/api/v1/operations/public/events` (인증 없음, GET만)

| 메서드·경로 | 동작 |
|---|---|
| `GET /` | 최신 등록순 최대 100개 `EventList` |
| `GET /{id}` | `Event`, 없으면 404 |

GET 이외 메서드는 거절한다(403 또는 405). 서비스 토큰·Bearer가 있어도 의미가 바뀌지 않는다.

## 실행 연결

- 운영 서비스 `MemberSecurityConfig`의 회원 Bearer 경로 목록에 `admin/events`를 추가한다.
- `/api/v1/operations/public/events`와 하위 경로는 공개 공지 조회와 같은 별도 SecurityFilterChain(`PublicSecurityConfig`)에서
  GET만 `permitAll`, 나머지 거절한다. 서비스 토큰 체인은 그대로 다른 모든 경로를 소유한다.
- nginx(`frontend/nginx.conf`, `infrastructure/nginx.dev.conf`)·Vite 프록시에 `/api/v1/operations/admin/events`,
  `/api/v1/operations/public/events`와 하위 경로만 운영 서비스로 추가한다. `/api/v1/operations/events`는 열지 않는다.
- 프런트: 이벤트 전용 `EventRepository`·`EventUseCase`·`HttpEventRepository`를 두고 `registerAppServices`에 등록한다.
  `--mode mockup`은 `registerMockupServices`에 메모리 구현을 등록한다.

## ponytail 한계

- 목록은 최신 100개까지만 보인다. 페이지 이동은 이벤트가 늘면 추가한다.
- 동시 수정은 마지막 저장이 이긴다(응답에 버전이 없음). 충돌 감지가 필요하면 응답·요청에 `version`을 추가한다.
- 진행 상태는 브라우저 시계로 계산한다. 서버 기준 상태 필터·정렬이 필요하면 서버 계산 필드를 추가한다.
- 참여·보상·관련 기능 이동(기능표 70)은 범위 밖이다.
- 관리자 화면의 기존 운영 메모리 저장소(`OperationsUseCase`)에 남은 이벤트 메서드는 공지(#68)·문의(#67) 작업과의 충돌을 피하려고
  화면 연결만 끊고 지우지 않는다. 세 작업이 병합된 뒤 정리한다.
