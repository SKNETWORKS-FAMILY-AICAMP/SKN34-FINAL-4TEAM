# Frontend 구현 지침

`frontend/**`에 적용한다. [루트 공통 지침](../AGENTS.md)을 함께 따른다.
현재 시작 화면·Health 연결 확인과 `/content`·UUID `/studio/{id}`의 콘텐츠 API 연결을 제공한다. 기존 서재·열람·Fork 데모는 별도 메모리 저장소이며 실제 인증 연결·화면 정렬과 미구현 업무는 후속 작업이다.

## 필수 스킬과 개발 순서

- 프론트엔드 작업은 반드시 `/impeccable` 스킬을 로드하고 작업 유형에 맞는 절차를 따른다.
  UI 구현·수정 전 기존 화면·디자인 토큰·제품 문맥을 확인하고, 스킬의 컨텍스트 로딩과 해당 가이드를 적용한다.
  기존 시각적 정체성·동작을 요청 없이 교체하지 않으며, 변경한 화면의 반응형·키보드 조작·접근성을 확인한다.
- 공통 지침의 `/graphify` 영향 분석 → `/ponytail full` 기반 TDD 구현 → 로컬 선택 단위 테스트 →
  `/ponytail-review` 리뷰·필요 수정 → CI 통합·시스템 검증 순서를 따른다.
  Impeccable은 UI 설계·구현에 적용한다. 로컬 자동 브라우저/E2E 검증은 하지 않으며, 별도 요청·승인 시에만 Aside를 사용한다.

## 구조와 의존성

- 언어는 TypeScript를 사용한다. 새 소스는 `.ts`·`.tsx`로 작성하고 `any`와 타입 단언 남용을 피한다.
  외부 응답은 Zod로 검증한 뒤 타입으로 사용한다.
- 업무 기능은 Clean Architecture와 MVVM으로 개발한다. 기준 구조는
  [SKN34-4th-1Team Frontend](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/blob/main/docs/architecture/README.md#frontend-화면과-데이터-처리-분리)를 따른다.
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

- View는 `appContainer`를 직접 조회하지 않는다. ViewModel은 UseCase·외부 API 기능만 조회하고
  Repository를 직접 생성·조회하지 않는다.
- feature끼리 다른 feature의 ViewModel·Store를 참조하지 않는다. 공유 요소만 `presentation/shared`에 둔다.
- 현재 Health처럼 업무 규칙이 없는 단순 연결 확인은 `View → Hook → DI 외부 함수 → Fetch·Zod`를 유지하며
  빈 UseCase·Repository를 추가하지 않는다.
- 브라우저는 공개 Core Service HTTP API만 호출한다(현재 실행 모듈·경로의 `core-api`는 유지). AI Service·그래프 DB·외부 모델을 직접 호출하거나 내부 DTO를 공개 계약으로 사용하지 않는다.

## 상태·요청·화면

- 화면 전용 상태는 React Hook, 화면 간 유지할 작업 상태는 Redux Toolkit에 둔다.
  같은 상태를 양쪽에 중복 저장하지 않으며 Redux에는 직렬화 가능한 값만 넣는다.
- 진행 중 중복 전송 방지, 화면 이탈·새 대화 시 요청 취소, 요청 ID로 늦은 응답 무시를 유지한다.
- 로딩·실패·완료를 실제 API 결과와 일치시킨다. AI 제안 도착을 원고 저장·승인·발행 완료로 표시하지 않는다.
- 권한·승인·크레딧은 Core의 결과를 따른다. UI에서 버튼을 숨기는 것으로 서버 권한 검사를 대신하지 않는다.
- 기존 Tailwind CSS·디자인 토큰·기능별 스타일 구성을 재사용한다.
  키보드 조작, 입력 레이블, 오류 안내, 반응형 동작을 보존한다.
- `VITE_*`와 브라우저 번들에는 공개 설정만 둔다. 원고 비공개 정보나 API 키를 넣지 않는다.

## 검증

- 패키지 관리는 `pnpm`과 기존 lockfile을 사용한다. 실행 환경은 [package.json](package.json)을 따른다.
- 로컬: `pnpm exec vitest run src/domain/__tests__/<대상>.test.ts`처럼 변경·직접 영향받는 **단위 테스트 파일만** 지정한다.
  `src/domain`, `src/data`의 대역 기반 테스트와 `src/index-html.test.js`가 현재 단위 범위다.
  React 렌더·Hook·App 조립은 통합 계층이다. 로컬 통합·브라우저·전체 테스트·빌드는 실행하지 않는다.
- CI: 서비스 수준의 보수적인 선택 후 단위 범위와 나머지 통합 범위를 서로 제외하여 한 번씩 실행한다.
  워크플로가 Vitest 파일 필터·`--exclude`로 직접 실행하며 별도 runner·shell wrapper는 두지 않는다.
  선택된 web은 frozen install·lint·build도 실행하며, Core 계약 변경 시 web 소비자 회귀도 선택한다.
  실제 HTTP 시스템 검증은 브라우저 UI/E2E 검증이 아니다. 문서만 변경하면 runtime job을 생략한다.
- UseCase 테스트는 Fake Repository를 사용한다.
- ViewModel 테스트는 Fake UseCase나 격리 컨테이너를 사용하고 전역 컨테이너를 덮어쓰지 않는다.
- 상세 구조·상태 관리와 실행 방법은 [Frontend README](README.md)를 참고한다.
