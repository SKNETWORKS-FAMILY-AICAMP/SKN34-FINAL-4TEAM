# Frontend 구현 지침

`frontend/**`에 적용한다. [루트 공통 지침](../AGENTS.md)을 함께 따른다.
nginx/Vite는 `/api/v1/works`·`/api/v1/public/works`·`/api/v1/world-studios`와 하위 경로를 Content, 나머지 `/api`를 Core로 라우팅한다.
`/content`·UUID `/studio/{id}`는 Content API를 쓰고 서재·열람·Fork 데모는 별도 메모리 저장소다. 화면 존재와 서버 기능 완료를 구분한다.

## 구조와 의존성

- TypeScript(`.ts`·`.tsx`)로 작성하고 `any`·타입 단언 남용을 피한다. 외부 응답은 Zod로 검증한 뒤 사용한다.
- 업무 기능은 Clean Architecture·MVVM이다([기준 구조](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/blob/main/docs/architecture/README.md#frontend-화면과-데이터-처리-분리)).
  - 실행 흐름: `View → ViewModel → UseCase → Repository 구현 → HTTP API`
  - 의존 방향: `Presentation → Domain ← Data`. Domain은 Data·Presentation·React를 import하지 않는다.
  - 객체 조립: `app/di`(Awilix)에서 UseCase와 Repository 구현체를 연결한다.

| 위치 | 역할 |
|---|---|
| `presentation/features/<기능>/view` | 렌더링·스타일·접근성. ViewModel이 반환한 상태와 handler만 사용 |
| `presentation/features/<기능>/viewmodel` | Custom Hook ViewModel. 화면 상태·동작 제공, `appContainer`에서 UseCase 조회 |
| `presentation/features/<기능>/state` | 화면 간 유지할 Redux slice |
| `presentation/shared` | 여러 기능이 공유하는 화면 요소 |
| `domain/entities` | 업무 데이터 타입 |
| `domain/usecases` | 사용자 기능 실행. Repository interface만 생성자로 받음 |
| `domain/repositories` | Repository interface |
| `data` | Repository 구현·Fetch·HTTP DTO의 Zod 검증과 Entity 변환 |
| `app` | Awilix 등록, Redux Store |

- View는 `appContainer`를 직접 조회하지 않는다. ViewModel은 UseCase만 조회하고 Repository를 직접 생성·조회하지 않는다.
- feature끼리 다른 feature의 ViewModel·Store를 참조하지 않는다. 공유 요소만 `presentation/shared`에 둔다.
- Health처럼 업무 규칙이 없는 연결 확인은 `View → Hook → DI 외부 함수 → Fetch·Zod`를 유지하고 빈 UseCase·Repository를 만들지 않는다.
- 브라우저는 상대 `/api` 경로만 사용하고 기존 URL·Bearer·쿠키·CSRF 계약을 유지한다. AI·그래프 DB·외부 모델을 직접 호출하지 않는다.
- 화면 전용 상태는 React Hook, 화면 간 작업 상태는 Redux Toolkit에 두며 중복 저장하지 않는다.
- 진행 중 중복 전송 방지와 로딩·실패·완료 표시를 실제 API 결과와 일치시킨다. AI 제안 도착을 저장·발행 완료로 표시하지 않는다.
- 기존 Tailwind CSS·디자인 토큰을 재사용한다.

## 검증

- 패키지 관리는 `pnpm`과 기존 lockfile을 사용한다.
- 로컬: `pnpm exec vitest run src/domain/__tests__/<대상>.test.ts`처럼 변경 범위의 **단위 테스트 파일만** 지정한다.
  `src/domain`, `src/data`의 대역 기반 테스트와 `src/index-html.test.js`가 단위 범위이고, React 렌더·Hook·App 조립은 CI 통합 계층이다.
- UseCase 테스트는 Fake Repository, ViewModel 테스트는 Fake UseCase나 격리 컨테이너를 사용한다.
- 상세는 [Frontend README](README.md)를 본다.
