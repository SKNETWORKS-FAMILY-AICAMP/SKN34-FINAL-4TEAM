# 장르 관리 계약 (DEC-56)

작품 장르와 공개 세계관 장르를 **하나의 목록**으로 합치고, 운영 관리자 화면에서 그 목록을 관리한다(2026-11-20 사용자 결정). 정본은 Content의 기존 `genre` 테이블이다. 운영 서비스는 테이블을 갖지 않고 Content에 요청한다(DEC-41).

## 지금 (develop, 바꾸기 전)

| 위치 | 내용 |
|---|---|
| Content `genre`(`work/V1`) | `id·code·name` 30행(`genre-01` 판타지 … `genre-30` 기타). 시드로만 들어가고 바꾸는 API가 없다 |
| Content `work_genre` | 작품당 장르 최대 2개(`MAX_WORK_GENRES`) |
| Content `WorkMetadata.WORK_GENRES` | 작품 저장 허용 목록(같은 30개, 하드코딩) |
| 프런트 `LibraryUseCase.NOVEL_GENRES` | 작품 장르 선택지(같은 30개, 하드코딩) |
| WorldStudio `world.genre`(`worldstudio/V6`) | 별도 체계: 영문 코드 7개 CHECK 제약(`fantasy·sf·wuxia·romance·modern·classic·mystery`), Content `WORLD_GENRES`·프런트 `PUBLIC_WORLD_GENRES` 하드코딩 |

## 정본과 저장

- **정본:** Content `genre` 테이블. 다음 번호 Content 마이그레이션(V42)으로 칸 둘을 더한다.
  - `active boolean NOT NULL DEFAULT true`: 숨김 여부
  - `position int NOT NULL`: 표시 순서. 기존 행은 코드 순(`genre-01`=1 …)으로 채운다
  - `name`에 UNIQUE를 더한다(같은 이름 두 개 금지).
- **코드(`code`)는 바꾸지 않는다.** 새 장르는 서버가 다음 번호로 만든다(`genre-31` …). `id`=`code`(기존 규칙).
- **삭제는 없다.** 작품·세계관이 참조하므로 숨김만 한다.

## 세계관 장르 합치기

- WorldStudio 다음 번호 마이그레이션(V13)이 `world.genre`의 CHECK 제약을 지우고 기존 값을 Content 장르 코드로 바꾼다.

  | 옛 코드 | 새 코드 | 이름 |
  |---|---|---|
  | `fantasy` | `genre-01` | 판타지 |
  | `wuxia` | `genre-03` | 무협 |
  | `romance` | `genre-06` | 로맨스 |
  | `modern` | `genre-10` | 현대 |
  | `sf` | `genre-14` | SF |
  | `mystery` | `genre-18` | 미스터리 |
  | `classic` | `genre-28` | 고전 |

- WorldStudio는 별도 마이그레이션 이력이라 DB 외래키를 걸지 않는다. 대신 같은 데이터소스의 Content `genre`를 서비스가 확인한다(`worldGenre` 검사를 목록 조회로 바꾼다).
- 세계관 장르는 지금처럼 **하나**(미지정 `null`)다.
- 장르 템플릿 시더의 템플릿 장르 매핑(`GenreTemplateSeeder.TEMPLATE_WORLD_GENRES`)은 새 코드로 바꾼다. 템플릿의 동결 입력·원본 판정 hash에 `world.genre`가 들어가는지 구현 전에 확인한다(들어가면 기존 값 보존 방식을 다시 정한다).
- 공개 목록 필터 `GET /public/world-studios?genre=`는 새 코드(`genre-01` …)를 받는다. 옛 영문 코드는 받지 않는다(시연 프로젝트, 링크를 남기지 않음).

## 선택·검사 규칙 (작품·세계관 공통)

- 새로 고를 수 있는 장르는 **활성(`active`) 장르**뿐이다.
- 이미 숨긴 장르가 붙은 작품·세계관은 그대로 보인다. 저장할 때 **그 값을 바꾸지 않으면** 통과한다(숨긴 장르를 새로 붙이는 것만 막는다).
- 작품 장르 최대 2개, 세계관 1개는 그대로다.
- 장르 추천 AI(`work-tags`)에 보내는 `allowedGenres`는 활성 장르 이름 목록이다(하드코딩 목록 대신).
- 검색 색인은 장르 이름으로 저장한다. 이름을 바꾸면 다음 색인 작업 때 반영되고, 그 사이에는 옛 이름으로 검색된다(한계).

## API

### Content 공개
| 경로 | 설명 |
|---|---|
| `GET /api/v1/public/genres` | 활성 장르 `[{code, name}]`, `position ASC`. 비로그인 가능. 작품·세계관 장르 선택지와 검색 칩이 쓴다 |

### Content 내부 (운영 서비스 토큰 체인, `/internal/v1/works`와 같은 인증)
| 경로 | 설명 |
|---|---|
| `GET /internal/v1/genres` | 전체 장르(숨김 포함) `[{code, name, active, position, workCount, worldCount}]`. 사용 수는 집계 쿼리 한 번씩(N+1 금지) |
| `POST /internal/v1/genres` | `{name}` → 201 새 장르(맨 뒤 순서, 활성). 이름 1~30자, 앞뒤 공백 제거, 중복은 409 `GENRE_NAME_TAKEN` |
| `PATCH /internal/v1/genres/{code}` | `{name?, active?}` → 200. 이름 중복 409, 없는 코드 404 |
| `PUT /internal/v1/genres/order` | `{codes: [...]}`(전체 코드를 한 번씩) → 200. 빠짐·중복·없는 코드는 422 |

### 운영 공개 (회원 Bearer, `operator` + `works` 권한)
`/api/v1/operations/genres`의 GET·POST, `/{code}` PATCH, `/order` PUT이 Content 내부 API를 그대로 중계한다. 오류는 `{code, message}`, Content 실패는 502. 끝 슬래시 없음. 처리마다 활동 로그를 남긴다(`GENRE_CREATE`·`GENRE_UPDATE`·`GENRE_REORDER`). nginx·Vite에 `/api/v1/operations/genres`를 운영으로 연다.

## 화면

- **관리자 `콘텐츠 관리 > 장르`**(`/admin?tab=genres`): 장르 표(순서·이름·상태·작품 수·세계관 수·조치), 추가 폼, 이름 바꾸기, 숨기기/다시 보이기(확인 뒤), 위·아래로 순서 옮기기. 권한이 없으면(403) 안내만.
- **작품 등록·수정, 세계관 공개 설정, 검색 장르 칩**: 하드코딩 목록 대신 `GET /public/genres`를 읽는다. 읽지 못하면 선택지를 빈 목록으로 채우지 않고 실패와 다시 불러오기를 보인다.

## 한계

- 이름을 바꾸면 검색 색인은 다음 색인 작업까지 옛 이름이다.
- 장르를 숨겨도 이미 붙은 작품·세계관의 표시는 그대로다(일괄 교체 기능 없음).
