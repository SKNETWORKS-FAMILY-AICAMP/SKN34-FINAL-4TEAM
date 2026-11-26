# 운영 콘텐츠 관리 Content 계약 (회차 제한·공개 세계관 제한·카드 카테고리, 2026-11-23)

운영자가 작품 아래 회차, 공개 세계관(DEC-45), 세계관 카드 카테고리를 운영 화면에서 다룬다(사용자 결정 2026-11-23). 정본과 실제 조치는 Content가,
관리자 권한(`works`)과 활동 기록은 운영 서비스가 소유한다([서비스 경계](service-boundaries.md), DEC-41). 운영 서비스의 공개 API·활동 기록은
[운영 작품 조회 계약](operations-work-contract.md#콘텐츠-운영-관리-확장-회차세계관카드-카테고리-2026-11-23)이 정하고, 이 문서는 Content가 하는 일만 정한다.

- 운영자는 모든 작품을 **열람만** 하고 내용은 고치지 못한다(`operatorReading()`). 아래 제한·카테고리는 그 규칙과 별개인 운영 조치다.
- 내부 API는 `/internal/v1/**`의 운영 서비스 토큰 체인만 지나고 공개 proxy에 등록하지 않는다. 목록 응답은 `{items}` 래퍼 없는 맨 배열이다.
- 마이그레이션: Content `episode/V46`, WorldStudio `V17`(세계관 제한)·`V18`(카드 카테고리).

## 회차 제한

### 저장
`episode.restricted boolean NOT NULL DEFAULT false`(V46)이고 `episode_current` 뷰가 끝에 `restricted`를 더한다: **자기 회차의 값 OR 물려받은 원작 회차의 값**
(체크포인트가 가리키는 원작 회차). 상속 회차의 제한을 따로 저장하지 않으므로 원작 회차를 풀면 그 회차를 물려받은 Fork 회차도 같이 풀린다.
`published_version_id`·`publication_status`는 그대로라 작가 쪽(집필·저장·발행·회차 목록)은 영향이 없다.

### 독자 경로(제한 회차는 404이거나 목록에서 빠진다)

| 경로 | 동작 |
|---|---|
| 독자용 회차 목록·본문·이미지·Story Context | `WorkAccessResult.readerEpisodes`(독자 회차 판정 한 곳)가 제한 회차를 뺀다. 공개 작품 상세의 `episodes`·`forkableEpisodes`, 공개 이미지, 독자용 Context가 이 목록을 쓴다 |
| Q&A 범위 | 독자(`owner` 없음)의 범위에서 뺀다. 작가 범위는 그대로 |
| 조회수 기록·독서 기록 | 404, 저장하지 않는다 |
| 댓글 | 목록·작성·수정·삭제·좋아요 404, 작품 전체 댓글 목록에서도 그 회차의 댓글을 뺀다 |
| 수정 제안 등록·회차 제보(등록·회차별 목록·조회) | 404 |
| 독자 회차 지정 설정 읽기(`WorldController.publicRead`, `?episode=`, MCP `work_world_public_read`) | 404 |
| 공개 세계관·독자 설정 위키의 기준 회차 | 발행된 마지막 회차를 셀 때 제한 회차를 뺀다(`PublicWorldService`의 상세·이미지 기준과 목록 쿼리 `WorkRepository.lastPublishedOfPublicWorks`, `WorkWorldService.readerBasis`가 같은 값). 마지막 회차가 제한이면 기준이 내려가 그 회차 뒤에 공개되는 카드는 다시 숨는다 |
| AI 자율 연재 독자 게시판([계약](ai-serial-contract.md)) | 게시판의 대상 회차나 그 앞의 마지막 발행 회차가 제한이면 `serial-board`는 board 없음·빈 선택지/제안 글(종합 문장은 그 게시판이 발행한 회차가 제한일 때만 숨김), 투표·제안·추천 쓰기는 404다. 일정 점검은 그 게시판의 실행을 건너뛴다(제한이 풀리면 재개, 게시판 데이터는 그대로) |

단건 확인은 `EpisodeCurrentEntity.readerVersionId`(발행본이 있고 제한이 아닐 때만 값이 있음) 한 곳을 쓴다. 작가 쪽은 `publishedVersionId`를 그대로 쓴다.
작가용 작품 응답의 `PublishedEpisodeResponse`에는 `restricted`가 실리고(독자용 응답에는 제한 회차가 목록에서 빠져 있다) 작가용 회차 응답에는 제한 표시가 없다.

### Fork
- 원작 회차를 제한하면 이미 만든 Fork의 상속 회차도 독자에게 숨는다(뷰가 계산).
- 제한된 회차를 **기준 회차**로 새 Fork를 만들면 409 `EPISODE_RESTRICTED`다(발행되지 않은 기준은 기존대로 422, 정책상 불가는 403). 기준 앞의 제한 회차는 번호가 비지 않게 그대로 복사하고 뷰가 독자에게 숨긴다.

### 내부 API
```text
OperationsEpisode = { number, title, publicationStatus: 'published'|'draft'|'suspended', restricted, inherited }
```

| 메서드·경로 | 동작 |
|---|---|
| `GET /internal/v1/works/{workId}/episodes` | `OperationsEpisode[]`(번호순, 본문 없음, 쿼리 한 번). `title`은 발행 버전 제목이고 없으면 초안 제목, 집필 흔적 없는 빈 자리 회차는 뺀다. 없는·삭제 작품 404 |
| `PUT`·`DELETE /internal/v1/works/{workId}/episodes/{number}/restriction` | 그 회차 한 원소(멱등). 작가 저장과 같은 작품 행 잠금으로 직렬화한다. 상속 회차는 409 `EPISODE_INHERITED`(원작 회차를 제한해야 함), 없는 회차·없는 작품 404 |

## 공개 세계관 제한

`worldstudio.world.restricted boolean NOT NULL DEFAULT false`(V17). 제한하면 **공개 세계관 경로**만 404다: 목록(`world-studios`, `genre`·`q` 포함)·상세·카드 검색(`/cards`)·표지·카드 이미지.
가져오기는 서버 전용 API 없이 공개 상세를 읽어 하므로 같이 막힌다. 소유자 열람·편집, 연결된 소설의 독자 설정 위키, Fork 이어받기, 소설 쪽 `linkedWork`는 건드리지 않는다(작품은 작품 제한으로).
검색 색인의 후보가 제한 세계관이어도 공개 기준을 다시 거르므로 나오지 않고, 다음 색인 동기화 때 색인에서도 빠진다.

```text
OperationsWorld = { worldId, ownerId, name, visibility: 'public'|'private', published, restricted, genre: code|null, linkedWorkId: string|null, createdAt }
```

| 메서드·경로 | 동작 |
|---|---|
| `GET /internal/v1/world-studios` | 지우지 않은 전체 세계관(비공개·제한 포함) `OperationsWorld[]`, 최신순. `name`은 저장 버전 이름이 있으면 그것(공개 목록이 보이는 이름), 없으면 초안 이름이다. `published`는 저장 버전이 있어 공개 목록에 나올 수 있다는 뜻이고 공개 여부는 `visibility`, 제한은 `restricted`가 따로 말한다. `linkedWorkId`는 연결된 소설(1:1, DEC-46, `WorkWorldService.linkedWorkIds` 재사용). 이름은 확정 버전·초안을, 연결은 작품을 각각 쿼리 한 번으로 읽는다 |
| `PUT`·`DELETE /internal/v1/world-studios/{worldId}/restriction` | 그 세계관 한 원소(멱등). 없는·지운 세계관 404 |

## 세계관 카드 카테고리

장르(DEC-56)와 같은 방식이다. 정본은 WorldStudio `card_category` 표(V18)이고 카드(`setting_card_draft`·`setting_card_version`)는 FK 없이 `card_type` 코드로 가리킨다.
V18이 두 표의 `card_type` CHECK(기본 8종 고정)를 지우고, 코드가 있는지는 서비스가 확인한다. **삭제는 없고** 숨김만 한다.

| 열 | 내용 |
|---|---|
| `code` | PK. 기본 8종은 `character`·`location`·`organization`·`ability`·`object`·`rule`·`event`·`other`(시드, 이름 인물·장소·조직·능력·사물·규칙·사건·기타), 운영이 더하는 코드는 서버가 `category-NN`으로 만든다(장르 코드와 같은 번호 부여: 같은 접두의 최댓값 다음, 빈 번호는 채우지 않음, 첫 추가는 `category-01`) |
| `name` | UNIQUE, 앞뒤 공백 제거 1~30자(코드 포인트) |
| `icon` | 선택, 앞뒤 공백 제거 8자(코드 포인트) 이하(장르 `emoji`와 같은 규칙), 빈 문자열이면 없음 |
| `active`·`position` | 숨김 여부, 표시 순서(1부터) |

### 카드 유형 검사
- 카드를 저장하는 `WorldStudioService.edit`이 한 곳에서 확인한다: `cardType`은 존재하는 코드여야 하고, **새로 정하는 값은 활성 카테고리만**(어긋나면 422 `지원하지 않는 카드 유형입니다.`). 그 카드가 이미 쓰던 값은 숨긴 카테고리여도 유지할 수 있다(숨긴 카테고리를 쓰는 카드도 그대로 보이고 저장된다).
- 분석 반영·원고 구축·시더(AI·시스템이 정한 기본 8종을 그대로 저장하는 쓰기)는 존재만 본다. 운영이 기본 카테고리를 숨겨도 이 파이프라인은 멈추지 않는다.

### AI로 보낼 때
AI가 아는 카드 유형은 기본 8종뿐이라 Content가 보낼 때 그 밖의 코드는 `other`로 바꾼다(`aiCardType`): 설정집 AI 검토 요청(`WorldReviewInput`)과 카드를 싣는 **모든 MCP 도구 응답**(`mcp/McpAiCards.kt`의 `forAi`): 초안(`world_studio_read`·`world_studio_create`·`world_studio_edit_draft`), 확정 버전(`world_studio_revision_read`·`world_studio_save_revision`), 공개 세계관(`world_studio_public_read`), 독자 설정 위키(`work_public_world_cards`), 이어받은 세계관(`work_inherited_world`). `world_studio_public_list`는 카드를 싣지 않는다. 같은 응답을 쓰는 REST는 바꾸지 않는다(화면은 카테고리 코드를 그대로 쓴다).
초기 분석 입력은 `character·location·organization·ability·object` 카드만 개체로 보내므로(기존 규칙) 추가 카테고리 카드는 이미 빠진다. AI 결과는 기본 8종 그대로 저장한다.

### API
| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v1/public/card-categories`(비로그인) | **숨김 포함 전체** `[{code, name, icon, position, active}]`, `position` 순. 화면이 새로 고를 선택지에서는 `active`만 거르고, 숨긴 카테고리를 이미 쓰는 카드는 이름을 그대로 보인다. `ContentSecurityConfig`의 `GET` `permitAll`에 경로를 더했고 nginx·Vite는 프런트 몫이다 |
| `GET /internal/v1/card-categories` | 전체 `[{code, name, icon, active, position, cardCount}]`(숨김 포함, `position` 순). `cardCount`는 지우지 않은 세계관의 활성 카드 초안 수이고 집계 쿼리 한 번이다 |
| `POST /internal/v1/card-categories` | `{name, icon?}` → 201 원소(맨 뒤 순서, 활성). 이름 중복 409 `CARD_CATEGORY_NAME_TAKEN`, 입력 오류 422 |
| `PATCH /internal/v1/card-categories/{code}` | `{name?, icon?, active?}`(`icon: ""`은 지움) → 원소. 기본 8종도 이름·아이콘·숨김을 바꿀 수 있다. 이름 중복 409, 없는 코드 404 |
| `PUT /internal/v1/card-categories/order` | `{codes}`(전체 코드를 한 번씩) → 배열. 빠짐·중복·없는 코드 422 |

쓰기는 모든 행을 잠근 트랜잭션 하나에서 검사·저장하고 응답은 커밋 뒤에 만든다.

## 한계

- 회차·세계관 제한·해제도 작가(작품·세계관 소유자)에게 알린다(#941 완료 조건). 회차는 작품 제한과 같은 `content.operator.work-restricted`·`work-unrestricted`에 회차 번호를 싣고, 세계관은 `content.operator.world-restricted`·`world-unrestricted`다([알림 계약](mcp-change-notice-contract.md#운영자-조치-알림)).
- MCP에서 `other`로 받은 카드를 AI가 다시 저장하면 그 카드의 유형이 `other`로 저장된다(AI 결과는 기본 8종 그대로 저장한다는 결정). 작가가 고른 추가 카테고리를 지키려면 AI가 고친 카드만 보내게 하는 기존 규칙(`replace=false`)이 필요하다.
- 기준 회차는 제한이 아닌 발행 회차 중 가장 큰 번호다. 가운데 회차만 제한이면 기준은 그대로라 그 회차에서 처음 공개되는 카드도 기준 안에 있으면 보인다.
- 두 운영 목록(회차·세계관)과 카테고리 목록은 페이지네이션이 없다(운영 규모, 장르와 같음).
- 카테고리 번호를 두 운영자가 동시에 부여하면 PK 충돌로 한쪽이 500이다(장르와 같은 한계, 운영자 한 명이 쓰는 화면).
