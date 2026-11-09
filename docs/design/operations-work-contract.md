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
  관리자 활동 기록(72)은 미구현이라 남기지 않는다.
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
| `GET /internal/v1/works` | 전체 작품 `OperationsWorkList`, `title ASC, id ASC`. 작품 수만큼 추가 조회하지 않는다(N+1 금지) |
| `GET /internal/v1/works/{id}` · `PUT`·`DELETE /internal/v1/works/{id}/restriction` | 기존 그대로 |

## 운영 공개 API (브라우저)

`/api/v1/operations/works` (회원 Bearer, `operator` + `works` 권한, 없으면 401/403). 오류는 기존 `{ code, message }`, Content 실패는 502.
경로 끝에 슬래시를 붙이지 않는다(`/api/v1/operations/works`, 끝 슬래시는 404).

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v1/operations/works` | Content 목록을 그대로 `OperationsWorkList`로 반환 |
| `PUT /api/v1/operations/works/{id}/restriction` | 운영 제한. 기존 `ContentWork = { workId, ownerId, title, restricted }` 반환, 없는 작품 404 |
| `DELETE /api/v1/operations/works/{id}/restriction` | 제한 해제. 응답 동일 |

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
- 운영 제한 조치는 활동 기록(72)이 생기면 그때 기록한다.
