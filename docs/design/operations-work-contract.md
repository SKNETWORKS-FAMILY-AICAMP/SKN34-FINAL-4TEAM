# 운영 작품 조회 계약

기능표 운영 관리 서비스 **74 운영 작품 조회**의 MVP 계약이다. [서비스 경계](service-boundaries.md)대로 작품 정본·실제 제한은
Content가, 관리자 업무 권한은 운영 서비스가 소유한다. 인증·관리자 권한은 [운영 회원·관리자·신고 계약](operations-member-report-contract.md)의
회원 Bearer·`admin_permission`을 그대로 쓴다.

## 결정

- **조회 범위**: 공개·비공개·운영 제한 작품을 모두 보여 준다(원작·Fork 포함). 새 컬럼·마이그레이션은 없다.
- **표시 값**(작성자는 Core 닉네임 조회, 나머지는 Content 기존 데이터에서 계산):
  - 작성자: 소유자의 Core 최신 닉네임(없으면 `탈퇴한 회원`, [회차 댓글 계약](episode-comment-contract.md#core-회원-닉네임-조회-내부))
  - 종류: `work.origin_kind`(`original`→원작, `fork`→포크)
  - 권리: `work.creation_type`(`original`→원작, `external_derivative`→외부 2차 창작) + 권리 진술 확인 여부
    (`work_rights_declaration` 행이 하나라도 있으면 확인됨, 없으면 미확인)
  - 공개 상태: `restricted=true`→운영 제한, 아니면 최신 `work_publication_history.visibility`(`public`→공개, 없거나 `private`→비공개)
- **필터·검색·정렬**: 서버는 전체 목록을 한 번에 주고, 원작·Fork 필터, 작품명·작성자·권리 표시값 검색, 제목순·제목 역순 정렬은
  화면(기존 관리자 표 로직)이 계산한다.
- **조치**: 작품 행의 운영 제한/해제는 기존 Content 내부 제한 API(신고 34가 쓰는 것)를 재사용한다. 신고 사건·이력은 만들지 않는다.
  제한·해제는 [관리자 활동 기록(72)](operations-admin-activity-contract.md)에 남긴다.
- **관리자 권한**: Core `operator=true`이면서 운영 `admin_permission`의 `works` 권한(V4 시드에 이미 있음)이 있어야 한다.
  권한 확인은 Content 호출 전에 한다.

## Content 내부 API (서비스 토큰)

`X-Operations-Service-Token`만으로 인증한다(기존 `/internal/v1/**` 체인). 공개 진입점에 열지 않는다.

```text
OperationsWork = { workId, ownerId, title, authorName,
                   originKind: 'original'|'fork', creationType: 'original'|'external_derivative',
                   rightsConfirmed: boolean, visibility: 'public'|'private', restricted: boolean }
OperationsWorkList = { items: OperationsWork[] }
```

| 메서드·경로 | 동작 |
|---|---|
| `GET /internal/v1/works` | 소프트 삭제(DEC-42)되지 않은 전체 작품 `OperationsWorkList`, `title ASC, id ASC`. 삭제된 작품의 내부 조회·제한은 404다. 작품 수만큼 추가 조회하지 않는다(N+1 금지) |
| `GET /internal/v1/works/{id}` · `PUT`·`DELETE /internal/v1/works/{id}/restriction` | 기존 그대로 |

## 운영 공개 API (브라우저)

`/api/v1/operations/works` (회원 Bearer, `operator` + `works` 권한, 없으면 401/403). 오류는 기존 `{ code, message }`, Content 실패는 502.
경로 끝에 슬래시를 붙이지 않는다(`/api/v1/operations/works`, 끝 슬래시는 404).

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v1/operations/works` | Content 목록을 그대로 `OperationsWorkList`로 반환 |
| `PUT /api/v1/operations/works/{id}/restriction` | 운영 제한. 기존 `ContentWork = { workId, ownerId, title, restricted }` 반환, 없는 작품 404 |
| `DELETE /api/v1/operations/works/{id}/restriction` | 제한 해제. 응답 동일 |

## 콘텐츠 운영 관리 확장 (회차·세계관·카드 카테고리, 2026-11-23)

운영자가 작품 아래 회차, 공개 세계관(DEC-45), 세계관 카드 카테고리도 운영 화면에서 다룬다(사용자 결정). 운영 권한 키는 새로 만들지 않고 모두 `works`다.
운영자는 모든 작품을 **열람만** 하고 내용은 고치지 못한다(Content `operatorReading()`). 운영 조치는 운영 서비스 → Content 내부 API(서비스 토큰) 구조 그대로다.

| 운영 공개 API (`/api/v1/operations`, 회원 Bearer, `works`) | 동작 |
|---|---|
| `GET /works/{id}/episodes` | Content 내부 `GET /internal/v1/works/{workId}/episodes`의 **맨 배열**: `[{number,title,publicationStatus,restricted,inherited}]`(본문 없음, 번호순). 없는·삭제 작품 404 |
| `PUT`·`DELETE /works/{id}/episodes/{number}/restriction` | 그 회차 한 원소를 그대로. 상속 회차(Fork가 물려받은 회차)는 409 `EPISODE_INHERITED`(원작 회차를 제한해야 함), 없는 회차 404 |
| `GET /world-studios` | Content 내부 `GET /internal/v1/world-studios`의 맨 배열(`worldId·ownerId·name·visibility·published·restricted·genre·linkedWorkId·createdAt`)에 `ownerName`(Core 최신 닉네임, 목록에 없으면 null)만 더함 |
| `PUT`·`DELETE /world-studios/{id}/restriction` | 그 세계관 한 원소를 그대로(`ownerName` 없음). 없는·지운 세계관 404 |
| `GET`·`POST /card-categories`, `PATCH /card-categories/{code}`, `PUT /card-categories/order` | Content 내부 카드 카테고리 API 그대로(맨 배열, 숨김 포함·`position` 순, 삭제 없음). 추가 `{name, icon?}`는 201, 이름 중복 409 `CARD_CATEGORY_NAME_TAKEN`, 변경 `{name?, icon?, active?}`(`icon: ""`은 아이콘을 지움), 순서 `{codes}`는 전체 코드를 한 번씩(아니면 422) |

- 오류: Content의 400/404/409/422는 상태와 안내 문구·`code`를 그대로 전하고 그 밖의 실패는 502 `UPSTREAM_FAILED`다(장르와 같은 `keepMessage`). 권한 확인이 Content·Core 호출보다 먼저이고 서비스 트랜잭션은 없다. `ownerName`을 위한 Core 닉네임 조회가 실패하면 이름을 비운 채 내보내지 않고 502다.
- 회차 제한(Content 규칙): 독자 열람·조회수 기록·댓글은 404, 작가 집필은 유지, 그 회차를 상속한 Fork의 상속 회차도 숨기고 제한된 회차를 기준으로 새 Fork를 만들면 409다.
- 세계관 제한(Content 규칙): 공개 세계관 경로(목록·상세·카드 검색·이미지·가져오기)만 404이고 연결된 소설 위키·Fork 이어받기는 건드리지 않는다(작품은 작품 제한으로).
- 카드 카테고리: 기본 8종(`character`·`location`·`organization`·`ability`·`object`·`rule`·`event`·`other`)을 시드하고 운영자는 추가·이름·아이콘·순서·숨김만 한다(삭제 없음).
- 활동 기록(조치가 성공한 뒤): `episode.restrict`·`episode.unrestrict`(`episode` · `<작품 ID>:<회차 번호>` · 회차 제목), `world.restrict`·`world.unrestrict`(`world` · 세계관 ID · 세계관 이름), `card_category.create`·`card_category.update`(`card_category` · 코드 · 이름), `card_category.reorder`(`card_category` · `order` · 새 순서의 코드 목록). [활동 기록 계약](operations-admin-activity-contract.md)의 기존 대문자 값과 달리 소문자·점 표기다.
- 신고 대상도 작품·회차·세계관으로 넓혔다([신고 계약](operations-member-report-contract.md#신고-대상-작품회차세계관)).
- 실행 연결: 운영 `MemberSecurityConfig` 경로 목록에 `world-studios`·`card-categories`를 더한다(`works` 하위는 이미 있음). nginx·Vite에서도 두 경로(정확 일치·하위)를 운영 서비스로 열어야 한다.

## 실행 연결

- 운영 `MemberSecurityConfig` 경로 목록에 `works`를 추가한다.
- `frontend/nginx.conf`·`infrastructure/nginx.dev.conf`에 `/api/v1/operations/works`(정확 일치·하위)만 운영 서비스로 추가하고,
  Vite 프록시 정규식에 `works`를 넣는다.
- 관리자 `/admin?tab=works`는 실제 API를 쓰고 `LIVE_TABS`에 `works`를 넣어 데모 표기를 없앤다. 조치 후 목록을 다시 조회한다.
  `--mode mockup`은 메모리 구현을 등록한다.

## ponytail 한계

- 운영 작품 목록도 Core 닉네임 조회에 의존한다(캐시 없음, Core 장애 시 Content 503/504/502).

- 페이지네이션이 없다. 작품이 많아지면 서버 필터·페이지(`q`·`kind`·`sort`·`page`)로 옮긴다.
- 캐릭터챗 탭 등 다른 관리자 탭이 쓰는 데모 작품 목록(`AdminUseCase.load().works`)은 그대로 둔다. 작품 탭의 데모 `toggleWork`는
  화면 호출만 끊고, 다른 사용처가 없으면 그 메서드와 테스트를 지운다.
