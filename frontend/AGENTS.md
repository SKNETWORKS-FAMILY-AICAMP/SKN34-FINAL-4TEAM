# Frontend 구현 지침

`frontend/**`에 적용한다. [루트 공통 지침](../AGENTS.md)을 함께 따른다.
nginx/Vite는 `/api/v1/works`·`/api/v1/public/works`·`/api/v1/world-studios`와 하위 경로를 Content, `/api/v1/operations/{reports,members,admins,support,admin/notices,public/notices,admin/events,public/events}`와 하위 경로를 Operations, 나머지 `/api`를 Core로 라우팅한다(서비스 토큰용 `/api/v1/operations/{notices,events,inquiries}`는 열지 않는다).
`/content`·UUID `/studio/{id}`와 작품 목록·상세·회차 열람·공개 wiki·Fork 생성은 Content API(`HttpWorkRepository`)를 쓰고,
관심·진행률 등 나머지 데모는 별도 메모리 저장소다. 관리자 이벤트 탭과 회원 `/me/event`는 운영 이벤트 API(`HttpEventRepository`)를 쓴다([계약](../docs/design/operations-event-contract.md)). 화면 존재와 서버 기능 완료를 구분한다.
홈 실시간 인기·급상승과 `/search`·`/rank`도 Content 공개 검색·랭킹 API를 쓴다(`--mode mockup`은 시드 메모리 작품·검색).
계약은 [작품 검색·랭킹](../docs/design/work-search-ranking-contract.md)이다.

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
