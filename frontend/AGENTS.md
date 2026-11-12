# Frontend 구현 지침

`frontend/**`에 적용한다. [루트 공통 지침](../AGENTS.md)을 함께 따른다.
nginx/Vite는 `/api/v1/works`·`/api/v1/public/works`·`/api/v1/world-studios`·`/api/v1/public/world-studios`와 하위 경로를 Content, `/api/v1/operations/{reports,members,admins,support,works,comments,admin/notices,public/notices,admin/events,public/events,admin/activities}`와 하위 경로를 Operations, 나머지 `/api`를 Core로 라우팅한다(서비스 토큰용 `/api/v1/operations/{notices,events,inquiries}`는 열지 않는다).
`/content`·UUID `/studio/{id}`와 작품 목록·상세·회차 열람·공개 wiki·Fork 생성은 Content API(`HttpWorkRepository`)를 쓰고,
실제 작품(canonical) 회차 열람의 댓글은 `HttpEpisodeCommentRepository`([계약](../docs/design/episode-comment-contract.md))를, 메모리 데모 작품의 댓글은 메모리 저장소를 쓴다. 소설 상세 아래의 작품 전체 댓글(읽기 전용, `GET /public/works/{id}/comments`)도 같은 Repository의 `listByWork`를 쓰며 데모 작품은 "데모에서는 지원하지 않아요"로 알린다. 실제 작품의 문장 피드백(제보)·회차 제보 목록·내 제보·작가 피드백함 제보는 `HttpFeedbackReportRepository`를 쓴다([계약](../docs/design/feedback-report-suggestion-contract.md)). 실제 작품의 문장 수정 제안·작가 피드백함 수정 제안 승인·내 제안은 `HttpEditSuggestionRepository`를 쓴다([계약](../docs/design/feedback-report-suggestion-contract.md)). 소설 상세 소식 탭(작품 공지)의 목록·작성·수정·고정·삭제는 실제 작품이면 `HttpWorkNoticeRepository`([계약](../docs/design/work-notice-contract.md))를, 메모리 데모 작품이면 "데모 소식" 안내와 함께 메모리 저장소를 쓴다.
`/content` 작품 관리의 작품 정보 편집은 제목·소개와 함께 서버 값과 달라진 장르·해시태그만 `PUT /works/{id}`에 싣고(생략하면 서버가 유지), '받은 피드백' 탭은 작가 피드백함과 같은 조회에 `workId` 쿼리를 보내 서버가 그 작품 것만 주며(화면이 다시 거르지 않는다), 회차별 포크 수는 새 API 없이 소설 상세와 같은 `ReadingUseCase` 작품 목록으로 센다(읽지 못하면 수를 감춘다). 표지의 'AI로 생성'은 연결 전이라 비활성·'준비 중'이다. 실서버 집필실(`/studio/{UUID}?ep=n`)은 n화를 처음에 연다.
좋아요·관심 작품·독서 기록은 Content API(`HttpWorkLikeRepository`·`HttpWorkInterestRepository`·`HttpReadingRecordRepository`, [계약](../docs/design/reading-management-contract.md))를 쓰고, 나머지 데모는 별도 메모리 저장소다. 관리자 이벤트 탭과 회원 `/me/event`는 운영 이벤트 API(`HttpEventRepository`)를 쓴다([계약](../docs/design/operations-event-contract.md)). 관리자 작품 탭은 운영 작품 API(`HttpOperationsWorkRepository`)를 쓴다([계약](../docs/design/operations-work-contract.md)). 관리자 댓글 탭은 운영 댓글 API(`HttpOperationsCommentRepository`)를 쓰고, 회차 댓글은 운영 숨김(`hidden`)을 자리표시로 그린다([계약](../docs/design/operations-comment-contract.md)). 관리자 활동 로그 탭은 운영 활동 기록 API(`HttpAdminActivityRepository`)를 쓴다([계약](../docs/design/operations-admin-activity-contract.md)). 화면 존재와 서버 기능 완료를 구분한다.
계정 '결제 내역'(`/me/pay`)의 보유 크레딧·지급/사용/소멸 내역은 Core 크레딧 API(`HttpCreditLedgerRepository`)를 쓴다([계약](../docs/design/credit-ledger-contract.md)). 상단 계정 메뉴의 '보유 크레딧' 줄도 같은 API의 잔액만 읽는다(`useCreditBalance`, 읽지 못하면 0으로 채우지 않는다). 스튜디오 데모 AI 차감(`CreditUseCase`)은 별도 메모리 상태이며 바꾸지 않는다.
홈 실시간 인기·급상승·최신 포크·방금 업데이트·이번 주 인기와 `/rank`는 Content 기간별 랭킹 API(`/public/works/rankings`)를, 홈 장르 칩과 `/search`는 공개 검색 API(`/public/works`, 인기 순·페이지)를 쓴다(`--mode mockup`은 시드 메모리 작품·검색).
계약은 [작품 검색·랭킹](../docs/design/work-search-ranking-contract.md)이다.
실제 모드 `/import`·집필실 원고 내보내기·설정 첨부 이름 변경·회차 이미지 목록과 대체 텍스트는 Content 원고 가져오기·내보내기 API(`HttpManuscriptRepository`·`HttpMediaRepository`)를 쓴다.
`--mode mockup`은 기존 데모 가져오기 화면을 유지하고, 데모 집필실의 TXT 초안 내보내기만 메모리로 만들며 나머지는 "데모에서는 지원하지 않아요" 오류를 낸다.
계약은 [원고 가져오기·내보내기](../docs/design/manuscript-import-export-contract.md)다.
`/worlds`(공개 세계관 추천 대시보드: 장르 칩 아래 홈과 같은 2단(왼쪽 장르→세계관 지도(노드 그래프), 오른쪽 최근 공개 순 '실시간 인기' 순위)과 '새로 공개된 세계관' 선반·모아 보기)·`/worlds/:id`(제목·작가 아래 설정 그래프·인물관계도·설정집 세 탭, `?tab=graph|people|book`; 설정집은 왼쪽 분류 메뉴(`?type=`)와 오른쪽 게시판 표(번호·분류·제목·요약·연결, 검색·정렬)에 표 아래 개요(`nw-*` 나무위키 정보 상자·표지)이고, 서버 `relationshipStatus`가 `unavailable`이면 인물관계도가 "관계를 불러오지 못했어요"로 알리며, 어느 탭이든 하단 홈 선반 형식의 '이 세계관을 쓴 작품'·'연결된 세계관'은 서버에 없어 "작품 연결 기능 준비 중"·"파생·조합 기능 준비 중")·`/worlds/:id/cards/:cardId`(설정 카드 한 장의 나무위키 형식 페이지, `cardId`는 서버 카드 id: 빵부스러기·정보 표·번호 목차·접이식 문단(개요·관계·연관 설정·가리키는 설정·같은 유형)·이전/다음; 그래프·지도의 카드 노드를 누르면 열림)는 비로그인도 읽는 Content 공개 세계관 API(`HttpPublicWorldRepository`, `GET /public/world-studios?genre=&page=&size=`·`GET /public/world-studios/{id}`, [계약](../docs/design/public-world-contract.md))를 `PublicWorldUseCase`로 읽는다(목록은 24개씩 최대 4쪽을 이어 붙이고, 장르 칩은 `genre` 쿼리로 모아 보기만 다시 읽으며, 불러오는 중·실패(다시 시도)·공개된 세계관 없음(`/lib?tab=worlds` 안내)·비공개/없는 세계관(404)을 실제 결과대로 그린다). `--mode mockup`은 `data/mock/InMemoryPublicWorldRepository`가 데모 세계관 26개(파생·조합·작품·카드 점은 이 데모에만 있고 "데모" 안내를 띄움)로 같은 계약을 답한다. 내 세계관 `/worldstudio/:id`는 `/content` 작품 관리와 같은 틀(`episode-app`·`ep-*`)의 관리 화면(서재 `/lib?tab=worlds`로 돌아가는 링크·공개 상세 모양 헤더)이고 `/worldstudio`는 새 세계관 만들기다. 만들기 화면과 내 세계관 목록은 세계관 없는 주소 `/worldstudio`에서만 그리며 `/worldstudio/:id`에는 숨겨서라도 두지 않는다. 세계관을 처음 만든 직후(만들기 화면이 이동하는 `/worldstudio/{id}?new=1`, 새로고침해도 유지)만 **작성 모드**로 보기 전환 줄 없이 기본 정보(이름·설명·공개 설정)부터 4단계 마법사 카드를 보인다. 마법사의 첫 저장이 성공하거나 '관리 화면으로'를 누르면 `new` 쿼리를 `replace`로 지워 **관리 모드**로 바뀌고(초점은 헤더 제목, 쓰던 입력은 그대로) 판정은 `worldStudioFlow.studioMode`(주소의 쿼리)다. 그 밖의 모든 진입(서재 '관리하기'·직접 주소, 저장 버전 0인 세계관 포함)은 관리 모드로, 단계 없이 두 화면이다. **설정집 화면**(기본)은 헤더 아래 보기 전환 줄(설정집·인물 관계도·시간선, 주소 `?view=people|timeline`로 유지·복원, 보기 이동은 같은 화면 이동이라 미저장 변경을 잃지 않고 이탈 확인도 하지 않는다)과 줄 오른쪽의 `AI 후보 검토 (대기 N)` 버튼(후보 검토 시트)·`확정 버전 남기기`(편집 화면 버전 그래프와 같은 확정 버전 시트를 연다, 저장하지 않은 변경이 있으면 이유와 함께 잠긴다)·상시 저장 영역을 보인다. 옛 `?tab=`은 인물 관계도→`?view=people`, AI 후보 검토→후보 검토 시트, 그 밖(설정집·확정 버전·세계관 탐색)→설정집으로 `replace`한다(세계관 탐색 탭은 없다: 미리보기는 헤더의 '공개 화면 보기', 시간선은 보기 전환). **편집 화면**(주소 `?card=<id>`, 게시판 행의 제목·`+ 새 설정`·집필 메모 추가로 열고 `← 설정집`·브라우저 뒤로가기로 돌아오며 돌아오면 그 카드의 행에 초점이 간다, 설정집 화면은 숨겨 두어 필터·입력·후보 검토 상태를 지킨다)은 집필실(`WritingStudio`)과 같은 3단이다: 왼쪽 레일(설정 카드 목록·검색·분류 필터·현재 카드 강조·항목 ⋮ 메뉴의 삭제·`+ 새 설정` 아이콘)과 크기 조절선 아래 버전 그래프(작업 초안(저장 안 됨 표시)과 확정 버전 줄, 확정 버전을 누르거나 `확정 버전 남기기`를 누르면 확정 버전 시트에서 읽기 전용 카드를 보거나 확정하고, 관계는 현재 상태만 보관한다는 안내), 가운데 편집기(큰 이름 입력·설명(Toast UI Editor 3 마크다운, 지연 로딩, 공개 카드 페이지는 `## 제목` 문단으로 렌더)·유형·연관 설정·상세 설정과 글자 수·삭제가 있는 하단 바), 오른쪽 AI 채팅이다. 저장 영역은 바뀐 것이 있으면 '저장하지 않은 변경 있음'과 세계관 저장 버튼(저장 전 확인 문제가 있으면 첫 사유·건수를 버튼 옆에 알리고 저장을 막는다), 없으면 '저장됨'이며 저장 버전이 0이면 바꾼 것이 없어도 첫 저장을 할 수 있다. 관리 모드 헤더의 '편집'은 세계관 정보 편집 패널(이름·설명·공개 범위·장르·표지)을 소개 자리에 열고 저장·취소·Esc로 닫는다. 저장은 바뀐 것만 이름·설명(기존 초안 저장) → 공개 범위·장르(`PUT /api/v1/world-studios/{id}/publication`, Content, 세계관 단위, 비공개에서 공개로 바꿀 때만 저장 시점에 확인) → 표지 순으로 보내고, 하나라도 실패하면 닫지 않고 오류와 입력을 그대로 둔다(헤더에는 공개 범위·장르 칩만 있다). 저장하지 않은 수정이나 저장 전 확인 항목이 있으면 '편집'과 열린 패널의 저장이 잠기고 '작성 중인 변경을 먼저 저장하세요'로 알려, 그 수정이 이름·설명 저장에 딸려 가지 않게 한다. 공개 목록에 나오는지는 저장한 세계관의 확정 버전 유무로 판정한다(`worldPublication.listingOf`): 공개이고 확정 버전이 있으면 헤더에 '공개 화면 보기'(`/worlds/:id`, 미리보기를 겸한다)가, 공개인데 확정 버전이 없으면 링크 대신 '저장한 뒤 확정 버전 남기기로 확정 버전을 한 번 남기면 나타난다'는 안내가 보이고 확정 버전을 남기면 저절로 사라진다. `--mode mockup`은 메모리에만 반영해 링크 없이 데모 안내를 띄운다. 표지는 PNG·JPEG·WebP 5 MiB 이하를 고르는 순간 검사하고 저장하면 `PUT /api/v1/world-studios/{id}/cover`(multipart)로 올리며(교체 포함, 삭제는 확인 뒤 `DELETE`, 소유자 화면은 Bearer로 읽은 이미지를 객체 주소로 보이고 해제한다) 'AI로 생성'은 준비 중으로 잠그고 표지 저장소가 없는 데모는 지원하지 않는다고 알린다. 공개 화면(`/worlds` 카드·상세)은 `hasCover`이면 공개 cover 주소(`/api/v1/public/world-studios/{id}/cover`)를 `<img>`로 쓰고 없으면 자동 생성 표지를 쓴다. 설정집 보기(작성 모드는 설정 카드 단계)는 공개 설정집과 같은 게시판으로, 왼쪽 분류 메뉴 + 오른쪽 검색·정렬·결과 수·`+ 새 설정`(유형 8가지를 고르면 그 유형의 카드를 초안에 더하고 편집 화면을 연다) 도구줄 위 / 표 아래이고 표는 보기만 한다(제목을 누르면 편집 화면, 삭제는 편집 화면에서만, 카드가 없으면 안내는 표 안 한 줄뿐). 삭제는 유형과 상관없이 초안 변경이라 이어진 관계 수를 확인한 뒤 함께 지우고(다른 설정이 아직 참조하면 막는다) 설정집 화면으로 돌아와 `되돌리기` 알림을 보이며, 세계관 저장으로 서버에 반영한다. 화면 오른쪽에는 설정집 화면·편집 화면·단계와 무관하게 늘 집필실과 같은 공용 `ChatPanel`의 AI 채팅 레일이 있다(설정집 화면은 본문 | 채팅 2열에 채팅 350px 고정·상단바 아래 sticky, 편집 화면은 집필실과 같은 3단의 오른쪽 열, 접기·열기, 좁은 화면(900px 이하)은 기본 닫힘이고 열면 오른쪽 서랍, 전송·첨부·추천 칩은 연결 전이라 '준비 중'으로 잠기고 가짜 응답은 없다). 인물 관계도 보기(작성 모드는 관계 연결 단계)는 어두운 인물관계도 + 관계 추가·목록 표이고(인물 삭제도 같은 삭제 흐름), 시간선 보기는 저장한 설정의 사건만 기존 시간선(`WorldTimeline`)으로 보인다. AI 후보 검토 시트는 상태 필터 칩(검토 대기·승인·거절, 보류는 검토 대기에 든다)과 후보 카드(승인·거절·보류(보조 스타일)·내용 수정, 근거는 `근거 보기`)·`승인한 후보 N개 초안에 반영` 고정 바로 한 장씩 넘겨 본다. 게시판 규칙(분류·정렬·번호)은 `presentation/shared/worldBoard.ts`를 두 화면이 함께 쓴다.

화면은 세 규칙을 함께 쓴다. **Clean Architecture**는 계층 의존 방향을, **MVVM**은 화면 책임 분리를,
**Flux**는 상태 변경·전달 순서를 정한다. 하나가 다른 것을 대신하지 않는다.

## 구조와 의존성

TypeScript(`.ts`·`.tsx`)로 작성하고 `any`·타입 단언 남용을 피한다. 외부 응답은 Zod로 검증한 뒤 사용한다.
업무 기능은 **업무 규칙이 외부 구현을 직접 참조하지 않게** 의존 방향을 정한다.

```text
실행 흐름: View → ViewModel → UseCase → Repository 구현 → HTTP API
코드 의존: Presentation → Domain ← Data
객체 조립: app/di에서 Domain UseCase와 Data 구현체를 연결
```

| 위치 | 역할 | 예 |
|---|---|---|
| `presentation/features/<기능>/view` | JSX·스타일·ARIA와 순수 표시용 포맷만. ViewModel이 반환한 상태·handler 사용 | `WorkPage` |
| `presentation/features/<기능>/viewmodel` | Custom Hook ViewModel. 화면 상태·동작·요청 수명 관리 | `useReaderViewModel` |
| `presentation/features/<기능>/state` | 화면 이동 후에도 유지할 Redux slice | `library/state/newWorkSlice` |
| `presentation/shared` | 여러 feature가 공유하는 화면 요소 | `shell`, `session` |
| `domain/entities` | 업무 데이터 타입 | |
| `domain/usecases` | 사용자 기능 실행. Repository interface만 생성자로 받고 HTTP를 import하지 않음 | `LibraryUseCase` |
| `domain/repositories` | 데이터 접근 계약(interface) | `WorkRepository` |
| `data` | Repository 구현·Fetch·HTTP DTO의 Zod 검증과 Entity 변환. API 형식 변경은 여기서 흡수 | `HttpEpisodeRepository` |
| `app` | Awilix 등록, Redux Store | `app/di`, `store.ts` |

- Domain은 Data·Presentation·React를 import하지 않는다. 요청 취소용 Web 표준 `AbortSignal`은 Domain 계약에 둘 수 있다.
- feature끼리 다른 feature의 ViewModel·Store를 참조하지 않는다. 공유가 필요하면 `presentation/shared`로 옮긴다.
- 브라우저는 상대 `/api` 경로만 사용하고 기존 URL·Bearer·쿠키·CSRF 계약을 유지한다. AI·그래프 DB·외부 모델을 직접 호출하지 않는다.
- 기존 Tailwind CSS·디자인 토큰을 재사용한다.

## MVVM과 DI

- View는 ViewModel 하나가 반환한 상태를 렌더링하고 사용자 이벤트를 반환된 handler에 연결한다. 업무 판단·API 호출을 하지 않는다.
- ViewModel은 UseCase 실행, 화면 상태 조합, 입력 가능 여부 검사, 포커스·스크롤 같은 화면 제어를 맡는다.
- `app/di`의 `register*Services`가 `asFunction(({ repo }) => new XUseCase(repo)).singleton()`처럼 Repository를 UseCase 생성자에 넣는다(생성자 DI).
- ViewModel만 `appContainer.resolve(...)`로 UseCase를 조회한다(Service Locator). View는 `appContainer`를 조회하지 않고,
  ViewModel은 Repository를 직접 생성·조회하지 않는다.
- Awilix는 UseCase·Repository 같은 **협력 객체**를, Redux는 **화면 상태**를 관리한다. 둘을 섞지 않는다.
- 업무 규칙이 없는 연결 확인(Health)은 `View → Hook → DI 외부 함수 → Fetch·Zod`를 유지하고 빈 UseCase·Repository를 만들지 않는다.

## Flux 단방향 흐름 (Redux Toolkit)

```text
View 이벤트 → ViewModel handler → UseCase 메서드 호출
  → 결과에 따라 dispatch(sliceActions.x(payload))      // Action
  → Reducer가 새 상태 계산 → Store 갱신
  → useAppSelector 구독 → ViewModel 반환값 → View 재렌더링
```

- 상태는 Action → Reducer → Store → Selector 한 방향으로만 바뀐다. View·HTTP 코드가 Store 상태를 직접 고치지 않는다.
  (예: `useReaderViewModel`이 UseCase 호출 후 `dispatch(sessionActions.dataChanged())`, 상태는 `useAppSelector`로 읽음)
- 비동기 HTTP는 ViewModel이나 Thunk에서 UseCase로 호출한다. Reducer에는 상태 변경 규칙만 두고 부수 효과를 넣지 않는다.
- slice 안의 `state.x.push(...)` 표기는 Redux Toolkit(Immer)의 불변 갱신이다.
- 컴포넌트에서는 `app/store`의 `useAppDispatch`·`useAppSelector`만 쓴다.

## 상태 위치와 요청

| 상태 | 저장 위치 | 수명 |
|---|---|---|
| 한 화면에서만 쓰는 입력·결과·ref | ViewModel Hook 로컬 상태 | 화면 이탈 시 해제, 진입 시 재조회 |
| 화면을 옮겨도 이어져야 하는 작업 | Redux slice + ViewModel | 앱 실행 동안 유지(새로 고치면 초기화) |

- 같은 상태를 Hook과 Redux에 중복 저장하지 않는다. Redux에는 직렬화 가능한 값만 넣고 `AbortController`·타이머는 넣지 않는다.
- 진행 중 중복 전송을 막고, 새 요청·화면 이탈·로그아웃 시 이전 요청을 취소하며 요청 ID로 늦은 응답을 무시한다.
- 로딩·실패·완료 표시는 실제 API 결과와 일치시킨다. AI 제안 도착을 저장·승인·발행 완료로 표시하지 않는다.

## 데모 화면과 실제 기능

- 실제 API가 없는 기능은 메모리 Repository(`data/mock`, `--mode mockup`의 `registerMockupServices`)로 화면만 시연한다.
  데모 입력·이동을 서버 저장 성공으로 표시하지 않고, 미연결 동작은 준비 중으로 비활성화한다.
- 서버 기능이 없는데 형식적인 UseCase·Repository 계층을 추가하지 않는다. 버튼 숨김으로 서버 권한 검사를 대신하지 않는다.

## 검증

- 패키지 관리는 `pnpm`과 기존 lockfile을 사용한다.
- 로컬: `pnpm exec vitest run src/domain/__tests__/<대상>.test.ts`처럼 변경 범위의 **단위 테스트 파일만** 지정한다.
  `src/domain`, `src/data`의 대역 기반 테스트와 `src/index-html.test.js`가 단위 범위이고, React 렌더·Hook·App 조립은 CI 통합 계층이다.
- UseCase 테스트는 Fake Repository, ViewModel 테스트는 Fake UseCase나 격리 컨테이너를 사용한다(운영 컨테이너를 바꾸지 않음).
- 상세는 [Frontend README](README.md)를 본다.
