# 이슈 #34 집필실 공개 중복·제목 초기값 수정

[메인 README](../README.md) · [문서 목록](README.md)

> **작성 시점 기록:** 종료된 이슈 #34의 작성 시점 기록입니다. 현재 개발 현황은 [기능표](feature-roadmap.md)를 따릅니다.

기준 브랜치: `fullstack-function`, 기준 커밋: `017cc48`.
범위는 기존 메모리 데모 집필실의 [#34](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/34)이며 Core 콘텐츠 API와 UUID 집필실은 변경하지 않았다.

## 요구사항 대조와 수정

| 요구사항 | 수정 전 | 이번 변경과 검증 |
| --- | --- | --- |
| 공개 중 연속 클릭으로 같은 초안을 중복 발행하지 않음 | `publish`의 진행 중 가드와 버튼 비활성화가 없었음 | 첫 await 전에 ref로 잠그고 공개·자동 생성이 같은 잠금을 사용한다. 신규·수정 공개의 UseCase 호출 및 사건 추가가 1회인지 검증했다. |
| 자동 생성의 중복 실행 방지 | `autoGen`도 중복 호출 가능 | 처리 중 버튼을 비활성화하고 수동 공개와의 중복도 차단한다. 성공·거부·예외는 finally에서 잠금을 해제한다. |
| 공개 시트에 최신 제목 반영 | 마운트 시점의 `d.title`에 고정 | 사용자가 고치기 전에는 최신 초안 제목을 표시하고, 직접 고친 제목은 재조회 후에도 유지한다. 시트 재조회 전에 즉시 공개해도 미수정 제목은 기존 UseCase가 저장 큐 이후 최신 초안에서 결정한다. |
| 실패 후 재시도 | 예외 처리가 없고 진행 상태 표시도 없었음 | 실패를 성공으로 표시하지 않고 처리 상태를 해제한다. 시트 입력과 원고를 유지하며 재시도할 수 있다. 부분 처리 가능성이 있는 예외는 상태 확인 후 재시도하도록 안내한다. |

원문의 [Major 제안](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/20#discussion_r4421003828), [Minor 제안](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/18#discussion_r4421007036) 및 `frontend/mockup/index.html`의 `pubEpSheet`·`autoGen`을 대조했다. 기존 제목 변경·공개·취소의 기본 동작은 유지한다. 비동기 요청 중에는 중복 공개·생성을 막기 위해 버튼을 비활성화하고 공개 시트의 닫기·취소·제목 입력도 잠근다. 미정 제품 정책이나 실제 자동 발행 기능은 추가하지 않았다. GitHub 이슈 댓글은 작성하지 않았다.

## 로컬 자동화 검증

- TDD Red: 신규·수정 공개와 자동 생성의 UseCase가 2회 호출되는 문제, 예외 처리·진행 상태 부재, 공개 시트의 제목 고정을 먼저 재현했다. 별도 즉시 공개 회귀에서도 기대한 최신 제목 대신 `새 회차`로 발행되는 실패를 확인했다.
- Green: 격리된 테스트 컨테이너와 지연 Promise를 사용한 회귀 9개를 추가했다. production singleton과 다른 테스트의 Repository를 덮어쓰지 않는다.
- 실제 실행: `frontend`에서 `node node_modules/vitest/vitest.mjs run src/presentation/features/studio/view/StudioPublish.test.tsx src/domain/__tests__/StudioUseCase.test.ts src/App.studio.test.tsx src/App.studio-notes.test.tsx` — 4파일 31개 통과.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json`, 변경한 View·ViewModel·테스트 3파일의 `node node_modules/oxlint/bin/oxlint ...` 통과. `git diff --check` 통과.
- Ponytail-review: 연결된 UseCase의 제목 fallback·초안 삭제·사건 추가 경로와 ViewModel 호출부를 확인했다. 기존 기능과 의존성을 재사용했으며 추가 수정 지적은 없었다.
- Graphify AST 갱신. 기존 SQL/PDF 추출 의존성 제한은 유지되며 이번 수정은 TypeScript와 문서에 한정된다.

## Aside E2E — 2026-11-03

설치 목록에 정확한 이름의 `aside-browser` 파일 스킬은 없었다. 설치된 공식 Aside CLI의 `guide`, `guide repl`과 내장 스킬 목록을 확인한 뒤 REPL로 실제 입력·클릭·저장 결과·화면 상태를 검증했다. 해당 이름의 스킬을 로드했다고 주장하지 않는다.

- 실행 URL: `http://localhost:5173/.issue34-e2e.html` 및 `?mode=edit`, `?fail=publish`, `?mode=auto&fail=autoGen`.
- 검증 fixture는 실제 StudioPage·ViewModel·UseCase와 탭별 메모리 Repository를 사용했다. 역할은 합성 데모 사용자로 설정했고, 호출에 3초 지연 및 최초 1회 실패를 주입했다. 자동 생성 재시도의 데모 비용 확인은 fixture에서 승인했다. 실제 인증·Core 저장·유료 AI 호출 검증으로 해석하지 않는다.

| 시나리오 | 실제 결과 |
| --- | --- |
| 새 회차 작성 → 공개 | 요청 1회, 회차 3→4, 사건 0→1. 최신 제목으로 표시·저장됨. 처리 중 공개·취소·닫기·제목 입력 비활성화 확인. |
| 발행 회차 수정 → 수정 공개 | 요청 1회, 회차 3개 유지, 사건 0→1. 1화 제목 변경 확인. |
| 공개 실패 → 재시도 | 첫 실패 시 회차 3개·사건 0개 유지, 원고와 시트에서 고친 제목 보존. 버튼 재활성화 후 Enter로 재시도하여 누적 요청 2회·회차 4개·사건 1개 확인. |
| 자동 생성 실패 → 재시도 | 처리 중 생성 버튼 비활성화와 `aria-busy=true`. 첫 실패 후 버튼 재활성화, 재시도 후 누적 생성 요청 2회·회차 3→4·사건 0→1 확인. |
| 모바일·키보드·접근성 상태 | 390×844 viewport에서 공개 시트가 가로 범위 안에 표시됨(좌측 16px·우측 약 359px). 최초 제목 입력에 포커스, Tab으로 취소 이동, Enter 제출 확인. 처리 중 접근성 트리의 status 안내 확인. 실제 모바일 기기·별도 스크린리더로는 검증하지 않음. |

증거: `C:\Users\playdata2\.aside\u\0\sessions\2026-11-03_wHLfz09f53rUo5Hy` 세션 기록. 스크린샷 저장은 CDP timeout으로 실패해 이미지 증거는 없다. Impeccable의 변경 View 정적 검사에서 regex 지적은 없었으나 파싱된 화면의 대비·폰트 등 검사는 실행되지 않았고 시각 검증 전체 통과로 취급하지 않는다.

임시 fixture는 검증 후 `C:\Users\playdata2\Documents\ChatGPT\artifacts\issue34\issue34-e2e.html`에 보관하고 저장소에서 제거했다. 검증 탭은 닫았으며 기존 사용자 탭·데이터와 실제 .env는 변경하지 않았다.

## 남은 검증과 전달 상태

- 최신 미커밋 변경의 Required CI, Docker 및 운영 환경은 검증 대기다.
- 커밋·푸시·PR/이슈 수정은 수행하지 않았다. 이번 검증은 메모리 데모 경로에 한정되며 서버의 다중 클라이언트 중복 방지 계약을 새로 구현한 것이 아니다.
