# 작품 검색·실시간 랭킹 계약

기능표 44(작품 검색)와 홈 "실시간 인기"·랭킹 화면을 Content 공개 API에 연결하는 MVP 계약이다.
검색·랭킹은 [DEC-41](service-boundaries.md) 기준 Content 책임이며 별도 검색 서버·Elasticsearch는 쓰지 않는다
([유스케이스](../usecase.md) MVP: DB 검색으로 대체).

## 결정

- 검색 대상: 공개 작품의 제목·작가명·해시태그·장르(본문 제외). 작가명은 작품 소유자의 **Core 최신 닉네임**이며 `f=author`로 찾고
  `f=all`에도 포함한다. 응답 때마다 소유자 ID 묶음으로 Core 내부 닉네임 조회를 한 번 호출해 채우고(없는 회원은 `탈퇴한 회원`, Core 실패는 503),
  Content `work.author_name` 칼럼은 더 이상 읽지 않는다([회차 댓글 계약](episode-comment-contract.md#core-회원-닉네임-조회-내부), 2026-11-09 사용자 결정).
- 정렬: `latest`(기본, 기존 공개 목록 순서인 작품 생성 최신순)·`like`(화면 "인기 순", 공개 좋아요 수 내림차순 — requirements F-PUB-05 '좋아요순')·`view`(최근 24시간 조회수).
  좋아요 수(`likes`)는 [독서 관리 계약](reading-management-contract.md)(21-A)의 값이다. 모든 정렬의 동점은 작품 생성 최신순이다.
- 페이지(기능 44 "검색 결과 페이지 조회", 2026-11-10 사용자 결정): `page`(0부터)·`size`(기본 20, 1~100)를 선택 매개변수로 받아
  정렬을 마친 결과에서 그 구간만 돌려준다. 하나만 오면 나머지는 `page=0`·`size=20`이다. 둘 다 생략하면 기존처럼 전체를 돌려준다(홈·서재·작품 상세가 쓰는 공개 목록 호환).
  응답은 기존 `WorkListResponse` 배열 그대로이며 총 개수는 주지 않는다. 화면은 받은 개수가 `size`보다 적으면 마지막 페이지로 본다.
- 태그별 목록(`/tag`)·빠른 이동 후보(Ctrl/Cmd+K)는 전용 API 없이 실제 모드에서 공개 작품 목록(`GET /public/works`)을 받아 화면이 거른다
  (2026-11-10 사용자 결정: 현행 유지·결함만 보완).
- 조회 기록: 로그인 회원이 공개 작품의 발행 회차를 열 때 **회원·회차별 하루(Asia/Seoul 날짜) 1회**만 기록한다(유스케이스 규칙).
  익명 열람은 회원 식별이 없어 기록하지 않는다.
- 실시간 인기 TOP10: 최근 24시간(`now-24h ~ now`) 조회 수 내림차순, 조회 0인 작품 제외, 최대 10개.
- 급상승: 최근 24시간 조회 수 − 그 전 24시간 조회 수가 큰 순서, 증가분 0 이하 제외, 최대 10개.
- 동점은 작품 생성 최신순으로 정한다.
- 운영이 제한한 작품(`work.restricted`)과 소프트 삭제된 작품(`work.deleted_at`)은 공개 작품이 아니다. 공개 여부는 `WorkAccessResult.publiclyVisible()` 하나로 판단하므로
  제한·삭제 작품은 검색·랭킹에서 빠지고 조회 기록도 404다([운영 계약](operations-member-report-contract.md#content-내부-api-운영-전용)).

## 저장

`backend/content-service/src/main/resources/db/migration/work/V14__work_view.sql`(V13은 운영 작품 제한 `work_restriction`이다)

```sql
CREATE TABLE work_view (
    work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_number integer NOT NULL CHECK (episode_number > 0),
    member_id varchar(200) NOT NULL,
    view_date date NOT NULL,
    viewed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (work_id, episode_number, member_id, view_date)
);
CREATE INDEX work_view_viewed_at ON work_view (viewed_at);
```

작품 삭제는 소프트 삭제이므로(DEC-42) 조회 기록은 보존하고, 삭제된 작품은 검색·랭킹에서 제외한다.

## 공개 API

| 메서드·경로 | 인증 | 동작 |
|---|---|---|
| `GET /api/v1/public/works?q=&f=all\|title\|author\|tag\|genre&sort=latest\|like\|view&page=&size=` | 익명 | 매개변수 없으면 기존 공개 목록과 같다. `q`는 trim 후 대소문자 무시 부분 일치(`author`는 소유자 Core 닉네임), `tag`는 앞 `#` 무시. `page`·`size` 중 하나라도 오면 정렬 후 `page*size`부터 `size`개(범위 밖 page는 빈 배열). 잘못된 `f`·`sort`, 음수 `page`, 1~100 밖 `size`, 숫자 아닌 값은 422 |
| `GET /api/v1/public/works/ranking?kind=top\|rising` | 익명 | 위 규칙의 최대 10개 `WorkListResponse`. 잘못된 `kind`는 422 |
| `POST /api/v1/works/{id}/episodes/{number}/views` | 회원 | 공개 작품의 발행 회차면 기록(같은 날 중복은 무시)하고 204. 비공개·운영 제한·미발행 회차는 404. 소유자 검사 없음 |

`WorkResponse`에 `views: Long`(최근 24시간 조회 수, 기본 0)을 추가한다. 기존 필드·응답 구조는 바꾸지 않는다.
작품 좋아요(21-A)가 같은 방식으로 `likes: Long`(공개 좋아요 수, 기본 0)과 `liked: Boolean`(공개 상세에서 Bearer가 온 회원의 좋아요 여부, 그 밖은 false)을 더한다.
`likes`는 공개 목록·검색·랭킹·상세에서 작품 ID 묶음으로 한 번에 세며(`views`처럼) 소유자 목록·상세 응답에서는 0이다.
공개 상세(`GET /api/v1/public/works/{id}`)만 `episodeViews: Map<회차 번호, Long>`(회차별 **누적** 회원 조회 수, 같은 `work_view` 행 수, 기록 없는 회차는 빠짐)을 채우고
그 밖의 응답은 `null`이다. 비회원 조회는 기록하지 않아 세지 않는다.
소설 상세(`/work/:id`)는 목록 응답에 이 필드가 없어 상세를 따로 읽어(`ReadingUseCase.episodeViews` → `WorkSearchRepository.episodeViews`, 익명 GET) 자체 회차에 눈 아이콘과 조회 수로 보여 준다.
기록 없는 자체 회차는 0이고, Fork의 상속 회차(원작 몫)는 이 작품에 기록하지 않으므로 수를 보이지 않으며, 읽지 못하면 0으로 채우지 않고 수를 감춘다.

## Frontend

- `domain/repositories`에 검색·랭킹·조회 기록 계약을 두고 `data`에 HTTP 구현(Zod 검증)을 둔다. `ReadingUseCase`가 이 저장소로
  홈 랭킹 줄과 `/search`의 `findWorks`, `/rank`의 `rankWorks`(아래 기능 45 절의 `rankings`)를 채운다. `--mode mockup`은 기존 메모리 동작을 유지한다.
- `/search` 정렬 선택지는 최신 순·인기 순(`like`)·조회 순이다. 첫 20개를 받고, 마지막으로 받은 서버 페이지가 20개면
  목록 아래 "더 보기" 버튼으로 다음 페이지를 이어 붙인다. 검색어·범위·정렬이 바뀌면 첫 페이지부터 다시 받는다. 메모리 데모는 한 번에 전부 보여 준다.
  `/rank`는 정렬 선택지·더 보기가 없고 기준·기간별 랭킹이다(아래 기능 45 절).
- 홈 장르 칩(고전·판타지·SF)은 서버 검색 `f=genre&q=<장르>&sort=like`(페이지 없이 전체)로 채우고, 실패는 홈 오류·재시도로 보인다.
  홈 "오늘, 스토리포크의 발견"은 랭킹·최신과 겹치지 않게 공개 목록(작품 생성 최신순)을 뒤집은 오래된 순이다. 새 API는 없다.
  에디터 Pick(관리자 선정)은 만들지 않고 기능표 46 추천 시스템(홈 맞춤·세계관 추천, 기준 미정)으로 예정한다(소설 상세의 비슷한 작품은 이 절 끝의 추천 규칙으로 구현했다). 「소설 모아 보기」 줄은 그때까지 공개 목록 앞 6개다.
- 홈 TOP10·랭킹 화면의 "데모" 문구를 실제 기준(최근 24시간 조회)으로 바꾼다.
- 검색 범위는 전체·제목·작가·태그·장르다. 결과 카드는 `/work/:id`로 연결한다. 공개 목록·검색·랭킹은 같은 `WorkResponse`를 한 매퍼
  (`mapReadingWork`, 작가=`authorName`)로 `Work`에 옮기고 샘플 이관의 작품 상세·열람은 같은 서버 목록에서 id로 작품을 찾으므로
  카드의 id가 실제 작품 상세로 열린다.
- 서버에 없는 댓글 수·갱신 시각은 카드 `Work`에 `statisticsSupported: false`를 달아 `/search`·`/rank` 카드가 표시하지 않는다
  (조회 수는 서버 값이라 표시). `Work.likes`는 서버의 공개 좋아요 수이며 카드·목록은 같은 표시 묶음으로 감추고 소설 상세(`/work/:id`)가
  보여 준다. 메모리 데모 작품은 그대로 표시한다.
- 조회 기록은 실제 공개 회차를 표시하는 화면에서 로그인 회원일 때 보낸다. 기록 실패는 읽기를 막지 않는다.
  `/content`는 내 작품 관리 화면이라 공개 열람을 하지 않고 조회를 기록하지 않는다.
  회차별 열람 화면(`/read/:id/:n`)은 로그인 회원이 서버 작품의 자체 회차를 열 때 그 회차 번호로 기록한다. Fork의 상속 회차
  (원작 몫)·소유자가 여는 비공개 작품·익명·메모리 데모 작품은 요청하지 않고, 기록 실패는 읽기를 막지 않는다(`ReadingUseCase.openEpisode`).
- 소설 상세 아래 추천(기능표 46)은 새 API 없이 이 공개 검색을 인기 순(`sort=like`)으로 두 번 재사용한다: '이 작가의 다른 작품'(`f=author`, 작가명이 정확히 같은 작품만·자기 제외)과 '비슷한 작품'(첫 장르 `f=genre`, 자기·같은 작가 목록과 오른쪽 포크 박스가 이미 보여 주는 현재 작품의 포크·원작·같은 원작의 형제 포크 제외, 해시태그 겹침 순). 각 6개까지, 검색 첫 장(20개) 안에서 거르고 빈 목록은 숨기며 실패는 섹션별 안내와 다시 불러오기로 보인다. 비슷한 세계관 추천은 공개 세계관 둘러보기 이후라 만들지 않았다.

## ponytail 한계

- 작가명·작가 검색은 공개 목록마다 Core 닉네임 조회에 의존한다(캐시 없음, Core 장애 시 503).
- 검색은 공개 작품 목록을 메모리에서 거르고 정렬한다(시연 규모). 랭킹은 조회 기록이 있는 작품만 읽어 순위 10개만 응답으로 조립한다.
  작품 수가 늘면 SQL 조건·페이지네이션으로 옮긴다.
- 페이지는 전체 공개 목록을 메모리에서 정렬한 뒤 자른다(작가 닉네임 조회도 전체 대상). 총 개수가 없어 마지막 페이지가 정확히 20개면
  "더 보기"를 한 번 더 눌러 빈 결과를 받은 뒤 버튼이 사라진다. 작품 수가 늘면 SQL `LIMIT/OFFSET`과 개수 응답으로 옮긴다.
- 기존 `ranking`(top·rising)은 롤링 24시간 두 구간뿐이다(주간·월간은 아래 기능 45의 `rankings`).

## 기간별 랭킹·인기 추이 (기능표 45)

2026-11-10 사용자 결정으로 기능표 45의 남은 행(전체·원작·Fork 랭킹, 인기 순위, 방금 업데이트, 최신 Fork, 이번 주 인기 무료,
집계 기준, 기간별 집계, 갱신 시각)을 위 실시간 랭킹 위에 더한다. 새 테이블·마이그레이션은 없다.

### 집계 기준

| `kind` | 점수(큰 순) | 제외 | 동점 |
|---|---|---|---|
| `view` | 기간 안 조회 수(`work_view.viewed_at`) | 0 | 작품 생성 최신순 |
| `rising` | 기간 안 조회 수 − 바로 앞 같은 길이 기간 조회 수 | 0 이하 | 작품 생성 최신순 |
| `popular` | 기간 안 새 좋아요 수(`work_like.created_at`) | 0 | 기간 안 조회 수 → 작품 생성 최신순 |
| `latest` | 작품 생성 시각 | 없음 | — |
| `updated` | 그 작품 회차의 마지막 발행 시각(`episode_current`와 같은 기준으로 `outcome=applied`인 publish·republish·replace `publication_event.occurred_at`의 최댓값) | 발행 기록 없음 | 작품 생성 최신순 |

- `period`: `day`(24시간)·`week`(7일)·`month`(30일), 기본 `day`. 모두 요청 시각 기준 롤링 구간이며 `latest`·`updated`는 기간을 쓰지 않는다.
- `type`: `all`(기본)·`original`(원작, `source` 없음)·`fork`(Fork). 순위는 이 범위 안에서 매긴다(상위 N개를 자른 뒤 거르지 않는다).
- `limit`: 1~50, 기본 10.
- 대상은 위 공개 판단(`publiclyVisible()`)을 통과한 작품뿐이다. 비공개·운영 제한·삭제 작품은 빠진다.
- 유료 열람이 없으므로 모든 공개 작품은 무료다. "이번 주 인기 무료 소설"은 `kind=popular&period=week`이다.
- 집계는 요청마다 계산한다(배치·스냅샷 없음). 응답 `computedAt`이 계산 시각이며 화면은 이를 "HH:mm 기준"으로 보인다.

### 공개 API

| 메서드·경로 | 인증 | 동작 |
|---|---|---|
| `GET /api/v1/public/works/rankings?kind=view\|rising\|popular\|latest\|updated&period=day\|week\|month&type=all\|original\|fork&limit=` | 익명 | `{ "items": WorkResponse[], "computedAt": ISO-8601, "kind", "period", "type" }`. `kind`는 필수(누락은 400, 기존 `ranking`과 같음), 나머지는 선택. 잘못된 값·숫자가 아니거나 범위 밖인 `limit`은 422 |

- `items[].views`는 그 `period`의 조회 수, `items[].likes`는 기존과 같은 전체 공개 좋아요 수다.
  `updated`는 `items[].updatedAt`(마지막 발행 시각)을 채운다. `WorkResponse.updatedAt: Instant?`는 다른 응답에서는 null이다.
- 기존 `GET /api/v1/public/works/ranking?kind=top|rising`은 바꾸지 않는다(새 화면은 `rankings`를 쓴다).
- 새 매핑은 `WorkController`가 아닌 새 Controller 파일에 두어 Content 매핑 기준선(`content_extraction_baseline.json`)을 건드리지 않는다.

### Frontend

- `WorkSearchRepository`에 `rankings(query)`를 더하고 `{ items: Work[], computedAt: Date }`를 돌려준다. 매퍼는 `mapReadingWork`를 그대로 쓴다.
  `updatedAt`이 있으면 카드 `Work.upd`(기존 의미: 지난 분)에 `computedAt − updatedAt`을 분으로 넣는다.
- `/rank`: 범위 탭(전체·원작·포크 = `type`), 기준(조회·인기·급상승·최신·방금 업데이트 = `kind`), 기간(일간·주간·월간 = `period`,
  `latest`·`updated`에서는 숨기고 주소에서도 뺌)을 주소 쿼리(`t`·`kind`·`period`)로 두고, 머리말에 "HH:mm 기준"을 보인다. 인기 순 카드는 좋아요 수를 보인다. 페이지 없이 상위 최대 50개(기능 44의 더 보기는 `/search`만)다. 검색은 `/search`가 맡는다. `--mode mockup`은 기간을 쓰지 않으므로 기간 선택·문구와 계산 시각을 숨긴다.
- 홈: 실시간 인기 TOP10 = `view/day`, 급상승 = `rising/day`, 포크 소설 줄 = `latest/fork`, "방금 업데이트" = `updated`(5개),
  "이번 주 인기 무료 소설" = `popular/week`(4개). TOP10 머리에 계산 시각을 보인다(랭킹 줄이 하나라도 실패하면 숨김). 홈 '무료' 칩은 서버 작품 전체(무료)를 보인다.
- 실패는 섹션별로 실패 안내를 보이고 빈 목록으로 숨기지 않는다. `--mode mockup`은 기존 메모리 정렬을 유지한다.

### ponytail 한계

- 요청마다 조회·좋아요·발행 기록을 기간 안에서 다시 센다(캐시·배치 없음). 작품·조회가 늘면 집계 테이블이나 캐시로 옮긴다.
- 좋아요 취소는 하드 삭제라 기간 안 좋아요 수는 "지금 남아 있는 좋아요 중 그 기간에 누른 것"이다.
- 익명 조회는 기록하지 않으므로(위 결정) 조회 기준 순위에 들어가지 않는다.
