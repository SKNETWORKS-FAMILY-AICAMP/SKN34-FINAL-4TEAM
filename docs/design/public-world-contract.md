# 공개 세계관 계약

[메인 README](../../README.md) · [문서 목록](../README.md)

세계관 소유자가 **세계관 단위로 공개**를 켜면 비로그인 포함 누구나 읽기 전용으로 볼 수 있는 API의 계약이다.
설정 카드 단위 공개, 세계관-소설 1:1 연결, 독자 설정 위키, 설정 가져오기의 카드 메타데이터(DEC-46)도 이 문서가 정한다.
저장과 API는 [서비스 경계](service-boundaries.md)대로 **Content가 소유**하고, 작가 닉네임은 Core에서 조회한다.
결정은 [DEC-45·DEC-46](decisions.md), 저장 구조·관계 정본은 [WorldStudio 설계](worldstudio-independent-schema.md)를 따른다.
백엔드와 프론트엔드가 같은 계약을 쓰며, 서버 소스 구현은 끝났지만 **hosted CI의 통합 테스트는 아직 확인하지 않았다**.

## 확정 정책 (2026-11-11 사용자 결정)

- 공개 범위는 **세계관 단위** `visibility: private | public`이며 기본은 `private`다.
- 공개된 세계관은 **비로그인 포함 누구나** 읽기 전용으로 본다: 이름·설명·장르·작가 닉네임 + **마지막 저장 버전(`world_revision`)의 공개 설정 카드** + **그 카드끼리의 현재 관계(Neo4j 현재 상태)**. 어떤 카드가 공개 카드인지는 아래 카드 단위 공개 항목이 정한다.
- 비공개로 바꾸면 즉시 공개 목록·상세에서 제외한다(상세는 404).
- 저장 버전(revision)이 하나도 없는 세계관은 공개로 설정돼 있어도 목록·상세에 나오지 않는다(초안은 공개하지 않는다).
- **초안 저장과 확정 버전은 다르다.** 이 문서의 '저장 버전'은 소유자가 명시적으로 확정한 `world_revision`(`POST /{id}/revisions`, 세계관의 `current_revision_id`)이다. 화면의 '저장'(`PUT /{id}/draft`)은 초안 저장이라 공개 화면에 반영되지 않으며, 공개 목록·상세의 노출은 **확정 버전(current revision) 기준**이다. 목록과 상세는 모두 확정(`sealed`)된 현재 버전만 보인다.
- 파생·조합(세계관 복사)과 남의 세계관을 참조·추종하는 이용은 없다(DEC-35 유지). 세계관 이용은 참조 연결 없이 공개 카드를 카드 단위로 내 세계관에 복사하는 **설정 가져오기**로 하고(2026-11-12 사용자 결정: 공개 세계관의 공개 카드는 로그인한 누구나 가져올 수 있고 출처를 자동으로 표시한다), 세계관과 소설은 1:1로 연결한다(DEC-46). 아래 '세계관-소설 1:1 연결'·'독자 설정 위키'·'설정 가져오기와 카드 메타데이터' 절이 계약이다. 공개 세계관 응답에는 연결된 소설이 없다.
- **설정 카드는 카드 단위로 공개·비공개를 정하며 기본은 비공개다**(`setting_card_*.visibility`, DEC-46, 2026-11-12 사용자 결정). 공개 세계관에서도 **삭제되지 않았고(`lifecycle=active`) 공개(`visibility=public`)인 카드만** 보이고, 관계는 양 끝 카드가 모두 그런 카드일 때만 보인다. 목록의 `cardCount`·`relationshipCount`도 같은 기준이다. 공개 카드가 하나도 없는 공개 세계관도 목록·상세에는 그대로 나온다(카드 0개).
- **세계관 표지는 소유자가 직접 올린 이미지(PNG·JPEG·WebP, 5MB 이하)만 쓴다**(2026-11-12 사용자 결정). AI 표지 생성은 준비 중이라 이 계약에 없다. 표지가 없으면 화면이 기존 자동 생성 표지를 쓴다. 공개 표지의 노출 기준은 상세와 같다(공개이고 확정 버전이 있을 때).

장르 코드(소유자가 공개할 때 고른다, 미지정은 `null`):

| 코드 | 이름 | 코드 | 이름 |
|---|---|---|---|
| `fantasy` | 판타지 | `modern` | 현대 |
| `sf` | SF | `classic` | 고전 |
| `wuxia` | 무협 | `mystery` | 미스터리 |
| `romance` | 로맨스 | | |

## 저장

WorldStudio 전용 마이그레이션 `backend/content-service/src/main/resources/db/migration/worldstudio/V6__world_publication.sql`이다.
V6은 `world_studio_schema_history`의 다음 번호이며 Content 전역 마이그레이션 번호와 무관하다. 기존 행은 모두 비공개로 남고 다른 데이터는 바꾸지 않는다.

```sql
ALTER TABLE worldstudio.world
    ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
    ADD COLUMN genre text CHECK (genre IN ('fantasy','sf','wuxia','romance','modern','classic','mystery')),
    ADD COLUMN published_at timestamptz,
    ADD CONSTRAINT world_published_at_matches_visibility CHECK ((visibility = 'public') = (published_at IS NOT NULL));
```

`published_at`은 세계관이 **마지막으로 공개된 시각**이며 비공개이면 `NULL`이다. 비공개→공개로 바뀔 때만 새로 찍고, 공개 중에 장르만 바꾸면 유지한다(목록 순서가 바뀌지 않는다).

표지는 다음 번호 `V7__world_cover.sql`이다. 이미지 바이트는 설정 첨부·작품 표지와 같은 객체 저장소(MinIO/S3, `AttachmentStorageClient`)에 `world-covers/<UUID>` 키로 두고 DB에는 키와 형식만 둔다. 기존 행은 모두 표지 없음으로 남고 다른 데이터는 바꾸지 않는다.

```sql
ALTER TABLE worldstudio.world
    ADD COLUMN cover_object_key text,
    ADD COLUMN cover_content_type text CHECK (cover_content_type IN ('image/png','image/jpeg','image/webp')),
    ADD CONSTRAINT world_cover_key_matches_type CHECK ((cover_object_key IS NULL) = (cover_content_type IS NULL));
```

## 소유자 API (인증·CSRF 필요, 기존 `/api/v1/world-studios` 보안 규칙 그대로)

```text
PublicationRequest  = { "visibility": "public" | "private", "genre": "<code>" | null }
PublicationResponse = { "worldId", "visibility", "genre", "publishedAt": ISO | null, "listed": boolean }
WorldCoverResponse  = { "worldId", "hasCover": true }
```

| 메서드·경로 | 동작 |
|---|---|
| `PUT /api/v1/world-studios/{id}/publication` | 소유자만 공개 범위·장르를 바꾼다. 소유자가 아니면 404(기존 관례), 값 오류는 422 `WORLD_INPUT_INVALID`. 200 + `PublicationResponse` |
| `PUT /api/v1/world-studios/{id}/cover` | 소유자만 표지를 저장·교체한다. multipart `file`(PNG·JPEG·WebP, 5MB 이하). 200 + `WorldCoverResponse`, 비소유자 404, 값 오류 422 `WORLD_INPUT_INVALID` |
| `DELETE /api/v1/world-studios/{id}/cover` | 소유자만 표지를 지운다. 204(표지가 없어도 204), 비소유자 404 |
| `GET /api/v1/world-studios/{id}/cover` | 소유자만 표지 이미지 바이트를 읽는다. 표지가 없으면 404, 비소유자 404 |

- `listed`는 지금 공개 목록·상세에 실제로 나오는지다. **저장 버전이 없는 세계관을 `public`으로 바꾸는 것은 허용**하되 `listed: false`로 알린다.
- 소유자 관리 화면(`/worldstudio/:worldId`)은 새 세계관 만들기 직후 이동한 주소(`?new=1`)일 때만 4단계 작성 모드를 보이고, 첫 저장이 성공하면 쿼리를 지워 관리 모드로 바꾼다. 그 밖의 진입(관리하기·직접 주소, 저장한 적 없는 세계관 포함)은 모두 관리 모드이고 두 화면이다: **설정집 화면**(기본, 헤더 아래 보기 전환 줄 설정집·인물 관계도·시간선은 주소 `?view=people|timeline`, 설정집은 공개 설정집과 같은 게시판, `AI 후보 검토 (대기 N)` 시트·`집필 메모 추가`·`확정 버전 남기기`(확정 버전 시트)와 상시 저장 영역)과 **편집 화면**(주소 `?card=<id>`, 집필실과 같은 3단: 설정 카드 목록·확정 버전을 보이는 버전 그래프 레일 / 편집기 / AI 채팅, `← 설정집`·뒤로가기로 돌아옴). 설정 카드 삭제는 유형과 상관없이 이어진 관계를 함께 지우는 초안 변경이라 세계관 저장으로 서버에 반영한다. 옛 `?tab=`은 보기·시트로 옮겨 열고, 세계관 탐색 탭은 없다. 공개 설정은 두 모드 모두 초안 저장과 별개로 바로 적용되고, 확정 버전이 없어 `listed: false`이면 화면이 '확정 버전을 남기면 공개 목록에 나타난다'고 알린다. 설정 카드 공개(DEC-46)는 이 화면에서 정한다: 설정집 게시판은 카드마다 `공개` 칸을 보이고 고른 줄을 `선택 공개`·`선택 비공개`로, 설정집의 카드 전부를 `전체 공개`로 바꾸며, 편집 화면의 `공개 범위` 구획에서 `이 설정 공개`와 `독자 공개 [ ]화부터`(연결된 소설이 있을 때만 입력, 비우면 독자에게 숨김, 1 이상의 정수가 아니면 저장을 막음)를 정한다. 공개(로 고른) 세계관인데 초안에 공개 카드가 없으면 경고와 `전체 공개`를 관리 헤더·정보 편집 패널·작성 모드 공개 설정에 보이되 공개 설정 저장은 막지 않는다(정보 편집 패널의 저장은 이름·설명을 바꿨고 저장하지 않은 초안 변경이나 저장 전 확인 항목이 있을 때만 잠긴다). 헤더에는 연결 상태 줄(`연결된 소설: {제목}` 또는 `연결된 소설이 없어요.`, 정보만)과 소설 버튼 한 자리(연결돼 있으면 그 작품 관리로 가는 `소설 작성하기`, 없으면 `소설 연결하기`)가, 게시판에는 `다른 세계관에서 가져오기`가 있다(아래 절). **카드 공개·독자 공개 회차·가져온 카드는 모두 초안 값**이라 세계관 저장과 `확정 버전 남기기`를 거쳐야 공개 세계관 화면·독자 설정 위키에 반영되고 화면이 도움말로 그렇게 알린다.
- 값 검사는 소유 확인보다 먼저 한다(기존 `create`·`edit`과 같다). `visibility` 누락·알 수 없는 값·알 수 없는 `genre`는 422이고, 코드는 대소문자·공백까지 정확히 맞아야 한다.
- 카드·관계·revision·잠금·이력은 건드리지 않는다. 같은 요청을 다시 보내도 결과가 같다(`publishedAt` 유지).
- 표지 형식은 파일명·보낸 `Content-Type`이 아니라 **실제 바이트**로 정한다. PNG·JPEG는 설정 첨부 이미지와 같은 디코딩 검사(가로·세로 4096px 이하)를 거치고, WebP는 RIFF 컨테이너 구조(시그니처·전체 크기·첫 chunk)만 확인한다. 비었거나 5MB를 넘거나 `file` 파트가 없거나 알 수 없는 형식·깨진 이미지는 422 `WORLD_INPUT_INVALID`이며 `detail`에 사유가 있다. 값 검사는 소유 확인보다 먼저다. 요청 전체가 nginx 6MB나 Content의 multipart 한도(50MB)를 넘으면 값 검사 전에 413으로 막히고(기존 첨부와 같은 오류), 그 사이의 5MB 초과는 422다.
- 표지 교체는 **새 객체 저장 → DB 갱신 → 이전 객체 삭제** 순서다. 새 객체 저장이 실패하면 DB와 이전 객체는 그대로이고(503), 이전 객체 삭제가 실패하면 로그만 남기고 성공으로 답한다. 삭제는 DB 참조를 먼저 지우고 객체를 그 다음에 지운다. 객체 저장소 오류는 고정 문구의 503 그대로 전한다.
- 소유자 표지 읽기는 `Cache-Control: private, no-store`·`X-Content-Type-Options: nosniff`이다. 소유자 화면은 Bearer가 필요해 인증 fetch → Blob → objectURL(해제 포함)로 읽는다.
- 기존 `GET /api/v1/world-studios`(내 목록) 요약과 `GET /api/v1/world-studios/{id}` 응답에 `visibility`, `genre`, `hasCover`(표지가 있는지) 필드가 **추가**됐다(기존 필드는 그대로).

## 공개 API (비로그인 허용 `GET`)

```text
PublicWorldPageResponse = { "items": [PublicWorldSummary], "page", "size", "total" }
PublicWorldSummary = { "id", "name", "description", "genre": code | null, "authorNickname",
                       "cardCount", "relationshipCount", "publishedAt", "hasCover": boolean }
PublicWorld        = { "id", "name", "description", "genre", "authorNickname", "publishedAt", "revisionNo",
                       "cards": [ { "id", "title", "text", "cardType", "aliases": [..], "tags": [..] } ],
                       "relationships": [ { "id", "sourceCardId", "targetCardId", "label" } ],
                       "relationshipStatus": "current" | "unavailable", "hasCover": boolean }
```

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v1/public/world-studios?genre=<code>&page=0&size=24` | 공개이고 저장 버전이 있는 세계관만 `published_at` 최신순(같은 시각은 `id`순)으로 반환한다. `genre`를 생략하면 전체다 |
| `GET /api/v1/public/world-studios/{id}` | 비공개·없음·저장 버전 없음은 404. 그 밖에는 마지막 저장 버전의 공개 카드와 그 카드끼리의 현재 관계를 반환한다 |
| `GET /api/v1/public/world-studios/{id}/cover` | 상세와 같은 기준(공개이고 확정 버전이 있는 세계관)일 때만 표지 이미지 바이트를 반환한다. 비공개·확정 버전 없음·표지 없음·없는 세계관은 404 |

- `cards`는 마지막 `world_revision`의 카드 버전 중 공개 카드(`lifecycle=active`·`visibility=public`)의 내용이다. `id`는 카드 논리 ID로 관계의 양 끝이 가리키고, `cardType`은 기존 WorldStudio 카드 유형 코드(`character`·`location`·`organization`·`ability`·`object`·`rule`·`event`·`other`) 그대로다(프론트의 기존 라벨 매핑을 쓴다).
- `relationships`는 Neo4j **현재** 관계 중 **양 끝 카드가 위 `cards`에 있는 것**만이다. 저장하지 않은 새 카드나 삭제된 카드·비공개 카드를 가리키는 관계는 나오지 않는다. `label`은 기존 관계 필드의 표시 라벨이다.
- 관계 저장소가 현재 상태를 보증하지 못하면(미전환·미완료·조회 실패·토큰 불일치) 카드는 그대로 두고 `relationships: []`, `relationshipStatus: "unavailable"`로 200을 돌려준다(500이 아니다). 정상이면 `"current"`다.
- 작가 닉네임은 저장하지 않고 응답마다 `CoreNicknameService`로 회원 ID 묶음을 한 번 조회해 채운다. Core에 없으면 `탈퇴한 회원`이고, Core 호출 실패는 대체 이름 없이 503/504/502로 그대로 전한다.
- 상세의 `id`가 UUID 형식이 아니면 400, 형식이 맞는데 없으면 404다.
- 표지 응답의 `Content-Type`은 저장한 형식(`image/png`·`image/jpeg`·`image/webp`)이고 `Cache-Control: private, no-store`·`X-Content-Type-Options: nosniff`이다(기존 작품 공개 표지와 같은 관례). 화면은 `hasCover`가 `true`일 때만 `<img src="/api/v1/public/world-studios/{id}/cover">`로 직접 읽고, `false`이면 기존 자동 생성 표지를 쓴다. `id`가 UUID 형식이 아니면 400이다.

### 라우팅·보안

- Content `ContentSecurityConfig`에서 `GET /api/v1/public/world-studios`와 `/api/v1/public/world-studios/**`를 `permitAll`로 연다. 다른 메서드는 기존대로 거부한다.
- 공개 진입점의 라우팅은 `public/world-studios`(정확 경로와 하위 경로)를 Content(8081)로 보낸다. `frontend/nginx.conf`·`frontend/vite.config.ts` 프록시와 CI·개발용 `infrastructure/nginx.dev.conf`에 이미 반영돼 있고, 정적 검사 `infrastructure/ci/test_ci.py`의 `test_public_world_studio_routes_go_to_content`가 고정한다.
- 소유자 표지 업로드(최대 5MB multipart)를 위해 nginx `location ^~ /api/v1/world-studios/`에 `client_max_body_size 6m;`를 둔다(`proxy_pass` 다음 줄이며 `frontend/nginx.conf`·`infrastructure/nginx.dev.conf` 둘 다). nginx 기본값은 1MB라 이 설정이 없으면 1MB를 넘는 표지를 nginx가 413으로 막는다. 공개 `GET`은 본문이 없어 `public/` 위치는 그대로다. Vite 개발 프록시는 본문 크기를 제한하지 않고 Content의 multipart 한도(50MB)는 표지 5MB보다 넉넉하다.
- 연결 `PUT /api/v1/works/{id}/world-studio`와 독자 설정 위키 `GET /api/v1/public/works/{id}/world-cards`(아래 두 절)는 새 location 없이 기존 `/api/v1/works/`·`/api/v1/public/works/` 접두 규칙으로 Content에 간다(`frontend/nginx.conf`·`infrastructure/nginx.dev.conf`·`frontend/vite.config.ts` 변경 없음). 독자 설정 위키는 `ContentSecurityConfig`의 기존 `GET /api/v1/public/works/**` `permitAll`로 비로그인에 열려 있다. 정적 검사 `infrastructure/ci/test_ci.py`의 `test_work_world_link_and_reader_wiki_routes_go_to_content`가 고정한다.

## 세계관-소설 1:1 연결 (DEC-46)

세계관(WorldStudio) 하나는 소설 하나에만 연결하고 소설도 세계관 하나만 연결한다. 남의 세계관을 참조 연결하거나 따라가는 연결은 없다.
연결의 정본은 Content 전역 마이그레이션 `backend/content-service/src/main/resources/db/migration/work/V37__work_world_studio.sql`의 `work.world_studio_id` 하나다(`WorkWorldController`·`WorkWorldService`).

```sql
ALTER TABLE work ADD COLUMN world_studio_id uuid UNIQUE;
```

값은 `worldstudio.world.id`이며 연결이 없으면 `NULL`이다. worldstudio는 별도 Flyway 이력이라 FK를 두지 않고, UNIQUE가 '한 세계관은 한 작품에만'을 지킨다. 기존 행은 모두 미연결로 남는다.

```text
WorkWorldLinkRequest  = { "worldId": "<uuid>" | null }
WorkWorldLinkResponse = { "workId": "<작품 id>", "worldId": "<uuid>" | null }
```

| 메서드·경로 | 동작 |
|---|---|
| `PUT /api/v1/works/{id}/world-studio` | 소유자가 작품에 자기 세계관을 연결한다(`worldId: null`은 해제). 200 + `WorkWorldLinkResponse` |

- 인증·CSRF는 기존 `/api/v1/works/**` 규칙 그대로다(비로그인 401, CSRF 없음 403).
- **작품과 세계관이 모두 요청자 소유**여야 한다. 세계관이 없거나 남의 것이면 404(`세계관을 찾을 수 없어요.`), 작품이 없거나 남의 것이거나 삭제됐으면 404(`작품을 찾을 수 없어요.`)이고 세계관 확인이 먼저다. `worldId`가 UUID 형식이 아니면 400이다.
- 그 세계관이 이미 **다른** 작품에 연결돼 있으면 409이고 본문은 `{ "detail": "이미 다른 소설에 연결된 세계관이에요.", "code": "WORLD_ALREADY_LINKED" }`다. 판정은 사전 조회 없이 UNIQUE 제약 위반으로 하므로 동시 요청도 같은 답을 받고 기존 연결은 그대로다.
- 같은 세계관을 다시 연결해도 200이다(멱등). 작품이 다른 세계관에 연결돼 있었으면 새 세계관으로 바뀐다. `worldId: null`(본문 `{}` 포함)은 해제이며 연결이 없어도 200이다.
- 연결·해제는 작품 `revision`을 올리지 않는다. **작품을 소프트 삭제하면 연결도 해제한다**(보이지 않는 삭제 작품이 UNIQUE를 쥐고 있으면 그 세계관을 다시 연결할 수 없다).
- 소유자 응답이 서로를 알린다. 소유자 작품 응답(`GET /api/v1/works`·`/{id}` 등 `WorkResponse`를 주는 소유자 경로)에 `worldStudioId`(연결이 없으면 `null`)가, 소유자 세계관 응답(`GET /api/v1/world-studios`의 요약과 `GET /{id}`·`PUT /{id}/draft`·`POST`의 초안 응답)에 `linkedWorkId`(없으면 `null`)가 **추가**됐다(기존 필드는 그대로). 공개 작품 응답(`/api/v1/public/works…`)의 `worldStudioId`는 항상 `null`이다.
- 화면: 작품 관리(`/content?work=<id>`)의 세계관·설정집 탭 `세계관 연결`에서 다른 소설에 연결되지 않은 내 세계관을 골라 연결하고 `연결 해제`(확인 뒤)로 푼다. 세계관 관리 화면(`/worldstudio/:id`) 헤더의 `소설 연결하기`는 세계관에 연결되지 않은 내 소설을 골라 같은 API로 연결하며(초안 저장과 별개로 바로 적용) 연결되면 같은 자리가 그 작품 관리(`/content?work=<id>`)로 가는 `소설 작성하기`로 바뀐다. 그 시트의 `새 소설 만들기`는 작품 만들기(`/content`)로 갈 뿐이라 만든 소설은 자동으로 연결되지 않는다. 해제는 작품 관리 화면에서만 한다. 두 화면 모두 실패는 서버 문구를 그대로 보인다.

## 독자 설정 위키 (DEC-46)

소설에 연결된 세계관의 설정 카드 가운데 **독자에게 공개된 것만** 서버가 걸러 준다(화면에서 거르지 않는다). 독자 공개는 카드의 독자 공개 회차('N화부터')로 정하며 연결된 소설의 **발행된 회차** 기준이다.

```text
ReaderWorldCards = { "workId", "worldId": "<uuid>" | null, "upto": <적용된 기준 회차>,
                     "cards": [ { "id", "title", "text", "cardType", "aliases": [..], "tags": [..], "revealFromEpisode": n } ],
                     "relationships": [ { "id", "sourceCardId", "targetCardId", "label" } ],
                     "relationshipStatus": "current" | "unavailable" }
```

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v1/public/works/{id}/world-cards?upto=N` | 비로그인 허용. 연결된 세계관의 확정 버전 카드 중 독자 공개 회차가 기준 회차 이하인 카드와 그 카드끼리의 기준 회차 시점 관계를 반환한다(DEC-51). 200 + `ReaderWorldCards` |

- **기준 회차**: 발행된 마지막 회차를 M(발행된 회차가 없으면 0)이라 할 때 `upto`를 생략하면 M, 주면 `min(N, M)`이고 응답 `upto`가 그 적용 값이다. 아직 발행되지 않은 회차의 설정은 `upto`를 크게 줘도 나오지 않는다.
- `upto`는 1 이상의 정수여야 한다. 정수가 아니거나 1 미만이거나 빈 값이면 422(`upto 값을 확인해 주세요.`)이고, 이 검사는 어떤 조회보다 먼저다(없는 작품에 잘못된 `upto`를 보내도 422).
- 작품이 없거나 삭제됐으면 404다. 작품이 **공개가 아니면**(비공개·제한) 연결 여부를 알리지 않고 `worldId: null`·`upto: 0`·빈 목록 200을 준다. 공개 작품인데 연결된 세계관이 없으면 `worldId: null`·빈 목록 200이고, 연결은 있는데 확정 버전(sealed 현재 revision)이 없으면 `worldId`는 채우고 빈 목록 200이다(초안은 독자에게 보이지 않는다).
- **카드**는 연결된 세계관의 확정 버전에 있는 카드 중 삭제되지 않았고(`lifecycle=active`) 독자 공개 회차(`revealFromEpisode`, 아래 절)가 기준 회차 이하인 것이다. 응답의 `revealFromEpisode`가 그 회차이고 카드는 `id` 순이다. `text`는 마크다운 문자열, `cardType`은 공개 세계관과 같은 카드 유형 코드다.
- 독자 공개는 **카드의 `visibility`·세계관의 공개 범위와 별개**다([F-RGT-01](../requirements.md#f-rgt-01): 세계관 공개·항목 이용자 노출·독자 공개는 별개 개념). 비공개 카드라도 독자 공개 회차가 있으면 독자에게 보이고, 공개 카드라도 독자 공개 회차가 없으면 보이지 않는다. 세계관이 비공개여도 연결된 소설이 공개이면 같다.
- **관계**는 Neo4j 관계를 기준 회차(`upto`) 시점으로 본 것(관계마다 그 회차 이하의 가장 최근 연결, 종료된 것은 제외, [DEC-51](worldstudio-independent-schema.md#회차별-관계--dec-51)) 중 양 끝이 위 `cards`에 있는 것만이고 `label`만 준다. 그래서 아직 공개되지 않은 회차에서 생긴 관계는 보이지 않는다. 관계 저장소가 현재 상태를 보증하지 못하면 카드는 그대로 두고 `relationships: []`·`relationshipStatus: "unavailable"`이다(공개 세계관 상세와 같은 이유). 보일 카드가 없으면 관계 저장소를 읽지 않고 `"current"`다.
- 화면: 독자 설정 위키(`/work/:id/wiki`, 회차 화면에서는 `?upto=n`)가 이 API를 Bearer 없이 읽어 `worldId`가 있으면 카드를 유형별 문서로 보이고(본문 마크다운, 정보 상자에 별칭·태그·'N화부터', 관계는 양 끝 문서의 연결), `null`이면 기존 작품 설정 위키를 그대로 보인다. `unavailable`은 빈 연결과 구분해 알리고 조회 실패는 빈 위키로 바꾸지 않는다.

## 설정 가져오기와 카드 메타데이터 (DEC-46)

- **설정 가져오기에는 서버 전용 API가 없다.** 화면이 공개 상세(`GET /api/v1/public/world-studios/{id}`)로 읽은 공개 카드를 새 카드 id로 복사해 내 세계관 초안에 더하고 기존 초안 저장(`PUT /api/v1/world-studios/{id}/draft`)으로 반영한다. 그래서 가져올 수 있는 것은 공개 세계관의 확정 버전에 있는 공개 카드뿐이고(로그인한 누구나, 소유자의 별도 허용 절차 없음), 원본의 이후 변경·비공개 전환·삭제는 가져간 카드에 반영되지 않는다.
- 출처와 독자 공개 회차는 DB 칼럼을 더하지 않고 카드 `semanticMetadata`(jsonb)의 **최상위 키**에 둔다(`semanticMetadata.studio` 안이 아니다).

```text
"importedFrom": { "worldId", "worldName", "authorNickname", "revisionNo", "cardId" }   가져온 카드의 출처(가져온 시점의 값)
"revealFromEpisode": n                                                              독자 공개 시작 회차(1 이상의 정수)
"characterDocs": { "soul", "memory", "episodes": { "<회차 번호>": "글" } }          인물 카드의 작가용 문서(SOUL.md·MEMORY.md·회차별 기억, DEC-47)
```

- 서버는 세 키를 **저장할 때 검사하지 않고 그대로 저장·반환**한다. `revealFromEpisode`는 읽을 때 닫힌 쪽으로 판정한다: 1 이상의 정수인 JSON 숫자(`3.0` 포함)일 때만 독자 공개 회차로 읽고, 없거나 문자열·소수·0·음수·int 범위 밖이면 독자에게 숨긴다. `importedFrom`은 서버가 읽지 않는 표시용 값이고 **클라이언트가 적는 값이라 서버가 출처를 보증하지 않는다**. `characterDocs`는 인물 카드에만 화면이 적는 값이다(IDENTITY.md는 카드 본문 `body`): 공개 API의 카드 응답은 제목·본문·유형·별칭·태그뿐이라 이 문서는 공개 세계관·독자 설정 위키에 나가지 않는다. `episodes`의 키는 0 이상의 정수, 문서마다 3,000자 이하(화면 검증)이고 전부 비어 있으면 키를 넣지 않으며, 읽을 때 모양이 어긋난 값은 통째로 버리고 세계관 로드는 계속한다. 가져온 카드에는 따라오지 않는다(본문만 복사).
- 카드의 `visibility`는 기존 카드 필드(`private`|`public`) 그대로이며 초안 저장이 값을 검사한다(그 밖의 값은 422 `WORLD_INPUT_INVALID`). 소유자 API는 카드마다 저장한 `visibility`를 그대로 돌려준다.
- 화면 흐름(로그인한 회원에게만 보이는 진입점 셋): 공개 세계관 화면의 ① 설정집 게시판의 줄 선택(`보이는 설정 모두 선택` 포함) 뒤 `선택한 설정 가져오기 (N)`과 ② 설정 카드 페이지의 `이 설정 가져오기`는 이동 없이 고른 설정만 고른 내 세계관의 **초안에 바로 추가·저장**한다: 대상의 최신 초안을 읽어(`GET /api/v1/world-studios/{id}`) 새 카드를 끝에 붙이고 초안 저장을 보내며, 관계는 함께 오지 않고 진행·결과·실패 사유와 `다시 시도`를 그 자리에 보인다. ③ 내 세계관 관리 화면 게시판의 `다른 세계관에서 가져오기`는 가져오기 시트를 열며 공개 세계관 목록(대상 세계관 자신은 제외, 공개 설정이 0개인 세계관은 고를 수 없음) → 그 세계관의 공개 설정 체크 → `같이 가져온 카드 사이 관계 포함`(기본 꺼짐) 순서다. 공개 세계관 상세 헤더에서 이 시트로 이동하던 `내 세계관으로 가져오기`와 그 주소(`/worldstudio/<대상>?import=<원본>`)는 2026-11-12에 없앴다(사용자 결정).
- 가져온 카드는 초안 끝에 **새 카드 id·비공개·독자 공개 회차 없음**으로 더해지고 제목·본문·유형·별칭·태그만 옮긴다. 관계는 양 끝을 모두 가져온 것만 옮기며, 공개 상세가 `label`만 주므로 원본의 양 끝 순서를 지킨 사용자 정의 방향 관계로 넣는다. 관계를 불러오지 못한 응답(`relationshipStatus: unavailable`)이면 관계 포함을 고를 수 없고, 활성 카드 1,000개 한도를 넘기면 아무것도 더하지 않고 이유를 보인다. 화면은 가져온 카드에 `가져옴`과 `참고: {worldName} 세계관 · {authorNickname}`를 보인다.

## 구현 선택 (계약이 정하지 않은 부분)

- **이름·설명은 마지막 저장 버전의 값**이다. 저장하지 않은 초안의 이름·설명·카드·관계 수정은 다음 저장 전까지 공개 화면에 반영되지 않는다.
- **삭제로 표시된 카드**(`lifecycle=removed`)와 **비공개 카드**(`visibility=private`)는 마지막 저장 버전에 남아 있어도 `cards`·`cardCount`에서 뺀다(`isPublicCard`, 목록은 쿼리 `WorldRevisionCardRepository.publicCardIds`). 삭제 카드를 빼는 것은 소유자 화면과 같은 기준이다.
- 관계는 `label`만 공개한다. 관계 설명(`body`)·유형·방향·극성·메타데이터는 응답에 없다.
- 목록의 `relationshipCount`는 상세의 `relationships`와 같은 기준(양 끝이 공개 카드인 현재 관계)이다. 관계 저장소가 불확실한 세계관은 목록 전체를 실패시키지 않고 **0**으로 둔다. 정확한 상태는 상세의 `relationshipStatus`를 본다.
- `page`는 0부터, `size`는 1~100이고 기본 `0`·`24`다. 음수·범위 밖·숫자가 아닌 `page`·`size`와 알 수 없는 `genre`는 422이며, 빈 `genre`(`?genre=`)는 전체로 읽는다.
- 오류 본문: 소유자 PUT은 기존 WorldStudio 오류(`WORLD_INPUT_INVALID`·`WORLD_NOT_FOUND`)와 같고, 공개 API는 Content 공통 `{ "detail": … }`다.
- `GenreTemplateSeeder`가 넣는 장르 템플릿의 **카드는 공개(`visibility=public`)**다(카드의 기본이 비공개라 그대로 두면 세계관을 공개해도 카드가 보이지 않는다). **세계관 자체는 계속 비공개**라 공개하려면 소유자(템플릿 운영 관리자)가 이 API를 써야 한다. 이 변경 전에 이미 적재된 세계관은 다시 넣지 않아 카드가 비공개인 채다: `setting_card_version`은 불변(UPDATE·DELETE 거절)이라 값을 고칠 수 없고, 소유자가 초안의 카드를 공개로 저장한 뒤 새 확정 버전을 남기거나 PostgreSQL·Neo4j를 함께 초기화해 다시 적재해야 한다.

## 한계

- 참조·추종 이용·세계관 Fork·파생·조합은 없다(DEC-35). 공개 세계관 응답에는 연결된 소설과 '가져간 세계관 수'가 없다.
- 관계는 현재 상태 하나뿐이다. 과거 관계·이력·시점별 조회는 없다([#132 계약](worldstudio-independent-schema.md#현재-관계-mvp-계약--132)). 마지막 저장 버전의 카드와 **현재** 관계를 합쳐 보이므로, 저장 이후 관계만 바뀌었다면 두 시점이 섞일 수 있다.
- 카드 이미지·첨부는 이 응답에 없다. 공개 세계관 응답은 공개 카드만 담고 카드의 `visibility`·독자 공개 회차 값은 싣지 않는다. 세계관 표지는 소유자 업로드 한 장뿐이고 AI 생성·크롭·여러 장·대체 텍스트는 없다.
- 표지의 WebP는 디코딩하지 않고 RIFF 구조만 확인한다(JDK가 읽지 못한다). 교체·삭제 중 DB 갱신이 실패하면 새 객체가, 이전 객체 삭제가 실패하면 이전 객체가 객체 저장소에 남을 수 있고 정리하지 않는다(운영자 몫, 보상 트랜잭션 없음).
- 목록 정렬은 최근 공개순 하나이고 검색어·복수 장르·카드 수 정렬은 없다. 목록은 세계관마다 Neo4j를 한 번씩 읽는다(한 쪽 최대 100번). 공개 세계관이 늘면 한 쿼리로 묶는 조회와 `(visibility, published_at)` 부분 인덱스를 둔다.
- 목록의 `total`은 쿼리가 센 수다. 확정되지 않은 현재 버전의 세계관이 있다면(`current_revision_id`는 확정 뒤에만 정해져 지금은 생기지 않는다) `items`보다 클 수 있고, 생기면 목록 쿼리에 `sealed` 조건을 둔다.
- 공개 응답은 캐시하지 않는다. 비공개 전환의 즉시성은 이 때문이다. 표지도 `no-store`라 공개 목록이 열릴 때마다 표지를 다시 받는다.
- 연결(DEC-46)은 작품당 세계관 하나·세계관당 작품 하나뿐이고 연결 이력은 남기지 않는다. 연결·해제는 소유자만 하고 운영자용 경로는 없다.
- 독자 설정 위키는 **확정 버전의 카드**와 **현재** 관계를 합쳐 보인다(위 공개 상세와 같은 한계). 초안에서 바꾼 카드 내용·공개 범위·독자 공개 회차는 확정 버전을 남겨야 공개 세계관과 독자 설정 위키에 반영된다. 독자 공개에는 시작 회차만 있고 끝 회차·회차별 내용 차이는 없다.
- 독자 설정 위키는 비로그인 공개 API 하나뿐이라 공개가 아닌 작품은 소유자 본인이 읽어도 빈 응답이다(소유자용 미리보기 API 없음).
- `revealFromEpisode`·`importedFrom`은 저장할 때 형식을 검사하지 않는다. 가져오기 출처는 클라이언트가 적으므로 서버가 위조를 막지 않는다. 화면은 독자 공개 회차가 1 이상의 정수인지만 검사하고 발행된 회차를 넘는지는 검사하지 않는다(서버가 발행된 회차 안에서만 보인다).
- 설정 가져오기: 가져온 관계의 방향·종류·부정 여부는 알 수 없다(공개 응답이 `label`만 준다). 설정 영역·자유 분류도 공개 응답에 없어 기본값으로 들어온다. 같은 카드를 다시 가져오면 중복 카드가 생기고 이미 가져왔다는 표시는 없다. 가져올 세계관 목록은 화면이 읽는 최근 공개분까지이고 검색은 없다. 공개 화면의 바로 추가는 대상 세계관의 최신 초안에 덧붙여 저장하므로, 그 세계관을 다른 탭에서 편집 중이면 그쪽의 다음 저장이 충돌한다. 원본 쪽에서 '가져간 세계관 수'를 세지 않는다.

## 검증 상태

- 로컬 단위 테스트(`./gradlew unitTest`, JDK 21): 공개 노출 판정·장르/공개 범위 검증·카드 공개 판정·관계 필터·독자 공개 회차 판정·`upto`·페이지 검증(`PublicWorldRulesTest`), 공개 서비스의 공개 카드 필터와 독자 카드 조회(`PublicWorldServiceTest`), 연결·해제·409·독자 설정 위키의 기준 회차와 빈 응답·404·422(`WorkWorldServiceTest`), 연결·위키 경로와 소유자 세계관 응답의 `linkedWorkId`(`WorkWorldControllerTest`), 작품 삭제 시 연결 해제(`WorkDeleteServiceTest`), 소유자 응답에만 나오는 `worldStudioId`(`WorkSearchServiceTest`), 템플릿 카드 공개(`GenreTemplateSeederTest`), V37 SQL과 전역 버전 목록(`ContentBoundaryTest`), 소유자 PUT·목록·상세 필드(`WorldStudioServiceTest`), 표지 검증(`WorldCoverRulesTest`: 형식·크기·바이트 시그니처·저장소 실패 변환), 소유자 표지 서비스(`WorldCoverServiceTest`: 저장→DB→이전 객체 삭제 순서와 실패 처리), 표지 컨트롤러 바인딩(`WorldCoverControllerTest`).
- 새 `@Query` 3개(`StudioWorldRepository.listed`·`listedByGenre`, `WorldRevisionCardRepository.publicCardIds`: DEC-46에서 공개 카드 조건을 더해 `activeCardIds`에서 개명)는 DB 없이 H2로 구문·매핑·정렬·필터·count를 확인했고, 파생 쿼리 `WorkRepository.findAllByWorldStudioIdIn`은 이름 해석(PartTree)과 `work.world_studio_id`의 nullable `uuid` 매핑을 확인했다. 컬럼 타입 일치(`ddl-auto=validate`)와 실제 PostgreSQL 결과는 CI가 확인한다.
- **hosted CI 대기(로컬 미실행)**: `PublicWorldHttpIntegrationTest`(공개 목록·상세, 비공개 제외, 비로그인 접근, 소유자 PUT 404/422/401/403, 관계 `unavailable`), `WorldCoverHttpIntegrationTest`(소유자 표지 PUT·GET·DELETE의 401/403/404/422, 공개 표지의 노출 기준, 교체 시 이전 객체 삭제, `hasCover`)와 V7까지 세는 `InitialWorldStoragePostgresTest`·`WorldStudioFlywayPostgresTest`·`WorldStudioMigrationPostgresTest`·`WorldStudioHistoryPostgresTest`. DEC-46 몫으로 `PublicWorldHttpIntegrationTest`에 비공개 카드와 그 관계가 상세·목록 수에서 빠지는지를 더했고, 새 `WorkWorldHttpIntegrationTest`(연결 401/403/404/400/200·멱등·409 `WORLD_ALREADY_LINKED`·해제·작품 삭제 시 해제, 소유자 응답의 `worldStudioId`·`linkedWorkId`, 독자 설정 위키의 공개 전 작품·확정 버전 없음·발행 회차 상한·`upto` 422·없는 작품 404·관계 필터·`unavailable`)와 Content 전역 V37을 세는 `ContentMigrationTest`·`StoryPlanMigrationPostgresTest`·`AttachmentMigrationLocationTest`도 **작성만 했고 로컬에서 실행하지 않았다**.
