# 공개 세계관 계약

[메인 README](../../README.md) · [문서 목록](../README.md)

세계관 소유자가 **세계관 단위로 공개**를 켜면 비로그인 포함 누구나 읽기 전용으로 볼 수 있는 API의 계약이다.
저장과 API는 [서비스 경계](service-boundaries.md)대로 **Content가 소유**하고, 작가 닉네임은 Core에서 조회한다.
결정은 [DEC-45](decisions.md), 저장 구조·관계 정본은 [WorldStudio 설계](worldstudio-independent-schema.md)를 따른다.
백엔드와 프론트엔드가 같은 계약을 쓰며, 서버 소스 구현은 끝났지만 **hosted CI의 통합 테스트는 아직 확인하지 않았다**.

## 확정 정책 (2026-11-11 사용자 결정)

- 공개 범위는 **세계관 단위** `visibility: private | public`이며 기본은 `private`다.
- 공개된 세계관은 **비로그인 포함 누구나** 읽기 전용으로 본다: 이름·설명·장르·작가 닉네임 + **마지막 저장 버전(`world_revision`)의 설정 카드 전부** + **현재 관계(Neo4j 현재 상태) 전부**.
- 비공개로 바꾸면 즉시 공개 목록·상세에서 제외한다(상세는 404).
- 저장 버전(revision)이 하나도 없는 세계관은 공개로 설정돼 있어도 목록·상세에 나오지 않는다(초안은 공개하지 않는다).
- **초안 저장과 확정 버전은 다르다.** 이 문서의 '저장 버전'은 소유자가 명시적으로 확정한 `world_revision`(`POST /{id}/revisions`, 세계관의 `current_revision_id`)이다. 화면의 '저장'(`PUT /{id}/draft`)은 초안 저장이라 공개 화면에 반영되지 않으며, 공개 목록·상세의 노출은 **확정 버전(current revision) 기준**이다. 목록과 상세는 모두 확정(`sealed`)된 현재 버전만 보인다.
- 파생·조합(세계관 복사)·작품-세계관 연결은 이번 범위 밖이다. 응답에 포함하지 않고 화면은 빈 상태로 둔다. 이용·복사는 여전히 제외한다(DEC-35 유지). **예정(DEC-46, 미구현):** 세계관 이용은 참조 연결 없이 공개 카드를 카드 단위로 내 세계관에 복사하는 '설정 가져오기'로 하고, 세계관과 소설은 1:1로 연결한다.
- 카드 단위 `visibility`(`setting_card_*.visibility`)는 기존 값을 그대로 두고 **쓰지 않는다**. 세계관이 공개이면 마지막 저장 버전의 활성 카드가 모두 보인다. **예정(DEC-46, 미구현):** 카드는 기본 비공개이고 공개 카드만 보이며, 관계는 양 끝 카드가 모두 공개일 때만 보인다. 구현할 때 이 절과 응답 예시를 함께 고친다.
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
- 소유자 관리 화면(`/worldstudio/:worldId`)은 새 세계관 만들기 직후 이동한 주소(`?new=1`)일 때만 4단계 작성 모드를 보이고, 첫 저장이 성공하면 쿼리를 지워 관리 모드로 바꾼다. 그 밖의 진입(관리하기·직접 주소, 저장한 적 없는 세계관 포함)은 모두 관리 모드이고 두 화면이다: **설정집 화면**(기본, 헤더 아래 보기 전환 줄 설정집·인물 관계도·시간선은 주소 `?view=people|timeline`, 설정집은 공개 설정집과 같은 게시판, `AI 후보 검토 (대기 N)` 시트·`확정 버전 남기기`(확정 버전 시트)와 상시 저장 영역)과 **편집 화면**(주소 `?card=<id>`, 집필실과 같은 3단: 설정 카드 목록·확정 버전을 보이는 버전 그래프 레일 / 편집기 / AI 채팅, `← 설정집`·뒤로가기로 돌아옴). 설정 카드 삭제는 유형과 상관없이 이어진 관계를 함께 지우는 초안 변경이라 세계관 저장으로 서버에 반영한다. 옛 `?tab=`은 보기·시트로 옮겨 열고, 세계관 탐색 탭은 없다. 공개 설정은 두 모드 모두 초안 저장과 별개로 바로 적용되고, 확정 버전이 없어 `listed: false`이면 화면이 '확정 버전을 남기면 공개 목록에 나타난다'고 알린다.
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
| `GET /api/v1/public/world-studios/{id}` | 비공개·없음·저장 버전 없음은 404. 그 밖에는 마지막 저장 버전의 카드와 현재 관계를 반환한다 |
| `GET /api/v1/public/world-studios/{id}/cover` | 상세와 같은 기준(공개이고 확정 버전이 있는 세계관)일 때만 표지 이미지 바이트를 반환한다. 비공개·확정 버전 없음·표지 없음·없는 세계관은 404 |

- `cards`는 마지막 `world_revision`의 카드 버전 내용이다. `id`는 카드 논리 ID로 관계의 양 끝이 가리키고, `cardType`은 기존 WorldStudio 카드 유형 코드(`character`·`location`·`organization`·`ability`·`object`·`rule`·`event`·`other`) 그대로다(프론트의 기존 라벨 매핑을 쓴다).
- `relationships`는 Neo4j **현재** 관계 중 **양 끝 카드가 위 `cards`에 있는 것**만이다. 저장하지 않은 새 카드나 삭제된 카드를 가리키는 관계는 나오지 않는다. `label`은 기존 관계 필드의 표시 라벨이다.
- 관계 저장소가 현재 상태를 보증하지 못하면(미전환·미완료·조회 실패·토큰 불일치) 카드는 그대로 두고 `relationships: []`, `relationshipStatus: "unavailable"`로 200을 돌려준다(500이 아니다). 정상이면 `"current"`다.
- 작가 닉네임은 저장하지 않고 응답마다 `CoreNicknameService`로 회원 ID 묶음을 한 번 조회해 채운다. Core에 없으면 `탈퇴한 회원`이고, Core 호출 실패는 대체 이름 없이 503/504/502로 그대로 전한다.
- 상세의 `id`가 UUID 형식이 아니면 400, 형식이 맞는데 없으면 404다.
- 표지 응답의 `Content-Type`은 저장한 형식(`image/png`·`image/jpeg`·`image/webp`)이고 `Cache-Control: private, no-store`·`X-Content-Type-Options: nosniff`이다(기존 작품 공개 표지와 같은 관례). 화면은 `hasCover`가 `true`일 때만 `<img src="/api/v1/public/world-studios/{id}/cover">`로 직접 읽고, `false`이면 기존 자동 생성 표지를 쓴다. `id`가 UUID 형식이 아니면 400이다.

### 라우팅·보안

- Content `ContentSecurityConfig`에서 `GET /api/v1/public/world-studios`와 `/api/v1/public/world-studios/**`를 `permitAll`로 연다. 다른 메서드는 기존대로 거부한다.
- 공개 진입점의 라우팅은 `public/world-studios`(정확 경로와 하위 경로)를 Content(8081)로 보낸다. `frontend/nginx.conf`·`frontend/vite.config.ts` 프록시와 CI·개발용 `infrastructure/nginx.dev.conf`에 이미 반영돼 있고, 정적 검사 `infrastructure/ci/test_ci.py`의 `test_public_world_studio_routes_go_to_content`가 고정한다.
- 소유자 표지 업로드(최대 5MB multipart)를 위해 nginx `location ^~ /api/v1/world-studios/`에 `client_max_body_size 6m;`를 둔다(`proxy_pass` 다음 줄이며 `frontend/nginx.conf`·`infrastructure/nginx.dev.conf` 둘 다). nginx 기본값은 1MB라 이 설정이 없으면 1MB를 넘는 표지를 nginx가 413으로 막는다. 공개 `GET`은 본문이 없어 `public/` 위치는 그대로다. Vite 개발 프록시는 본문 크기를 제한하지 않고 Content의 multipart 한도(50MB)는 표지 5MB보다 넉넉하다.

## 구현 선택 (계약이 정하지 않은 부분)

- **이름·설명은 마지막 저장 버전의 값**이다. 저장하지 않은 초안의 이름·설명·카드·관계 수정은 다음 저장 전까지 공개 화면에 반영되지 않는다.
- **삭제로 표시된 카드**(`lifecycle=removed`)는 마지막 저장 버전에 남아 있어도 `cards`·`cardCount`에서 뺀다. 소유자 화면과 같은 기준이다.
- 관계는 `label`만 공개한다. 관계 설명(`body`)·유형·방향·극성·메타데이터는 응답에 없다.
- 목록의 `relationshipCount`는 상세의 `relationships`와 같은 기준(양 끝이 공개 카드인 현재 관계)이다. 관계 저장소가 불확실한 세계관은 목록 전체를 실패시키지 않고 **0**으로 둔다. 정확한 상태는 상세의 `relationshipStatus`를 본다.
- `page`는 0부터, `size`는 1~100이고 기본 `0`·`24`다. 음수·범위 밖·숫자가 아닌 `page`·`size`와 알 수 없는 `genre`는 422이며, 빈 `genre`(`?genre=`)는 전체로 읽는다.
- 오류 본문: 소유자 PUT은 기존 WorldStudio 오류(`WORLD_INPUT_INVALID`·`WORLD_NOT_FOUND`)와 같고, 공개 API는 Content 공통 `{ "detail": … }`다.
- `GenreTemplateSeeder`가 만드는 장르 템플릿 세계관은 바꾸지 않아 계속 비공개다. 공개하려면 소유자(템플릿 운영 관리자)가 이 API를 써야 한다.

## 한계

- 이용·복사·세계관 Fork·파생·조합·작품-세계관 연결은 없다(DEC-35). 응답에도 관련 필드가 없다.
- 관계는 현재 상태 하나뿐이다. 과거 관계·이력·시점별 조회는 없다([#132 계약](worldstudio-independent-schema.md#현재-관계-mvp-계약--132)). 마지막 저장 버전의 카드와 **현재** 관계를 합쳐 보이므로, 저장 이후 관계만 바뀌었다면 두 시점이 섞일 수 있다.
- 카드 이미지·첨부·카드 단위 공개·회차별 공개 범위는 이 응답에 없다. 세계관 표지는 소유자 업로드 한 장뿐이고 AI 생성·크롭·여러 장·대체 텍스트는 없다.
- 표지의 WebP는 디코딩하지 않고 RIFF 구조만 확인한다(JDK가 읽지 못한다). 교체·삭제 중 DB 갱신이 실패하면 새 객체가, 이전 객체 삭제가 실패하면 이전 객체가 객체 저장소에 남을 수 있고 정리하지 않는다(운영자 몫, 보상 트랜잭션 없음).
- 목록 정렬은 최근 공개순 하나이고 검색어·복수 장르·카드 수 정렬은 없다. 목록은 세계관마다 Neo4j를 한 번씩 읽는다(한 쪽 최대 100번). 공개 세계관이 늘면 한 쿼리로 묶는 조회와 `(visibility, published_at)` 부분 인덱스를 둔다.
- 목록의 `total`은 쿼리가 센 수다. 확정되지 않은 현재 버전의 세계관이 있다면(`current_revision_id`는 확정 뒤에만 정해져 지금은 생기지 않는다) `items`보다 클 수 있고, 생기면 목록 쿼리에 `sealed` 조건을 둔다.
- 공개 응답은 캐시하지 않는다. 비공개 전환의 즉시성은 이 때문이다. 표지도 `no-store`라 공개 목록이 열릴 때마다 표지를 다시 받는다.

## 검증 상태

- 로컬 단위 테스트(`./gradlew unitTest`, JDK 21): 공개 노출 판정·장르/공개 범위 검증·관계 필터·페이지 검증(`PublicWorldRulesTest`), 공개 서비스(`PublicWorldServiceTest`), 소유자 PUT·목록·상세 필드(`WorldStudioServiceTest`), 표지 검증(`WorldCoverRulesTest`: 형식·크기·바이트 시그니처·저장소 실패 변환), 소유자 표지 서비스(`WorldCoverServiceTest`: 저장→DB→이전 객체 삭제 순서와 실패 처리), 표지 컨트롤러 바인딩(`WorldCoverControllerTest`).
- 새 `@Query` 3개(`StudioWorldRepository.listed`·`listedByGenre`, `WorldRevisionCardRepository.activeCardIds`)는 DB 없이 H2로 구문·매핑·정렬·필터·count를 확인했다. 컬럼 타입 일치(`ddl-auto=validate`)와 실제 PostgreSQL 결과는 CI가 확인한다.
- **hosted CI 대기(로컬 미실행)**: `PublicWorldHttpIntegrationTest`(공개 목록·상세, 비공개 제외, 비로그인 접근, 소유자 PUT 404/422/401/403, 관계 `unavailable`), `WorldCoverHttpIntegrationTest`(소유자 표지 PUT·GET·DELETE의 401/403/404/422, 공개 표지의 노출 기준, 교체 시 이전 객체 삭제, `hasCover`)와 V7까지 세는 `InitialWorldStoragePostgresTest`·`WorldStudioFlywayPostgresTest`·`WorldStudioMigrationPostgresTest`·`WorldStudioHistoryPostgresTest`.
