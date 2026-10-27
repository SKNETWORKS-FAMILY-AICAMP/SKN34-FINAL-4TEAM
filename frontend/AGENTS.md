# Frontend 구현 지침

`frontend/**`에 적용한다. [루트 공통 지침](../AGENTS.md)을 함께 따른다.
현재는 STORYFORK 시작 화면과 실제 Core·AI 연결 확인만 제공한다. 업무 계약은 후속 설계 대상이다.

## 필수 스킬과 개발 순서

- 프론트엔드 작업은 반드시 `/impeccable` 스킬을 로드하고 작업 유형에 맞는 절차를 따른다.
  UI 구현·수정 전 기존 화면·디자인 토큰·제품 문맥을 확인하고, 스킬의 컨텍스트 로딩과 해당 가이드를 적용한다.
  기존 시각적 정체성·동작을 요청 없이 교체하지 않으며, 변경한 화면의 반응형·키보드 조작·접근성을 확인한다.
- 공통 지침의 `/graphify` 영향 분석 → `/ponytail full` 기반 TDD 구현 → 관련 테스트·화면 확인 →
  `/ponytail-review` 리뷰·필요 수정 → Aside E2E 테스트 순서를 반드시 따른다.
  Impeccable은 이 흐름에서 UI 설계·구현·확인에 함께 적용하며, E2E 세부 기준은 루트 공통 지침을 따른다.

## 구조와 의존성

- 현재 Health는 `View → Hook → DI 외부 함수 → Fetch·Zod` 흐름이다.
  업무 기능이 생길 때만 `View → ViewModel → UseCase → Repository → HTTP DTO`를 적용한다.
  View는 렌더링·접근성을 담당하고 ViewModel을 통해 상태와 행동을 사용한다.
- ViewModel은 전역 `appContainer`에서 필요한 UseCase·외부 API 기능만 조회한다.
  Repository를 직접 생성·조회하지 않으며 생성·연결은 기존 Awilix `app/di`에서 관리한다.
- 브라우저는 공개 Core API만 호출한다. AI Service·OpenAI를 직접 호출하거나 내부 DTO를 공개 계약으로 사용하지 않는다.
- Fetch와 Zod 응답 검증은 Data Layer에 둔다. Health처럼 단순 연결 확인에 불필요한 업무 계층을 추가하지 않는다.

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
- 코드 변경 시 해당 회귀 테스트와 영향받은 동작·화면을 확인한다. `pnpm test -- <테스트 경로>`로 범위를 지정할 수 있다.
- 전체 검증 명령은 `pnpm test`, `pnpm lint`, `pnpm build`다. 변경 영향이나 필수 검증 요구에 맞게 선택하며
  작은 수정이나 문서 변경을 이유로 불필요한 전체 빌드를 반복하지 않는다.
- ViewModel 테스트는 Fake UseCase나 격리 컨테이너를 사용하고 전역 컨테이너를 덮어쓰지 않는다.
- 상세 구조·상태 관리와 실행 방법은 [Frontend README](README.md)를 참고한다.
