# 공개 세계관 계약

[메인 README](../../README.md) · [문서 목록](../README.md)

세계관 소유자가 **세계관 단위로 공개**를 켜면 비로그인 포함 누구나 읽기 전용으로 볼 수 있는 API의 계약이다.
설정 카드 단위 공개, 세계관-소설 1:1 연결, 독자 설정 위키, 설정 가져오기의 카드 메타데이터(DEC-46)와 카드 공개 기준의 일원화(DEC-53)도 이 문서가 정한다.
저장과 API는 [서비스 경계](service-boundaries.md)대로 **Content가 소유**하고, 작가 닉네임은 Core에서 조회한다.
결정은 [DEC-45·DEC-46·DEC-53](decisions.md), 저장 구조·관계 정본·본문 링크·「동일 인물」은 [WorldStudio 설계](worldstudio-independent-schema.md)를 따른다.
백엔드와 프론트엔드가 같은 계약을 쓰며, 서버 소스 구현은 끝났지만 **hosted CI의 통합 테스트는 아직 확인하지 않았다**.

> **DEC-53(2026-11-18, #485)으로 카드 공개 기준을 하나로 일원화했다.** 이 문서에서 'DEC-53'으로 표시한 규칙 가운데 공개 기준 일원화(유효 공개 회차·기준 회차)는 **서버·화면 소스 구현·로컬 단위 테스트 통과**이고 hosted CI 통합·브라우저 육안 확인은 미확인이다(#485 2단계). 본문 링크의 공개 응답(서버 치환 함수 한 곳)은 **소스 구현·로컬 단위 테스트 통과**이고 hosted CI 통합 테스트·브라우저 육안 확인은 미확인이다(3단계). 「동일 인물」의 공개도 소스 구현까지 끝났고 같은 CI 확인 전이다(4단계: 서버는 기존 끝점 거르기 그대로, 화면은 관계 종류 표시). DEC-46의 두 기준(카드 `visibility`: 공개 세계관·가져오기·Fork, `revealFromEpisode`: 독자 설정 위키)은 이 규칙으로 대체됐다.

## 확정 정책 (2026-11-11 사용자 결정)

- 공개 범위는 **세계관 단위** `visibility: private | public`이며 일반 세계관의 기본은 `private`다. 신규 플랫폼 샘플 템플릿은 세계관과 카드를 공개로 생성한다.
- 공개된 세계관은 **비로그인 포함 누구나** 읽기 전용으로 본다: 이름·설명·장르·작가 닉네임 + **마지막 저장 버전(`world_revision`)에서 기준 회차 이하로 공개된 설정 카드**(DEC-53) + **그 카드끼리의 기준 회차 시점 관계(Neo4j)**. 어떤 카드가 보이는지는 아래 카드 단위 공개 항목과 [DEC-53 절](#카드-공개-기준-일원화--dec-53)이 정한다.
- 비공개로 바꾸면 즉시 공개 목록·상세에서 제외한다(상세는 404).
- 저장 버전(revision)이 하나도 없는 세계관은 공개로 설정돼 있어도 목록·상세에 나오지 않는다(초안은 공개하지 않는다).
- **초안 저장과 확정 버전은 다르다.** 이 문서의 '저장 버전'은 소유자가 명시적으로 확정한 `world_revision`(`POST /{id}/revisions`, 세계관의 `current_revision_id`)이다. 화면의 '저장'(`PUT /{id}/draft`)은 초안 저장이라 공개 화면에 반영되지 않으며, 공개 목록·상세의 노출은 **확정 버전(current revision) 기준**이다. 목록과 상세는 모두 확정(`sealed`)된 현재 버전만 보인다.
- 파생·조합(세계관 복사)과 남의 세계관을 참조·추종하는 이용은 없다(DEC-35 유지). 세계관 이용은 참조 연결 없이 공개 카드를 카드 단위로 내 세계관에 복사하는 **설정 가져오기**로 하고(2026-11-12 사용자 결정: 공개 세계관의 공개 카드는 로그인한 누구나 가져올 수 있고 출처를 자동으로 표시한다), 세계관과 소설은 1:1로 연결한다(DEC-46). 아래 '세계관-소설 1:1 연결'·'독자 설정 위키'·'설정 가져오기와 카드 메타데이터' 절이 계약이다. 공개 세계관 **상세** 응답은 연결된 소설이 **공개 작품일 때만** 그 최소 정보(`linkedWork`)를 싣고, 비공개·제한·삭제 작품이거나 연결이 없으면 `null`로 소설의 존재를 드러내지 않는다(#329, 사용자 결정, 아래 '공개 API').
- **설정 카드의 공개 설정은 하나다: 'N화부터 공개' 또는 '작가 전용'(기본)**(DEC-53, 2026-11-18 사용자 결정. DEC-46의 카드 `visibility`·독자 공개 회차 두 값을 대체한다). 공개 세계관에서도 **삭제되지 않았고(`lifecycle=active`) 유효 공개 회차가 기준 회차 이하인 카드만** 보이고, 관계는 양 끝 카드가 모두 그런 카드일 때의 기준 회차 시점 관계만 보인다. 목록의 `cardCount`·`relationshipCount`도 같은 기준이다. 보이는 카드가 하나도 없는 공개 세계관도 목록·상세에는 그대로 나온다(카드 0개). 값은 `semanticMetadata.revealFromEpisode`에 두고 `setting_card_*.visibility`는 맞춰 저장하는 호환 값이다.
- **세계관 표지는 소유자가 직접 올린 이미지(PNG·JPEG·WebP, 5MB 이하)만 쓴다**(2026-11-12 사용자 결정). AI 표지 생성은 준비 중이라 이 계약에 없다. 표지가 없으면 화면이 기본 표지(`/default-work-cover.svg`)를 쓴다. 공개 표지의 노출 기준은 상세와 같다(공개이고 확정 버전이 있을 때).

장르 코드(소유자가 공개할 때 고른다, 미지정은 `null`):

| 코드 | 이름 | 코드 | 이름 |
|---|---|---|---|
| `fantasy` | 판타지 | `modern` | 현대 |
| `sf` | SF | `classic` | 고전 |
| `wuxia` | 무협 | `mystery` | 미스터리 |
| `romance` | 로맨스 | | |

## 카드 공개 기준 일원화 — DEC-53

**상태: 설계 확정(2026-11-18 사용자 결정, [#485](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/485)), 공개 기준 일원화(2단계)는 서버·화면 소스 구현·로컬 단위 테스트 통과, hosted CI 통합·브라우저 육안 확인 미확인.** 결정은 [DEC-53](decisions.md)이다. DEC-46은 카드에 기준을 둘 두었다(`visibility`: 공개 세계관·가져오기·Fork, `revealFromEpisode`: 독자 설정 위키). 그래서 50화에 밝혀질 카드도 `visibility=public`이면 1화 시점의 `/worlds`에서 전부 보였다. 이 절은 둘을 하나로 합친다. 카드 안의 부분 공개(문단·별칭·이미지별 회차)는 두지 않는다(DEC-36 유지): 숨길 내용·나중에 밝혀질 이름은 카드를 나눠 두고 [본문 링크](worldstudio-independent-schema.md#카드-본문-링크--dec-53)와 [「동일 인물」](worldstudio-independent-schema.md#동일-인물-관계--dec-53) 관계로 잇는다. 이미지도 카드마다 하나라 공개 전 실루엣과 공개 후 실제 사진은 카드를 나눠 둔다. 세계관 공개(목록 등재, DEC-45)만 이와 별개다.

### 값과 판정

| 이름 | 정의 |
|---|---|
| 공개 설정 | 카드마다 하나다: `N화부터 공개`(1 이상의 정수) 또는 `작가 전용`(기본). 소설이 연결되지 않은 세계관은 `공개`(= 1화부터)와 `작가 전용` 두 값으로 고른다 |
| 유효 공개 회차 | 카드 `semanticMetadata.revealFromEpisode`가 1 이상의 정수 JSON 숫자면 그 값, 키가 없고 카드 `visibility=public`이면 1, 그 밖은 없음(작가 전용). 키가 있는데 값이 잘못됐으면(JSON `null` 포함) 작가 전용이다(`visibility`로 열지 않는다) |
| 기준 회차 | 연결된 소설의 **발행된 마지막 회차**. 소설이 공개 작품이 아니거나 발행된 회차가 없으면 0, 소설이 연결되지 않은 세계관은 1. Fork 이어받기는 Fork 기준 회차와 요청 `upto` 중 작은 값 |
| 보이는 카드 | 삭제되지 않았고(`lifecycle=active`) 유효 공개 회차가 기준 회차 이하인 카드 |
| 보이는 관계 | 양 끝이 모두 보이는 카드인 관계를 기준 회차 시점으로 본 것(DEC-51). 「동일 인물」도 같다 |

- 보안 경계는 발행된 마지막 회차다. 독자 설정 위키의 `upto`는 독자 진도에 맞춘 편의 값이라 누구나 최댓값으로 부를 수 있다.
- 새 화면은 `revealFromEpisode`만 정하고 `visibility`는 회차 값이 있으면 `public`, 없으면 `private`로 맞춰 저장한다(호환 값이며 판정에는 쓰지 않는다).
- 게시판의 일괄 공개(`선택 공개`·`전체 공개`)는 소설이 연결된 세계관이면 회차를 한 번 입력받아(기본 1화) 고른 카드 모두에 같은 `N화부터 공개`를 정한다. 미연결 세계관은 `공개`(1화)다(2026-11-18 사용자 결정).
- 작가 전용 카드는 독자·공개 세계관·가져오기·Fork에만 숨는다. 작가 범위(초안 읽기·AI 검토·원고 Q&A·시뮬레이션의 인물 지식)에는 시점 제한이 없다([시뮬레이션 계약](character-simulation-contract.md)).

### 기존 데이터: 읽을 때 계산한다 (마이그레이션 없음)

DB 값을 고치지 않는다. 확정 카드 버전은 UPDATE 금지 트리거가 있고 장르 템플릿 26종은 동결 입력·원본 일치 판정에 묶여 있어 값을 다시 쓰면 깨진다.

| 저장된 값 | 유효 공개 회차 | 달라지는 것 |
|---|---|---|
| 공개 + 회차 N | N | `/worlds`에서 N화가 발행되기 전에는 숨는다(의도한 수정) |
| 공개 + 회차 없음 | 1 | 소설에 연결되지 않은 장르 템플릿 26종은 지금과 같다. 소설에 연결된 세계관은 독자 설정 위키에 1화부터 새로 보이므로 적용 전에 세계관별 건수를 센다 |
| 비공개 + 회차 N | N | `/worlds`·가져오기·Fork로 넓어진다(시연 데이터가 이 조합이다: 구운몽 77장 중 65장, 홍길동 57장 중 46장) |
| 비공개 + 회차 없음 | 없음(작가 전용) | 변화 없음 |

- 가져온 카드는 이미 '비공개 + 회차 없음'이라 그대로다. Fork가 이어받은 카드는 저장된 사본이 없어(매번 원작 확정 버전을 읽는다) 옮길 데이터가 없다.

### 경로별 적용

| 경로 | 카드 | 관계 시점 |
|---|---|---|
| 독자 설정 위키 `GET /public/works/{id}/world-cards`·`…/world-card-images/…`·MCP `work_public_world_cards` | 보이는 카드, 기준 회차 = 발행된 마지막 회차(`upto`를 주면 그 이하) | 기준 회차 |
| 공개 세계관 상세 `GET /public/world-studios/{id}`·`…/card-images/…`·MCP `world_studio_public_read` | 보이는 카드, 기준 회차 = 연결된 소설의 발행된 마지막 회차(미연결 1) | 기준 회차 |
| 공개 목록 `GET /public/world-studios`·MCP `world_studio_public_list` | `cardCount`·`relationshipCount`가 상세와 같은 기준이다(세계관마다 기준 회차를 따로 계산) | 기준 회차 |
| 설정 가져오기(화면이 공개 상세 응답을 복사) | 공개 상세와 같다 | 같이 가져온 카드 사이만 |
| Fork 이어받기 `GET /works/{id}/inherited-world`·MCP `work_inherited_world` | 보이는 카드, 기준 회차 = Fork 기준 회차와 요청 `upto` 중 작은 값 | 기준 회차 |
| 작가 경로(`world_studio_read`·초안·AI 검토·원고 Q&A·시뮬레이션) | 작가 범위라 작가 전용 카드까지 전부 | 요청 회차(생략하면 최신) |

### 연결·해제·공개 중단

| 상황 | 기준 회차 | 결과 |
|---|---|---|
| 공개 작품과 연결 | 발행된 마지막 회차 | 그 회차 이하로 공개된 카드가 보인다 |
| 연결된 소설이 공개 작품이 아니거나 발행된 회차가 없음 | 0 | 보이는 카드가 없다(목록·상세에는 카드 0개로 그대로 나온다) |
| 연결 해제(작품 삭제에 따른 해제 포함) | 1 | 2화 이후에 공개되는 카드가 숨는다. 값은 그대로라 다시 연결하면 돌아온다 |
| 다른 소설로 연결 변경 | 새 소설의 발행된 마지막 회차 | 연결·변경 전에 화면이 새로 공개되거나 가려질 카드 수를 알리고 확인을 받는다 |
| 회차 공개 중단·삭제 | 발행된 마지막 회차가 내려갈 수 있다 | 그 회차 뒤에 공개되는 카드도 같이 숨는다. 회차 번호는 재사용·재배치되지 않는다 |

### 본문 링크의 공개 응답

링크 문법·검증 표는 [WorldStudio 설계](worldstudio-independent-schema.md#카드-본문-링크--dec-53)가 정한다. 공개 쪽 규칙은 다음과 같다.

- 독자 설정 위키·공개 세계관 상세·Fork 이어받기 응답은 **같은 치환 함수**를 쓴다: 카드 `text`와 관계 `body`에서 링크의 대상이 그 응답의 보이는 카드에 없으면(작가 전용·기준 회차 뒤·삭제·다른 세계관·없는 id) 글자만 남기고 id를 지운다. 대상이 보이면 그대로 둔다. 화면이 거르거나 되살리지 않는다(DEC-46 원칙).
- 가리키는 설정(백링크)은 서버가 계산하지 않는다. 화면이 받은 보이는 카드의 본문에서 계산하므로 보이는 카드끼리만 이어진다.
- 설정 가져오기는 화면이 치환이 끝난 본문을 복사한다. 같이 가져온 카드끼리만 새 id로 잇고 나머지 링크는 글자로 바꾼다.
- 링크 글자는 대상이 숨어 있어도 남는다. 이른 카드의 글에 늦은 카드의 제목·별칭이 나오는 것은 [공개 순서 규칙](world-review-contract.md#공개-순서-규칙--dec-53)이 경고한다(막지는 않는다).
- **구현(#485 3단계)**: 치환 함수는 `world/domain/CardLinks.kt`의 `hideCardLinks`(응답에 실리는 보이는 카드 id 집합을 받고, 링크를 바꾼 뒤 남은 `card:<uuid>`도 같은 기준으로 지운다) 하나이고 `PublicWorldService`의 `detail`·`readerCards`·`inheritedWorld`가 응답을 만들 때 카드 본문과 관계 본문에 건다. REST와 공개 MCP 도구(`work_public_world_cards`·`world_studio_public_read`·`work_inherited_world`)가 모두 이 세 메서드를 거치므로 출구마다 따로 걸지 않는다(Fork 응답의 관계 본문은 원래 비워 보낸다). 공개 목록(`/world-studios`)은 본문을 싣지 않는다. 링크를 그리는 쪽은 화면이다: 카드 페이지는 응답에 있는 카드의 페이지로, 독자 설정 위키는 같은 위키 안 그 카드의 문서로 잇고 응답에 없는 카드는 글자만 그린다. 백링크는 받은 본문으로 계산해 카드 페이지의 '이 카드를 가리키는 설정'과 게시판 연결 수에 센다(관계로 이미 이어진 카드는 관계 쪽이 보인다).

### 「동일 인물」의 공개

`category: identity` 관계도 다른 관계와 같은 규칙으로 보인다: 두 카드가 모두 보이고 관계의 기록 회차가 기준 회차 이하일 때만 나온다. 공개 화면의 관계 종류 표시는 `emotional`이면 '감정 관계', `identity`이면 '동일 인물', 그 밖은 '구조 관계'다(4단계 구현: 독자 설정 위키는 '동일 인물 · 정체: 상대'(다른 이름 카드 쪽)·'동일 인물 · 다른 이름: 상대'(본체 쪽)로 보이고 방향·부정 문구는 붙이지 않으며, 공개 세계관 카드 페이지·그래프는 종류 이름만 '동일 인물'이다). 관계의 `label`·`body`는 자유 글이라 서버가 거르지 못하고 공개 순서 규칙의 경고로만 줄인다.

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
| `DELETE /api/v1/world-studios/{id}` | 소유자만 세계관을 소프트 삭제한다(204). 연결된 소설이 있으면 409 `WORLD_LINKED`. 규칙은 아래 [세계관 삭제](#세계관-삭제-2026-11-17-사용자-결정) |
| `PUT /api/v1/world-studios/{id}/publication` | 소유자만 공개 범위·장르를 바꾼다. 소유자가 아니면 404(기존 관례), 값 오류는 422 `WORLD_INPUT_INVALID`. 200 + `PublicationResponse` |
| `PUT /api/v1/world-studios/{id}/cover` | 소유자만 표지를 저장·교체한다. multipart `file`(PNG·JPEG·WebP, 5MB 이하). 200 + `WorldCoverResponse`, 비소유자 404, 값 오류 422 `WORLD_INPUT_INVALID` |
| `DELETE /api/v1/world-studios/{id}/cover` | 소유자만 표지를 지운다. 204(표지가 없어도 204), 비소유자 404 |
| `GET /api/v1/world-studios/{id}/cover` | 소유자만 표지 이미지 바이트를 읽는다. 표지가 없으면 404, 비소유자 404 |

- `listed`는 지금 공개 목록·상세에 실제로 나오는지다. **저장 버전이 없는 세계관을 `public`으로 바꾸는 것은 허용**하되 `listed: false`로 알린다.
- 소유자 관리 화면(`/worldstudio/:worldId`)은 새 세계관 만들기 직후 이동한 주소(`?new=1`)일 때만 4단계 작성 모드를 보이고, 첫 저장이 성공하면 쿼리를 지워 관리 모드로 바꾼다. 그 밖의 진입(관리하기·직접 주소, 저장한 적 없는 세계관 포함)은 모두 관리 모드이고 두 화면이다: **설정집 화면**(기본, 헤더 아래 보기 전환 줄 설정집·관계도·시간선은 주소 `?view=people|timeline`, 설정집은 공개 설정집과 같은 게시판, `AI 후보 검토 (대기 N)` 시트·`집필 메모 추가`·`확정 버전 남기기`(확정 버전 시트)와 상시 저장 영역)과 **편집 화면**(주소 `?card=<id>`, 집필실과 같은 3단: 설정 카드 목록·확정 버전을 보이는 버전 그래프 레일 / 편집기 / AI 채팅, `← 설정집`·뒤로가기로 돌아옴). 설정 카드 삭제는 유형과 상관없이 이어진 관계를 함께 지우는 초안 변경이라 세계관 저장으로 서버에 반영한다. 옛 `?tab=`은 보기·시트로 옮겨 열고, 세계관 탐색 탭은 없다. 공개 설정은 두 모드 모두 초안 저장과 별개로 바로 적용되고, 확정 버전이 없어 `listed: false`이면 화면이 '확정 버전을 남기면 공개 목록에 나타난다'고 알린다. 설정 카드의 공개 설정은 하나이고(DEC-53) 이 화면에서 정한다: 설정집 게시판은 카드마다 `공개` 칸(`N화부터`·`작가 전용`, 소설이 연결되지 않은 세계관의 1화는 `공개`)을 보이고 고른 줄을 `선택 공개`·`선택 비공개`로, 설정집의 카드 전부를 `전체 공개`로 바꾼다. 소설이 연결된 세계관이면 `일괄 공개 회차`를 한 번 입력받아(기본 1화) 고른 카드 모두에 같은 `N화부터 공개`를 정하고(0·빈 값은 이유를 알리고 공개 버튼만 잠근다) 연결되지 않은 세계관은 `공개`(1화)다. 편집 화면의 `공개 범위` 구획은 소설이 연결된 세계관이면 `공개 회차 [ ]화부터 공개` 입력 하나(비우면 작가 전용, 1 이상의 정수가 아니면 저장을 막음), 연결되지 않은 세계관이면 `이 설정 공개` 스위치 하나(공개 = 1화부터)다. 화면은 `revealFromEpisode`만 정하고 `visibility`는 회차가 있으면 `public`, 없으면 지워(비공개) 맞춘다. 건드리지 않은 카드(옛 공개 카드·회차 값만 있는 카드)는 다시 쓰지 않고, 키가 있는데 값이 잘못된(JSON `null` 포함) 카드는 서버처럼 작가 전용으로 읽어 저장하면 비공개로 맞춘다. 공개(로 고른) 세계관인데 초안에 공개된 카드가 없으면 경고와 `전체 공개`(1화부터)를 관리 헤더·정보 편집 패널·작성 모드 공개 설정에 보이되 공개 설정 저장은 막지 않는다(정보 편집 패널의 저장은 이름·설명을 바꿨고 저장하지 않은 초안 변경이나 저장 전 확인 항목이 있을 때만 잠긴다). 헤더에는 연결 상태 줄(`연결된 소설: {제목}` 또는 `연결된 소설이 없어요.`, 정보만)과 소설 버튼 한 자리(연결돼 있으면 그 작품 관리로 가는 `소설 작성하기`, 없으면 `소설 연결하기`)가, 게시판에는 `다른 세계관에서 가져오기`가 있다(아래 절). **카드 공개·독자 공개 회차·가져온 카드는 모두 초안 값**이라 세계관 저장과 `확정 버전 남기기`를 거쳐야 공개 세계관 화면·독자 설정 위키에 반영되고 화면이 도움말로 그렇게 알린다.
- 값 검사는 소유 확인보다 먼저 한다(기존 `create`·`edit`과 같다). `visibility` 누락·알 수 없는 값·알 수 없는 `genre`는 422이고, 코드는 대소문자·공백까지 정확히 맞아야 한다.
- 카드·관계·revision·잠금·이력은 건드리지 않는다. 같은 요청을 다시 보내도 결과가 같다(`publishedAt` 유지).
- 표지 형식은 파일명·보낸 `Content-Type`이 아니라 **실제 바이트**로 정한다. PNG·JPEG는 설정 첨부 이미지와 같은 디코딩 검사(가로·세로 4096px 이하)를 거치고, WebP는 RIFF 컨테이너 구조(시그니처·전체 크기·첫 chunk)만 확인한다. 비었거나 5MB를 넘거나 `file` 파트가 없거나 알 수 없는 형식·깨진 이미지는 422 `WORLD_INPUT_INVALID`이며 `detail`에 사유가 있다. 값 검사는 소유 확인보다 먼저다. 요청 전체가 nginx 6MB나 Content의 multipart 한도(50MB)를 넘으면 값 검사 전에 413으로 막히고(기존 첨부와 같은 오류), 그 사이의 5MB 초과는 422다.
- 표지 교체는 **새 객체 저장 → DB 갱신 → 이전 객체 삭제** 순서다. 새 객체 저장이 실패하면 DB와 이전 객체는 그대로이고(503), 이전 객체 삭제가 실패하면 로그만 남기고 성공으로 답한다. 삭제는 DB 참조를 먼저 지우고 객체를 그 다음에 지운다. 객체 저장소 오류는 고정 문구의 503 그대로 전한다.
- 소유자 표지 읽기는 `Cache-Control: private, no-store`·`X-Content-Type-Options: nosniff`이다. 소유자 화면은 Bearer가 필요해 인증 fetch → Blob → objectURL(해제 포함)로 읽는다.
- 기존 `GET /api/v1/world-studios`(내 목록) 요약과 `GET /api/v1/world-studios/{id}` 응답에 `visibility`, `genre`, `hasCover`(표지가 있는지) 필드가 **추가**됐다(기존 필드는 그대로).
- 내 목록 요약에는 `cardCount`(초안의 활성 설정 카드 수, 삭제한 카드·관계 제외, 옛 응답은 0)도 있다. 요약은 카드를 싣지 않으므로 서재 '내가 만드는 세계관'의 `설정 N개`는 이 값으로 그린다.

## 공개 API (비로그인 허용 `GET`)

```text
PublicWorldPageResponse = { "items": [PublicWorldSummary], "page", "size", "total" }
PublicWorldSummary = { "id", "name", "description", "genre": code | null, "authorNickname",
                       "cardCount", "relationshipCount", "publishedAt", "hasCover": boolean }
PublicWorld        = { "id", "name", "description", "genre", "authorNickname", "publishedAt", "revisionNo",
                       "cards": [ { "id", "title", "text", "cardType", "aliases": [..], "tags": [..] } ],
                       "relationships": [ { "id", "sourceCardId", "targetCardId", "label", "category", "body", "direction", "polarity" } ],
                       "relationshipStatus": "current" | "unavailable", "hasCover": boolean,
                       "linkedWork": { "id": "<작품 id>", "title", "authorNickname", "hasCover": boolean } | null }
```

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v1/public/world-studios?genre=<code>&page=0&size=24` | 공개이고 저장 버전이 있는 세계관만 `published_at` 최신순(같은 시각은 `id`순)으로 반환한다. `genre`를 생략하면 전체다 |
| `GET /api/v1/public/world-studios/{id}` | 비공개·없음·저장 버전 없음은 404. 그 밖에는 마지막 저장 버전에서 기준 회차 이하로 공개된 카드(DEC-53)와 그 카드끼리의 기준 회차 시점 관계를 반환한다 |
| `GET /api/v1/public/world-studios/{id}/cover` | 상세와 같은 기준(공개이고 확정 버전이 있는 세계관)일 때만 표지 이미지 바이트를 반환한다. 비공개·확정 버전 없음·표지 없음·없는 세계관은 404 |

- `cards`는 마지막 `world_revision`의 카드 버전 중 보이는 카드(`lifecycle=active`이고 유효 공개 회차가 기준 회차 이하, DEC-53)의 내용이다. `text`의 본문 링크는 대상이 `cards`에 없으면 서버가 글자만 남기고 id를 지운다([치환 규칙](#본문-링크의-공개-응답)). `id`는 카드 논리 ID로 관계의 양 끝이 가리키고, `cardType`은 기존 WorldStudio 카드 유형 코드(`character`·`location`·`organization`·`ability`·`object`·`rule`·`event`·`other`) 그대로다(프론트의 기존 라벨 매핑을 쓴다).
- `relationships`는 Neo4j 관계를 **기준 회차 시점**(DEC-51·53, 소설이 연결되지 않은 세계관은 1화)으로 본 것 중 **양 끝 카드가 위 `cards`에 있는 것**만이다. 저장하지 않은 새 카드나 삭제된 카드·작가 전용·기준 회차 뒤 카드를 가리키는 관계는 나오지 않는다. `label`·`body`와 `category`·`direction`·`polarity`를 함께 반환하며, 없는 방향과 극성은 null 그대로다.
- 관계 저장소가 현재 상태를 보증하지 못하면(미전환·미완료·조회 실패·토큰 불일치·확장 적재 중) 카드는 그대로 두고 `relationships: []`, `relationshipStatus: "unavailable"`로 200을 돌려준다(500이 아니다). 정상이면 `"current"`다. 목록의 관계 수는 이때 0이 아닌 `null`이다.
- 작가 닉네임은 저장하지 않고 응답마다 `CoreNicknameService`로 회원 ID 묶음을 한 번 조회해 채운다. Core에 없으면 `탈퇴한 회원`이고, Core 호출 실패는 대체 이름 없이 503/504/502로 그대로 전한다.
- `linkedWork`는 이 세계관에 연결된 소설(`work.world_studio_id`, 1:1, DEC-46)의 최소 정보(작품 id·제목·작가 닉네임·표지 유무)이며 **연결된 소설이 공개 작품일 때만** 채운다(#329). 공개 판정은 Content의 기존 공개 술어(`WorkAccessResult.publiclyVisible()`: 공개 범위가 `public`이고 제한·삭제가 아닌 작품)를 그대로 쓰고, 비공개·제한·삭제 작품이거나 연결이 없으면 `null`이라 소설의 존재 자체를 드러내지 않는다. 목록(`PublicWorldSummary`)에는 싣지 않는다. 소설 작가 닉네임은 위 세계관 작가와 **같은 `CoreNicknameService` 조회 한 번**에 묶어 채우고(Core에 없으면 `탈퇴한 회원`, 실패는 위와 같이 그대로), 연결된 소설이 없거나 공개가 아니면 그 작가는 조회하지 않는다. 404인 세계관은 연결을 읽지 않는다.
- `linkedWork.hasCover`는 작품 표지(회차 0 이미지)가 있는지다. `true`이면 화면이 기존 공개 작품 표지 `GET /api/v1/public/works/{id}/cover/content`를 `<img>`로 직접 읽고, `false`이면 기본 작품 표지(`/default-work-cover.svg`)를 쓴다. 화면은 '이 세계관을 쓴 작품' 선반에 그 소설을 책 카드 하나로 보이고 누르면 작품 상세(`/work/{id}`)로 이동하며, `null`이면 '이 세계관으로 공개된 소설이 아직 없어요'를 보인다(`--mode mockup` 데모는 서버 값이 아니라 데모 작품을 링크 없이 보인다).
- 상세의 `id`가 UUID 형식이 아니면 400, 형식이 맞는데 없으면 404다.
- 표지 응답의 `Content-Type`은 저장한 형식(`image/png`·`image/jpeg`·`image/webp`)이고 `Cache-Control: private, no-store`·`X-Content-Type-Options: nosniff`이다(기존 작품 공개 표지와 같은 관례). 화면은 `hasCover`가 `true`일 때만 `<img src="/api/v1/public/world-studios/{id}/cover">`로 직접 읽고, `false`이면 기본 표지(`/default-work-cover.svg`)를 쓴다. `id`가 UUID 형식이 아니면 400이다.

### 라우팅·보안

- Content `ContentSecurityConfig`에서 `GET /api/v1/public/world-studios`와 `/api/v1/public/world-studios/**`를 `permitAll`로 연다. 다른 메서드는 기존대로 거부한다.
- 공개 진입점의 라우팅은 `public/world-studios`(정확 경로와 하위 경로)를 Content(8081)로 보낸다. `frontend/nginx.conf`·`frontend/vite.config.ts` 프록시와 CI·개발용 `infrastructure/nginx.dev.conf`에 이미 반영돼 있고, 정적 검사 `infrastructure/ci/test_ci.py`의 `test_public_world_studio_routes_go_to_content`가 고정한다.
- 소유자 표지 업로드(최대 5MB multipart)를 위해 nginx `location ^~ /api/v1/world-studios/`에 `client_max_body_size 6m;`를 둔다(`proxy_pass` 다음 줄이며 `frontend/nginx.conf`·`infrastructure/nginx.dev.conf` 둘 다). nginx 기본값은 1MB라 이 설정이 없으면 1MB를 넘는 표지를 nginx가 413으로 막는다. 공개 `GET`은 본문이 없어 `public/` 위치는 그대로다. Vite 개발 프록시는 본문 크기를 제한하지 않고 Content의 multipart 한도(50MB)는 표지 5MB보다 넉넉하다.
- 연결 `PUT /api/v1/works/{id}/world-studio`, Fork 이어받기 `GET /api/v1/works/{id}/inherited-world`와 독자 설정 위키 `GET /api/v1/public/works/{id}/world-cards`(아래 세 절)는 새 location 없이 기존 `/api/v1/works/`·`/api/v1/public/works/` 접두 규칙으로 Content에 간다(`frontend/nginx.conf`·`infrastructure/nginx.dev.conf`·`frontend/vite.config.ts` 변경 없음). 독자 설정 위키는 `ContentSecurityConfig`의 기존 `GET /api/v1/public/works/**` `permitAll`로 비로그인에 열려 있다. 정적 검사 `infrastructure/ci/test_ci.py`의 `test_work_world_link_and_reader_wiki_routes_go_to_content`가 고정한다.

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
- 화면: 작품 관리(`/content?work=<id>`)의 세계관·설정집 탭 `세계관 연결`에서 다른 소설에 연결되지 않은 내 세계관을 골라(드롭다운 기본값은 `선택 안 함`이고 고르기 전에는 `세계관 연결` 버튼이 잠긴다) 연결하고 `연결 해제`(확인 뒤)로 푼다. 세계관 관리 화면(`/worldstudio/:id`) 헤더의 `소설 연결하기`는 세계관에 연결되지 않은 내 소설을 골라 같은 API로 연결하며(초안 저장과 별개로 바로 적용) 연결되면 같은 자리가 그 작품 관리(`/content?work=<id>`)로 가는 `소설 작성하기`로 바뀐다. 그 시트의 `새 소설 만들기`는 작품 만들기(`/content`)로 갈 뿐이라 만든 소설은 자동으로 연결되지 않는다. 해제는 작품 관리 화면에서만 한다. 두 화면 모두 실패는 서버 문구를 그대로 보인다.

## 독자 설정 위키 (DEC-46)

소설에 연결된 세계관의 설정 카드 가운데 **독자에게 공개된 것만** 서버가 걸러 준다(화면에서 거르지 않는다). 독자 공개는 카드의 공개 설정('N화부터 공개', DEC-53)으로 정하며 연결된 소설의 **발행된 회차** 기준이다.

```text
ReaderWorldCards = { "workId", "worldId": "<uuid>" | null, "upto": <적용된 기준 회차>,
                     "cards": [ { "id", "title", "text", "cardType", "aliases": [..], "tags": [..], "revealFromEpisode": n } ],
                     "relationships": [ { "id", "sourceCardId", "targetCardId", "label", "category", "body", "direction", "polarity" } ],
                     "relationshipStatus": "current" | "unavailable" }
```

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v1/public/works/{id}/world-cards?upto=N` | 비로그인 허용. 연결된 세계관의 확정 버전 카드 중 유효 공개 회차(DEC-53)가 기준 회차 이하인 카드와 그 카드끼리의 기준 회차 시점 관계를 반환한다(DEC-51). 200 + `ReaderWorldCards` |

- **기준 회차**: 발행된 마지막 회차를 M(발행된 회차가 없으면 0)이라 할 때 `upto`를 생략하면 M, 주면 `min(N, M)`이고 응답 `upto`가 그 적용 값이다. 아직 발행되지 않은 회차의 설정은 `upto`를 크게 줘도 나오지 않는다. `upto`는 독자의 진도에 맞춘 편의 값이고 보안 경계는 M이다(누구나 최댓값으로 부를 수 있다).
- `upto`는 1 이상의 정수여야 한다. 정수가 아니거나 1 미만이거나 빈 값이면 422(`upto 값을 확인해 주세요.`)이고, 이 검사는 어떤 조회보다 먼저다(없는 작품에 잘못된 `upto`를 보내도 422).
- 작품이 없거나 삭제됐으면 404다. 작품이 **공개가 아니면**(비공개·제한) 연결 여부를 알리지 않고 `worldId: null`·`upto: 0`·빈 목록 200을 준다. 공개 작품인데 연결된 세계관이 없으면 `worldId: null`·빈 목록 200이고, 연결은 있는데 확정 버전(sealed 현재 revision)이 없으면 `worldId`는 채우고 빈 목록 200이다(초안은 독자에게 보이지 않는다).
- **카드**는 연결된 세계관의 확정 버전에 있는 카드 중 삭제되지 않았고(`lifecycle=active`) 유효 공개 회차(DEC-53, 위 절)가 기준 회차 이하인 것이다. 응답의 `revealFromEpisode`가 그 유효 공개 회차(공개 값만 있던 기존 카드는 1)이고 카드는 `id` 순이다. `text`는 마크다운 문자열, `cardType`은 공개 세계관과 같은 카드 유형 코드다.
- 독자 설정 위키와 공개 세계관·가져오기·Fork의 **카드 기준은 같다**(DEC-53, [F-RGT-01](../requirements.md#f-rgt-01)). 카드의 `visibility`는 새 판정에 쓰지 않는다: 회차 값이 없는 기존 공개 카드만 '1화부터'로 읽고, 비공개 카드라도 공개 회차가 있으면 그 회차부터 보인다. 세계관 공개(목록 등재)만 별개다. 세계관이 비공개여도 연결된 소설이 공개이면 같다.
- **관계**는 Neo4j 관계를 기준 회차(`upto`) 시점으로 본 것(관계마다 그 회차 이하의 가장 최근 연결, 종료된 것은 제외, [DEC-51](worldstudio-independent-schema.md#회차별-관계--dec-51)) 중 양 끝이 위 `cards`에 있는 것만이며 `label`·`body`·`category`·`direction`·`polarity`를 준다. 그래서 아직 공개되지 않은 회차에서 생긴 관계는 보이지 않는다. 관계 저장소가 현재 상태를 보증하지 못하면 카드는 그대로 두고 `relationships: []`·`relationshipStatus: "unavailable"`이다. 보일 카드가 없어도 확장 적재 중에는 `"unavailable"`이며 그 밖에는 그래프를 읽지 않고 `"current"`다.
- `text`와 관계 `body`의 본문 링크는 공개 세계관 상세·Fork 이어받기와 같은 치환 함수를 거친다: 대상이 응답 `cards`에 없으면 글자만 남기고 id를 지운다([DEC-53 절](#본문-링크의-공개-응답)).
- 화면: 독자 설정 위키(`/work/:id/wiki`, 회차 화면에서는 `?upto=n`)가 이 API를 Bearer 없이 읽어 `worldId`가 있으면 카드를 유형별 문서로 보이고(본문 마크다운, 정보 상자에 별칭·태그·'N화부터', 관계는 양 끝 문서의 연결), `null`이면 기존 작품 설정 위키를 그대로 보인다. `unavailable`은 빈 연결과 구분해 알리고 조회 실패는 빈 위키로 바꾸지 않는다.

## Fork가 이어받는 원작 세계관 (DEC-32·37, #365)

Fork는 자기에게 연결한 세계관이 없으면 원작 세계관을 **읽기 전용**으로 이어받아 시뮬레이션·원고 검수가 읽는다(1단계: 읽기만 이어받기. 최초 수정 시 세계관 독립·원본 변경 알림은 범위 밖). 소유하지 않은 세계관이라 `world_studio_read`·`GET /api/v1/world-studios/{id}`(소유자만)로는 읽을 수 없어 전용 읽기를 둔다.

```text
InheritedWorld = { "workId": "<Fork>", "worldId": "<원작 세계관 uuid>" | null, "upto": <적용된 상한 회차>,
                   "cards": [ { "id", "title", "body", "cardType", "areaCode", "classification", "aliases": [..], "tags": [..],
                                "semanticMetadata": { "revealFromEpisode": n }, "visibility": "public", "lifecycle": "active" } ],
                   "relationships": [ { "id", "sourceCardId", "targetCardId", "category", "label", "direction", "polarity", "body": "", "semanticMetadata": {}, "lifecycle": "active" } ],
                   "relationshipStatus": "current" | "unavailable", "relationshipVersion": <graph token> }
```

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v1/works/{id}/inherited-world?upto=N` | Fork **소유자**만(Bearer). 200 + `InheritedWorld`. 남의 작품·없는 작품 404, `upto` 값 오류 422(1 이상의 정수, 어떤 조회보다 먼저) |
| MCP `work_inherited_world(id, upto?)` | 같은 Service 함수(`WorkWorldService.inheritedWorld`). AI의 `read_world`·원고 검수가 작가 Bearer로 부른다 |

- **이어받는 조건**: Fork에 자기 연결 세계관(`work.world_studio_id`)이 없고, `ForkWorldReference.status=following`이고, 삭제되지 않은 원작에 세계관이 연결돼 있을 때다. 하나라도 아니면(자기 세계관이 우선·독립한 Fork·추종 기록 없음·Fork가 아닌 작품·원작에 세계관 없음) `worldId: null`·`upto: 0`·빈 목록 200이고 화면·AI는 기존 '연결된 세계관 없음'으로 다룬다.
- **상한 회차** `upto`는 Fork 기준 회차(`source.episode`)이고 요청 `upto`가 더 작으면 그 회차다(생략하면 기준 회차). Fork의 자기 회차 내용은 원작 세계관에 없으므로 기준 회차를 넘기지 않는다.
- **카드**는 원작 세계관의 **확정 버전** 카드 중 `lifecycle=active`이고 유효 공개 회차(DEC-53)가 `upto` 이하인 것만이다. 독자 설정 위키와 **같은 카드 집합**이고 상한만 Fork 기준 회차(요청 `upto`가 더 작으면 그 값)다. 비공개 카드라도 공개 회차가 있으면 이어받고(DEC-46 때보다 범위가 넓어진다) 작가 전용 카드는 이어받지 않는다. 확정 버전이 없으면(초안만) 빈 목록이다. 카드는 `id` 순이다. 응답 모양은 그대로이고 `visibility`는 호환 값(`public`), `semanticMetadata.revealFromEpisode`는 유효 공개 회차이며 `text`의 본문 링크는 위와 같은 치환을 거친다.
- **관계**는 그 카드끼리의 `upto`화 시점 관계(DEC-51, `identity` 포함)만이다. 방향·긍정/부정(`polarity`)은 관계의 뜻이라 남기고, 작가가 관계에 적은 본문(`body`)·메모는 비운다. 관계 저장소가 그 시점 상태를 보증하지 못하면 카드는 두고 `relationships: []`·`relationshipStatus: "unavailable"`이며, AI는 관계 없이 진행하지 않고 실패로 끝낸다(`world_studio_read`가 관계 저장 미완료에 503으로 답하는 것과 같다). 보일 카드가 없으면 관계 저장소를 읽지 않는다.
- **싣지 않는 것**: 카드 메타데이터는 `revealFromEpisode`만이다. 인물 문서 `SOUL.md`·`GOAL.md`·`memory/NN회차.md`(`characterDocs`, 작가용), 가져온 출처, 이미지는 없다. 이어받은 인물은 `IDENTITY.md`(카드 본문)만 가진다.
- 원작의 현재 확정 버전을 매번 읽으므로 `following` 동안 원작의 변경(기준 회차 이하에 영향을 주는 것)을 따라간다(DEC-37). `independent` 전환(최초 수정 시 독립)은 아직 없어 모든 Fork가 `following`이다.
- 같은 계산을 `QaScopeService`가 쓴다: 관계 질문의 범위(`QaScope.world`)는 자기 회차에 연결한 세계관이 없을 때 이어받은 세계관의 `worldId`·`relationshipVersion`을 쓰고, 현재 관계 근거(`currentRelationships`)는 이어받은 관계만이다(원작 작가 권한으로 초안을 읽지 않는다). 상속 회차(원작 기준 이하)는 기존대로 원작 작가가 그 회차에 연결한 세계관을 쓴다.
- 화면: 집필실 시뮬레이션 시작 양식이 내 세계관 목록에 이 작품에 연결된 세계관이 없을 때 이 API를 `upto=<여는 회차>`로 읽어 인물 카드(`cardType=character`, 나레이터 카드 제외)를 후보로 쓴다. 후보와 서버 검증이 같은 카드 집합이다([시뮬레이션 계약](character-simulation-contract.md#fork-이어받기-365)).
- 한계: Fork 생성 미리보기(공개된 세계관 규칙·인물 수)는 아직 레거시 설정 이력 기준이다(후속). `SOUL.md`가 없는 이어받은 인물은 말투 근거가 약하다.

## 설정 가져오기와 카드 메타데이터 (DEC-46)

- **설정 가져오기에는 서버 전용 API가 없다.** 화면이 공개 상세(`GET /api/v1/public/world-studios/{id}`)로 읽은 공개 카드를 새 카드 id로 복사해 내 세계관 초안에 더하고 기존 초안 저장(`PUT /api/v1/world-studios/{id}/draft`)으로 반영한다. 그래서 가져올 수 있는 것은 공개 세계관의 확정 버전에서 기준 회차 이하로 공개된 카드(DEC-53)뿐이고(로그인한 누구나, 소유자의 별도 허용 절차 없음), 원본의 이후 변경·비공개 전환·삭제는 가져간 카드에 반영되지 않는다.
- 출처와 독자 공개 회차는 DB 칼럼을 더하지 않고 카드 `semanticMetadata`(jsonb)의 **최상위 키**에 둔다(`semanticMetadata.studio` 안이 아니다).

```text
"importedFrom": { "worldId", "worldName", "authorNickname", "revisionNo", "cardId" }   가져온 카드의 출처(가져온 시점의 값)
"revealFromEpisode": n                                                              독자 공개 시작 회차(1 이상의 정수)
"characterDocs": { "soul", "goal", "episodes": { "<회차 번호>": "글" } }          인물 카드의 작가용 문서(SOUL.md·GOAL.md·회차별 기억, 옛 "memory"는 읽을 때 episodes["0"]으로 옮김, DEC-47)
```

- 서버는 세 키를 **저장할 때 검사하지 않고 그대로 저장·반환**한다. `revealFromEpisode`는 읽을 때 닫힌 쪽으로 판정한다: 1 이상의 정수인 JSON 숫자(`3.0` 포함)일 때만 공개 회차로 읽는다. 키가 없으면 카드 `visibility=public`은 1, 그 밖은 작가 전용이고, **키가 있는데** 문자열·소수·0·음수·int 범위 밖·JSON `null`이면 작가 전용이다(`visibility`로 열지 않는다, DEC-53). `importedFrom`은 서버가 읽지 않는 표시용 값이고 **클라이언트가 적는 값이라 서버가 출처를 보증하지 않는다**. `characterDocs`는 인물 카드에만 화면이 적는 값이다(IDENTITY.md는 카드 본문 `body`): 공개 API의 카드 응답은 제목·본문·유형·별칭·태그뿐이라 이 문서는 공개 세계관·독자 설정 위키에 나가지 않는다. `episodes`의 키는 0 이상의 정수, 문서마다 3,000자 이하(화면 검증)이고 전부 비어 있으면 키를 넣지 않으며, 읽을 때 모양이 어긋난 값은 통째로 버리고 세계관 로드는 계속한다. 가져온 카드에는 따라오지 않는다(본문만 복사).
- 카드의 `visibility`는 기존 카드 필드(`private`|`public`) 그대로이며 초안 저장이 값을 검사한다(그 밖의 값은 422 `WORLD_INPUT_INVALID`). 소유자 API는 카드마다 저장한 `visibility`를 그대로 돌려준다. DEC-53 이후 새 화면은 `revealFromEpisode`만 정하고 `visibility`는 회차 값이 있으면 `public`, 없으면 `private`로 맞춰 저장하며 판정에는 쓰지 않는다([DEC-53 절](#카드-공개-기준-일원화--dec-53)).
- 화면 흐름(로그인한 회원에게만 보이는 진입점 셋): 공개 세계관 화면의 ① 설정집 게시판의 줄 선택(`보이는 설정 모두 선택` 포함) 뒤 `선택한 설정 가져오기 (N)`과 ② 설정 카드 페이지의 `이 설정 가져오기`는 이동 없이 고른 설정만 고른 내 세계관의 **초안에 바로 추가·저장**한다: 대상의 최신 초안을 읽어(`GET /api/v1/world-studios/{id}`) 새 카드를 끝에 붙이고 초안 저장을 보내며, 관계는 함께 오지 않고 진행·결과·실패 사유와 `다시 시도`를 그 자리에 보인다. ③ 내 세계관 관리 화면 게시판의 `다른 세계관에서 가져오기`는 가져오기 시트를 열며 공개 세계관 목록(대상 세계관 자신은 제외, 공개 설정이 0개인 세계관은 고를 수 없음) → 그 세계관의 공개 설정 체크 → `같이 가져온 카드 사이 관계 포함`(기본 꺼짐) 순서다. 공개 세계관 상세 헤더에서 이 시트로 이동하던 `내 세계관으로 가져오기`와 그 주소(`/worldstudio/<대상>?import=<원본>`)는 2026-11-12에 없앴다(사용자 결정).
- 가져온 카드는 초안 끝에 **새 카드 id·작가 전용(비공개·공개 회차 없음)**으로 더해지고 제목·본문·유형·별칭·태그만 옮긴다. 본문 링크는 같이 가져온 카드끼리만 새 id로 잇고 나머지는 글자로 둔다(DEC-53). 관계는 양 끝을 모두 가져온 것만 옮긴다. 기존 가져오기 화면은 양 끝 순서와 `label`을 쓰며, 새로 공개한 방향·본문·극성의 가져오기 반영은 화면 작업에서 별도로 확인한다. 관계를 불러오지 못한 응답(`relationshipStatus: unavailable`)이면 관계 포함을 고를 수 없고, 활성 카드 1,000개 한도를 넘기면 아무것도 더하지 않고 이유를 보인다. 화면은 가져온 카드에 `가져옴`과 `참고: {worldName} 세계관 · {authorNickname}`를 보인다.

## 설정 카드 대표 이미지 (#401, 2026-11-16 사용자 결정)

- 설정 카드마다 **대표 이미지 1장**(인물 초상·장소·사물 그림)을 둘 수 있다. 소유자가 직접 올린 PNG·JPEG·WebP 5MB 이하만 쓴다(세계관 표지와 같은 규칙). 본문 안 이미지 삽입과 AI 생성은 이 계약에 없다.
- 보이는 곳: 편집 화면 제목 옆, 설정집 게시판·카드 목록, 공개 세계관(설정집·카드 페이지), 독자 설정 위키. 관계도 노드에는 넣지 않는다.
- 공개 화면 노출은 **확정 버전 기준**이다(글과 같은 규칙). 이미지를 올리거나 바꿔도 `세계관 저장`(초안) 뒤 `확정 버전 남기기`를 해야 공개 세계관·독자 설정 위키에 나온다.

### 저장

WorldStudio 전용 마이그레이션 `V8__setting_card_image.sql`(V7 다음 번호).

```sql
CREATE TABLE worldstudio.setting_card_image (
    id uuid PRIMARY KEY,
    world_id uuid NOT NULL REFERENCES worldstudio.world(id),
    object_key text NOT NULL UNIQUE,
    content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX setting_card_image_world_idx ON worldstudio.setting_card_image(world_id);
```

- 바이트는 세계관 표지와 같은 객체 저장소(`AttachmentStorageClient`)의 `world-card-images/<id>` 키에 둔다. **올린 이미지는 바뀌지 않는다**(교체 = 새 이미지를 올리고 카드가 새 id를 가리킴). 그래서 확정 버전이 옛 id를 가리켜도 그 이미지가 그대로 보인다.
- 카드가 어떤 이미지를 쓰는지는 DB 칼럼을 더하지 않고 카드 `semanticMetadata`의 **최상위 키 `imageId`**(UUID 문자열, 없으면 키 없음)에 둔다. 출처·독자 공개 회차와 같은 자리다. 초안 저장이 그대로 보존하고, 확정 버전은 카드 `semanticMetadata`를 복사하므로 따로 처리하지 않는다.
- 초안 저장(`PUT /{id}/draft`)은 카드의 `imageId`가 **같은 세계관의 `setting_card_image` 행**일 때만 받는다. 형식 오류·없는 id·다른 세계관 id는 422 `WORLD_INPUT_INVALID`이고 저장하지 않는다(이전 초안 유지).
- ponytail: 참조를 지워도(이미지 빼기) 바이트와 행은 지우지 않는다. 확정 버전이 아직 가리킬 수 있기 때문이다. 어떤 버전도 가리키지 않는 이미지 정리(GC)는 없다(한계).

### 소유자 API (인증·CSRF, 기존 `/api/v1/world-studios` 규칙)

| 메서드·경로 | 동작 |
|---|---|
| `POST /api/v1/world-studios/{id}/card-images` | 소유자만. multipart `file`(PNG·JPEG·WebP, 5MB 이하, 내용 서명으로 형식 확인). 201 + `{ "imageId": "<uuid>", "contentType": "image/png" }`. 카드에 붙이는 것은 화면이 초안 `semanticMetadata.imageId`에 넣고 초안 저장으로 한다. 값 오류 422 `WORLD_INPUT_INVALID`(소유 확인보다 먼저, 표지와 같음), 비소유자 404 |
| `GET /api/v1/world-studios/{id}/card-images/{imageId}` | 소유자만 이미지 바이트. 없는 id·다른 세계관 id·비소유자 404 |

nginx `location ^~ /api/v1/world-studios/`의 `client_max_body_size 6m`이 이미 있어 라우팅 변경은 없다.

### 공개 API (비로그인 허용)

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v1/public/world-studios/{id}/card-images/{imageId}` | 공개 상세와 같은 기준(공개이고 확정 버전이 있는 세계관)이고, 그 확정 버전의 **보이는 카드(기준 회차 이하로 공개된 활성 카드, DEC-53) 중 하나가 `imageId`로 가리키는** 이미지일 때만 바이트. 그 밖에는 모두 404 |
| `GET /api/v1/public/works/{workId}/world-card-images/{imageId}?upto=N` | 독자 설정 위키(`/world-cards?upto=N`)와 같은 기준으로 반환되는 카드 중 하나가 가리키는 이미지일 때만 바이트. 그 밖에는 404 |

- 응답 헤더는 표지와 같다: 저장한 `Content-Type`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`.
- 공개 상세 카드와 독자 설정 위키 카드 응답에 `imageId`(없으면 `null`) 필드를 **추가**한다(기존 필드 그대로). 화면은 `imageId`가 있을 때만 위 공개 경로를 `<img src>`로 직접 읽는다.

### 화면

- 편집 화면 머리는 2열이다: 왼쪽 이름·유형, 오른쪽 세계관 헤더 표지와 같은 세로 타일(150px, 머리 폭이 좁으면 이름 아래 88px). 없으면 점선 빈 타일 전체가 `이미지 추가`, 있으면 이미지를 채우고 아래에 `바꾸기`·`빼기`(목업 초상도 같은 자리). 고르면 바로 `POST`로 올리고 초안 카드의 `semanticMetadata.imageId`를 바꾼다(저장 전 수정 표시 → `세계관 저장`). `빼기`는 키만 지운다.
- 소유자 이미지는 Bearer 인증이라 `<img src>`로 못 읽으므로 인증 `fetch` → Blob → object URL로 그리고, 바뀌거나 화면을 떠나면 URL을 해제한다.
- 설정집 게시판·카드 목록은 작은 썸네일, 없으면 지금처럼 비워 둔다.
- 설정 가져오기는 원본 세계관의 이미지를 복사하지 않는다: 가져온 카드에서 `imageId`를 뺀다(다른 세계관 id는 초안 저장이 422로 막기 때문). ponytail: 이미지까지 복사하려면 서버 복사 API가 필요하다(후속).
- 목업(`mockup`) 모드의 기존 초상(`presentationPortrait`)은 그대로 둔다.
- AI 입력(검토·채팅·시뮬레이션)에는 이미지를 넣지 않는다.
- 구현 메모: 업로드 422 문구는 표지와 같은 일반 문구, 독자 이미지의 `upto` 값 오류는 위키와 같이 422, UUID가 아닌 경로 변수는 400. 화면 썸네일 캐시는 `imageId` 기준이며 목업(`mockup`) 모드는 업로드를 잠근다.

## 구현 선택 (계약이 정하지 않은 부분)

- **이름·설명은 마지막 저장 버전의 값**이다. 저장하지 않은 초안의 이름·설명·카드·관계 수정은 다음 저장 전까지 공개 화면에 반영되지 않는다.
- **삭제로 표시된 카드**(`lifecycle=removed`)와 **작가 전용·기준 회차 뒤 카드**(유효 공개 회차가 없거나 기준 회차보다 큼, DEC-53)는 마지막 저장 버전에 남아 있어도 `cards`·`cardCount`에서 뺀다. 공개 세계관 조회는 `PublicWorldService.shownAt`이 유효 공개 회차 판정(`shownCardEpisode`)으로 거르고, 목록은 쿼리 `WorldRevisionCardRepository.cardVersionsOf`가 준 카드 버전을 같은 함수로 센다(DEC-53). 목록의 세계관별 기준 회차는 페이지 전체에 연결 작품 조회 한 번과 공개 작품의 마지막 발행 회차 쿼리(`WorkRepository.lastPublishedOfPublicWorks`) 한 번으로 센다. 삭제 카드를 빼는 것은 소유자 화면과 같은 기준이다.
- 관계는 `label`·`body`·`category`·`direction`·`polarity`를 공개하고 메타데이터는 응답에 없다(응답 필드는 위 '공개 API'와 같다).
- 목록의 `relationshipCount`는 상세의 `relationships`와 같은 기준(양 끝이 보이는 카드인 기준 회차 시점 관계)이다. 관계 저장소가 불확실한 세계관은 목록 전체를 실패시키지 않고 **null**로 둔다. 정확한 상태는 상세의 `relationshipStatus`를 본다.
- `page`는 0부터, `size`는 1~100이고 기본 `0`·`24`다. 음수·범위 밖·숫자가 아닌 `page`·`size`와 알 수 없는 `genre`는 422이며, 빈 `genre`(`?genre=`)는 전체로 읽는다.
- 오류 본문: 소유자 PUT은 기존 WorldStudio 오류(`WORLD_INPUT_INVALID`·`WORLD_NOT_FOUND`)와 같고, 공개 API는 Content 공통 `{ "detail": … }`다.
- `GenreTemplateSeeder`는 신규 템플릿의 세계관과 카드를 공개로 생성하고 확정 저장한다. 확정 전에는 노출되지 않으며, 공개 API는 봉인된 현재 버전의 활성 공개 카드만 반환한다. 기존 템플릿은 고정 입력·확정 이력·빈 관계 등 원본 판정을 통과하면 한 번 공개하며 세계관별 marker가 이후 비공개 선택을 보존한다. 일시 장애·미완료 요청이나 동결 리소스 누락은 판정을 보류하고 재시도하며, 그 사이 소유자의 명시적 선택은 다음 판정에서 보존한다. 과거 공개 해제나 장르·표지를 바꿨다가 현재 기본값으로 되돌린 이력은 구별할 수 없으나 현재 원본과 일치하면 1회 공개하는 것으로 사용자가 결정했다. 기존 비공개 카드 revision도 바꾸지 않으며 소유자가 카드를 공개로 바꾸고 새 확정 버전을 남겨야 보인다. 생성 실패 재시도와 소유자의 공개 해제는 [템플릿 계약](worldstudio-independent-schema.md#플랫폼-장르-템플릿-세계관)을 따른다.

## 한계

- 참조·추종 이용·세계관 Fork·파생·조합은 없다(DEC-35). 공개 세계관 응답에는 '가져간 세계관 수'가 없고, 연결된 소설은 상세에만 공개 작품 하나의 최소 정보(`linkedWork`)로 있다(목록에는 없고 비공개 소설의 존재는 알리지 않는다).
- 관계 이력 복원은 없다([#132 계약](worldstudio-independent-schema.md#현재-관계-mvp-계약--132), DEC-51로 회차 시점 조회만 있다). 공개 세계관·독자 설정 위키는 마지막 저장 버전의 카드와 기준 회차 시점 관계를 합쳐 보이는데 관계는 저장 버전과 묶여 있지 않으므로, 저장 이후 관계만 바뀌었다면 두 시점이 섞일 수 있다.
- 카드 이미지는 `imageId`로 가리키는 대표 이미지 한 장뿐이다(본문 삽입·AI 생성·여러 장·첨부 없음, #401). 공개 세계관 응답은 보이는 카드만 담고 카드의 `visibility`·공개 회차 값은 싣지 않는다(독자 설정 위키만 유효 공개 회차를 `revealFromEpisode`로 싣는다). 세계관 표지는 소유자 업로드 한 장뿐이고 AI 생성·크롭·여러 장·대체 텍스트는 없다.
- 표지의 WebP는 디코딩하지 않고 RIFF 구조만 확인한다(JDK가 읽지 못한다). 교체·삭제 중 DB 갱신이 실패하면 새 객체가, 이전 객체 삭제가 실패하면 이전 객체가 객체 저장소에 남을 수 있고 정리하지 않는다(운영자 몫, 보상 트랜잭션 없음).
- 목록 정렬은 최근 공개순 하나이고 검색어·복수 장르·카드 수 정렬은 없다. 목록은 세계관마다 Neo4j를 한 번씩 읽는다(한 쪽 최대 100번). 공개 세계관이 늘면 한 쿼리로 묶는 조회와 `(visibility, published_at)` 부분 인덱스를 둔다.
- 목록의 `total`은 쿼리가 센 수다. 확정되지 않은 현재 버전의 세계관이 있다면(`current_revision_id`는 확정 뒤에만 정해져 지금은 생기지 않는다) `items`보다 클 수 있고, 생기면 목록 쿼리에 `sealed` 조건을 둔다.
- 공개 응답은 캐시하지 않는다. 비공개 전환의 즉시성은 이 때문이다. 표지도 `no-store`라 공개 목록이 열릴 때마다 표지를 다시 받는다.
- 연결(DEC-46)은 작품당 세계관 하나·세계관당 작품 하나뿐이고 연결 이력은 남기지 않는다. 연결·해제는 소유자만 하고 운영자용 경로는 없다.
- 독자 설정 위키는 **확정 버전의 카드**와 **현재** 관계를 합쳐 보인다(위 공개 상세와 같은 한계). 초안에서 바꾼 카드 내용·공개 범위·독자 공개 회차는 확정 버전을 남겨야 공개 세계관과 독자 설정 위키에 반영된다. 독자 공개에는 시작 회차만 있고 끝 회차·회차별 내용 차이는 없다.
- 독자 설정 위키는 비로그인 공개 API 하나뿐이라 공개가 아닌 작품은 소유자 본인이 읽어도 빈 응답이다(소유자용 미리보기 API 없음).
- `revealFromEpisode`·`importedFrom`은 저장할 때 형식을 검사하지 않는다. 가져오기 출처는 클라이언트가 적으므로 서버가 위조를 막지 않는다. 화면은 독자 공개 회차가 1 이상의 정수인지만 검사하고 발행된 회차를 넘는지는 검사하지 않는다(서버가 발행된 회차 안에서만 보인다).
- 설정 가져오기: 가져온 관계의 방향·종류·부정 여부는 알 수 없다(공개 응답이 `label`만 준다). 설정 영역·자유 분류도 공개 응답에 없어 기본값으로 들어온다. 같은 카드를 다시 가져오면 중복 카드가 생기고 이미 가져왔다는 표시는 없다. 가져올 세계관 목록은 화면이 읽는 최근 공개분까지이고 검색은 없다. 공개 화면의 바로 추가는 대상 세계관의 최신 초안에 덧붙여 저장하므로, 그 세계관을 다른 탭에서 편집 중이면 그쪽의 다음 저장이 충돌한다. 원본 쪽에서 '가져간 세계관 수'를 세지 않는다.
- 본문 링크의 글자는 대상이 숨어 있어도 그대로 남는다(서버는 id만 지운다). 이른 카드의 글에 늦은 카드의 이름이 나오는 것은 공개 순서 규칙이 경고할 뿐 막지 않고, 카드 본문·관계 `label`·`body` 같은 자유 글에 직접 쓴 비밀 이름은 서버가 알 수 없다(DEC-53).
- 링크로 알아보는 모양은 정규식 하나뿐이다. 다른 모양(`<card:<uuid>>`·`[글자](<card:<uuid>>)`·제목이 붙은 링크·글자에 대괄호나 줄바꿈이 든 링크)은 파서가 링크로 읽어도 링크가 아니라 글자이고 화면도 링크로 그리지 않는다. 다만 그 안에 남은 `card:<uuid>`(대소문자 무시)는 대상이 응답에 실리는 보이는 카드가 아니면 서버가 지워 숨은 카드의 id가 응답 어디에도 남지 않게 한다. 링크 하나는 약 45자를 쓰며 카드 본문 3,000자 한도에 포함된다.
- 기준 회차는 소설의 발행 상태를 따라 움직인다. 연결 해제·공개 중단·작품 삭제로 기준 회차가 내려가면 그 회차 뒤에 공개되도록 정한 카드가 같이 숨는다(값은 그대로라 다시 올라가면 돌아온다). 소설을 공개하기 전에는 연결된 세계관이 목록·상세에 카드 0개로 나온다.
- 적용 전에 확인할 것: 소설에 연결된 세계관마다 '공개 + 회차 없음' 건수(독자 위키에 1화부터 새로 보인다), 시연 데이터의 '비공개 + 회차 N' 카드(`/worlds`·Fork 인물 후보가 늘어난다)와 시연 시나리오·`test_world.py`.

## 검증 상태

- 로컬 단위 테스트(`./gradlew unitTest`, JDK 21): 공개 노출 판정·장르/공개 범위 검증·카드 공개 판정·관계 필터·독자 공개 회차 판정·`upto`·페이지 검증(`PublicWorldRulesTest`), 공개 서비스의 공개 카드 필터와 독자 카드 조회(`PublicWorldServiceTest`), 연결·해제·409·독자 설정 위키의 기준 회차와 빈 응답·404·422(`WorkWorldServiceTest`), 연결·위키 경로와 소유자 세계관 응답의 `linkedWorkId`(`WorkWorldControllerTest`), 작품 삭제 시 연결 해제(`WorkDeleteServiceTest`), 소유자 응답에만 나오는 `worldStudioId`(`WorkSearchServiceTest`), 템플릿 카드 공개(`GenreTemplateSeederTest`), V37 SQL과 전역 버전 목록(`ContentBoundaryTest`), 소유자 PUT·목록·상세 필드(`WorldStudioServiceTest`), 표지 검증(`WorldCoverRulesTest`: 형식·크기·바이트 시그니처·저장소 실패 변환), 소유자 표지 서비스(`WorldCoverServiceTest`: 저장→DB→이전 객체 삭제 순서와 실패 처리), 표지 컨트롤러 바인딩(`WorldCoverControllerTest`), 공개 상세의 연결된 소설(공개 작품이면 최소 정보를 싣고 작가는 세계관 작가와 같은 Core 조회 한 번, 비공개·제한·삭제·연결 없음은 `null`이며 작가·표지를 조회하지 않음, 목록은 읽지 않음, `PublicWorldServiceTest`).
- 새 `@Query` 3개(`StudioWorldRepository.listed`·`listedByGenre`, `WorldRevisionCardRepository.publicCardIds`: DEC-46에서 공개 카드 조건을 더해 `activeCardIds`에서 개명)는 DB 없이 H2로 구문·매핑·정렬·필터·count를 확인했고, 파생 쿼리 `WorkRepository.findAllByWorldStudioIdIn`은 이름 해석(PartTree)과 `work.world_studio_id`의 nullable `uuid` 매핑을 확인했다. 컬럼 타입 일치(`ddl-auto=validate`)와 실제 PostgreSQL 결과는 CI가 확인한다.
- **hosted CI 대기(로컬 미실행)**: `PublicWorldHttpIntegrationTest`(공개 목록·상세, 비공개 제외, 비로그인 접근, 소유자 PUT 404/422/401/403, 관계 `unavailable`), `WorldCoverHttpIntegrationTest`(소유자 표지 PUT·GET·DELETE의 401/403/404/422, 공개 표지의 노출 기준, 교체 시 이전 객체 삭제, `hasCover`)와 V7까지 세는 `InitialWorldStoragePostgresTest`·`WorldStudioFlywayPostgresTest`·`WorldStudioMigrationPostgresTest`·`WorldStudioHistoryPostgresTest`. DEC-46 몫으로 `PublicWorldHttpIntegrationTest`에 비공개 카드와 그 관계가 상세·목록 수에서 빠지는지를 더했고, 새 `WorkWorldHttpIntegrationTest`(연결 401/403/404/400/200·멱등·409 `WORLD_ALREADY_LINKED`·해제·작품 삭제 시 해제, 소유자 응답의 `worldStudioId`·`linkedWorkId`, 독자 설정 위키의 공개 전 작품·확정 버전 없음·발행 회차 상한·`upto` 422·없는 작품 404·관계 필터·`unavailable`)와 Content 전역 V37을 세는 `ContentMigrationTest`·`StoryPlanMigrationPostgresTest`·`AttachmentMigrationLocationTest`도 **작성만 했고 로컬에서 실행하지 않았다**. #329로 `WorkWorldHttpIntegrationTest`에 공개 세계관 상세의 `linkedWork`(공개 소설 표시·발행 전 소설 `null`·연결 해제 `null`·재연결·목록 응답에 없음) 단언도 더했고 마찬가지로 작성만 했다.
- **DEC-53(2026-11-18)**: 2단계 공개 기준 일원화(유효 공개 회차 `shownCardEpisode`·기준 회차·목록 쿼리와 기준 회차 배치 쿼리·화면의 공개 입력 하나·일괄 공개 회차)는 소스 구현과 로컬 단위 테스트(규칙·서비스·출구 매트릭스·화면 순수 함수·어댑터)를 통과했고, hosted CI 통합 테스트·WorldStudioPage 렌더 테스트·브라우저 육안 확인은 미확인이다. 본문 링크 치환 함수(`hideCardLinks`)·가져오기의 링크 id 매핑·화면의 링크 이동과 백링크·공개 순서 점검(3단계)도 소스 구현과 로컬 단위 테스트(링크 검증 표·출구 매트릭스·화면 순수 함수)·링크 관련 렌더 테스트 5개 파일(jsdom)을 통과했고 hosted CI 통합·전체 렌더 레인·브라우저 육안 확인은 미확인이다. 4단계 「동일 인물」(저장 규칙·시뮬레이션·관계 편집·공개 표시)도 소스 구현과 로컬 단위 테스트를 통과했고 같은 CI·육안 확인 전이다. 연결을 바꾸기 전에 새로 공개되거나 가려질 카드 수를 알리고 확인받는 화면(위 '연결·해제·공개 중단' 표)은 아직 없다.

## 세계관 삭제 (2026-11-17 사용자 결정)

- 소유자가 세계관을 삭제하면 **소프트 삭제**다: 행·초안·확정 버전·카드 버전·이미지·표지·Neo4j 관계는 지우지 않고 `worldstudio.world.deleted_at`만 찍는다. 되살리는 API는 없다(데이터 보존).
- 삭제된 세계관은 소유자에게도 없는 것이다. 내 목록(`GET /api/v1/world-studios`)에서 빠지고, 소유자 상세·초안 저장·확정 버전·공개 설정·표지·카드 이미지·AI 분석 등 `/{id}` 아래 소유자 API는 모두 404(`WORLD_NOT_FOUND`)다. 공개 목록·상세·표지·카드 이미지(`/api/v1/public/world-studios…`)도 404이고 목록의 `total`에도 세지 않는다. 같은 UUID로 다시 만들 수도 없다(소유자 검사에서 404).
- **연결된 소설(`work.world_studio_id`)이 있으면 삭제할 수 없다**: 409 `WORLD_LINKED`("작품 관리에서 연결을 해제한 뒤 삭제하세요"). 정본이 Content 쪽이라 컨트롤러가 연결을 먼저 읽어 서비스에 넘기고, 서비스는 소유 확인(404) 뒤에 거절한다. 삭제된 세계관은 새 소설에 연결할 수 없다(404). 그래서 독자 설정 위키(`/public/works/{id}/world-cards`)가 가리키는 세계관은 삭제되지 않는다.
- 소유자가 아니면 404다. 장르 템플릿 세계관은 운영 관리자 소유라 같은 검사로 남이 지울 수 없다. 서버 시작 시 시더는 삭제된 템플릿을 다시 만들지 않고 오류 로그만 남긴다.
- ponytail: 연결 확인과 삭제 사이(서로 다른 transaction)에 다른 요청이 소설을 연결하는 경합 구간은 막지 않는다(데모 범위). 삭제 뒤 정리(GC)도 없다.

### 저장 (V9)

WorldStudio 전용 마이그레이션 `V9__world_soft_delete.sql`(V8 다음 번호). 기존 행은 모두 삭제되지 않은 채 남고 다른 데이터는 바꾸지 않는다.

```sql
ALTER TABLE worldstudio.world ADD COLUMN deleted_at timestamptz;
```

### 소유자 API (인증·CSRF, 기존 `/api/v1/world-studios` 규칙)

| 메서드·경로 | 동작 |
|---|---|
| `DELETE /api/v1/world-studios/{id}` | 소유자만. 204(본문 없음). 연결된 소설이 있으면 409 `WORLD_LINKED`, 비소유자·없는·이미 삭제된 세계관은 404 |

공개 조회는 `StudioWorldRepository`의 `lockOwned`·`listed`·`listedByGenre` 쿼리와 `PublicWorldService.listedWorld`·`readerSnapshot`, `WorldCoverService.read`·`WorldCardImageService.read`(소유자 읽기), `WorkWorldService.link`의 `findById` 확인이 `deleted_at`을 거른다(독자 설정 위키는 지운 세계관이면 카드 0, 이미지는 404). 새 조회를 더할 때도 같은 조건을 둔다.

### 화면

- 세계관 관리 헤더의 정보 편집 패널에 `세계관 삭제`가 있다. 누르면 세계관 이름을 보이며 "목록에서 사라져요"를 확인하고, 지우면 `/lib?tab=worlds`로 이동한다. 연결된 소설이 있으면 버튼을 이유와 함께 잠그고, 서버가 거절해도(409 등) 그 이유를 그대로 보인다. 서버가 없는 데모(`mockup`)는 메모리에서 지운다.
