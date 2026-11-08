# 작품 검색·실시간 랭킹 계약

기능표 44(작품 검색)와 홈 "실시간 인기"·랭킹 화면을 Content 공개 API에 연결하는 MVP 계약이다.
검색·랭킹은 [DEC-41](service-boundaries.md) 기준 Content 책임이며 별도 검색 서버·Elasticsearch는 쓰지 않는다
([유스케이스](../usecase.md) MVP: DB 검색으로 대체).

## 결정

- 검색 대상: 공개 작품의 제목·작가명·해시태그·장르(본문 제외). 작가명은 Content `work.author_name`(작가 표시명)이며 `f=author`로 찾고
  `f=all`에도 포함한다. 작가 닉네임의 정본은 Core이고 Content에는 샘플 이관 등으로 채운 표시명뿐이다. API로 새로 만든 작품은 기본값
  `작성자`다(Core 닉네임과 동기화하지 않는다).
- 정렬: `latest`(기본, 기존 공개 목록 순서인 작품 생성 최신순)·`view`(최근 24시간 조회수). 좋아요(인기 순)는 좋아요 기능이 없어 범위 밖이다.
- 조회 기록: 로그인 회원이 공개 작품의 발행 회차를 열 때 **회원·회차별 하루(Asia/Seoul 날짜) 1회**만 기록한다(유스케이스 규칙).
  익명 열람은 회원 식별이 없어 기록하지 않는다.
- 실시간 인기 TOP10: 최근 24시간(`now-24h ~ now`) 조회 수 내림차순, 조회 0인 작품 제외, 최대 10개.
- 급상승: 최근 24시간 조회 수 − 그 전 24시간 조회 수가 큰 순서, 증가분 0 이하 제외, 최대 10개.
- 동점은 작품 생성 최신순으로 정한다.

## 저장

`backend/content-service/src/main/resources/db/migration/work/V13__work_view.sql`

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

발행 이력이 있는 작품은 삭제가 409이므로 조회 기록이 있는 작품의 삭제 경로는 생기지 않는다.

## 공개 API

| 메서드·경로 | 인증 | 동작 |
|---|---|---|
| `GET /api/v1/public/works?q=&f=all\|title\|author\|tag\|genre&sort=latest\|view` | 익명 | 매개변수 없으면 기존 공개 목록과 같다. `q`는 trim 후 대소문자 무시 부분 일치(`author`는 `author_name`), `tag`는 앞 `#` 무시. 잘못된 `f`·`sort`는 422 |
| `GET /api/v1/public/works/ranking?kind=top\|rising` | 익명 | 위 규칙의 최대 10개 `WorkListResponse`. 잘못된 `kind`는 422 |
| `POST /api/v1/works/{id}/episodes/{number}/views` | 회원 | 공개 작품의 발행 회차면 기록(같은 날 중복은 무시)하고 204. 비공개·미발행 회차는 404. 소유자 검사 없음 |

`WorkResponse`에 `views: Long`(최근 24시간 조회 수, 기본 0)을 추가한다. 기존 필드·응답 구조는 바꾸지 않는다.

## Frontend

- `domain/repositories`에 검색·랭킹·조회 기록 계약을 두고 `data`에 HTTP 구현(Zod 검증)을 둔다. `ReadingUseCase`가 이 저장소로
  홈 `top10`·`rising`과 `/search`·`/rank`의 `findWorks`를 채운다. `--mode mockup`은 기존 메모리 동작을 유지한다.
- 홈 TOP10·랭킹 화면의 "데모" 문구를 실제 기준(최근 24시간 조회)으로 바꾼다.
- 검색 범위는 전체·제목·작가·태그·장르다. 결과 카드는 `/work/:id`로 연결한다. 공개 목록·검색·랭킹은 같은 `WorkResponse`를 한 매퍼
  (`mapReadingWork`, 작가=`authorName`)로 `Work`에 옮기고 샘플 이관의 작품 상세·열람은 같은 서버 목록에서 id로 작품을 찾으므로
  카드의 id가 실제 작품 상세로 열린다.
- 서버에 없는 좋아요·갱신 시각은 카드 `Work`에 `statisticsSupported: false`를 달아 `/search`·`/rank` 카드가 표시하지 않는다
  (조회 수는 서버 값이라 표시). 메모리 데모 작품은 그대로 표시한다.
- 조회 기록은 실제 공개 회차를 표시하는 화면에서 로그인 회원일 때 보낸다. 기록 실패는 읽기를 막지 않는다.
  develop의 공개 열람(`/content`)은 한 화면에 전체 회차를 보여 주므로 상속이 아닌 첫 발행 회차 1건만 기록한다(작품당 회원 하루 1회).
  회차별 열람 화면은 샘플 이관 병합 때 연 회차를 기록한다.

## ponytail 한계

- 작가 검색은 `author_name` 표시명만 본다(Core 닉네임·계정과 동기화하지 않는다).
- 검색·랭킹은 공개 작품 목록을 메모리에서 거르고 정렬한다(시연 규모). 작품 수가 늘면 SQL 조건·페이지네이션으로 옮긴다.
- 서버 페이지네이션 없음. 기간 집계는 롤링 24시간 두 구간만 있고 주간 집계는 없다.
