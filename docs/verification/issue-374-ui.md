# #374 실제 화면 검증 (2026-11-16)

현재 결과: **Toast 툴바 오류 수정, 화면 17항목 재검증 통과·브라우저 오류 0건. 실제 PostgreSQL 저장과 실제 OpenAI 생성·승인 반영·새로고침 유지 확인**. hosted CI는 별도 대기다.

## 최종 polish·리뷰

후속 요청으로 Impeccable polish·CodeRabbit·ponytail 리뷰를 수행했다. 검증을 마친 뒤 기존 작업 브랜치에서 PR을 만드는 것으로 앞선 PR 금지 지시가 변경됐다.

- **Polish:** 좁은 고급 패널에서 세로 버튼 묶음이 장면 본문 폭을 줄이고 있었다. 본문 아래에 위로·아래로·삭제를 한 줄로 배치했다. 모바일에서 로컬 CSS가 공용 버튼의 44px 높이를 36px로 덮던 것도 수정했다. 기존 색상·글꼴·문구·동작은 유지했다. CSS만 수정했으므로 새 로직 단위 테스트는 추가하지 않았다.
- **화면:** 실제 Chrome에서 라이트·다크 × 320/390/750/1100/1500px, 총 10조합의 가로 넘침과 버튼 크기를 검사했다. 좁은 화면 버튼은 44px 이상이었다. 긴 제목·본문, 키보드 Enter로 편집·순서 이동, Tab 이동 시 포커스 윤곽선도 확인했다. Impeccable detector 지적 0건. 최종 전체 화면 시나리오 17항목과 pageerror 0건을 다시 확인했다.
- **CodeRabbit:** `upstream/develop` 대비 브랜치 전체 46파일 리뷰에서 경미한 제안 1건. 삭제·회차 이동 뒤 원래 회차의 position 공백을 없애자는 제안은 채택하지 않았다. [계약](../design/writing-plan-panel-contract.md)은 공백을 허용하고 일반 편집은 position을 생략한다. 실제 `useStoryPlanViewModel.edit`도 position 없이 입력을 만들며, 순서 변경만 현재 목록의 목적지 인덱스를 보낸다. 저장 응답의 position을 그대로 PUT하는 가정은 이 편집 계약과 다르다. 기존 `editing content preserves relative order after deletion gaps` 테스트를 포함한 Content 9개와 프론트 계획·HTTP 16개가 통과했다. 최종 CSS 변경 별도 리뷰는 지적 0건이다.
- **Ponytail full/review:** 기존 패널·버튼·토큰을 재사용하고 CSS 3규칙만 보완했다. 순서 저장·미저장 보호·공용 Toast 패치 흐름도 검토했으며 추가 추상화나 리팩터링이 필요한 유효 결함은 없었다.

판정: 요청한 범위의 유효 미해결 결함 없음. PR 제출 가능. hosted CI와 공유 환경 적용 여부는 이 로컬 판정과 구분한다.

추가 근거는 같은 로컬 증거 폴더의 `polish-checks.json`, `polish-detector.json`, `full-branch-review.log`, `polish-review.log`, `polish-plan-tests.log`, `polish-plan-service-tests.log`, `polish-final-results.json`, `polish-final.mp4`, `polish-light-*.png`, `polish-dark-*.png`, `polish-long-content.png`에 있다.

## 후속 수정·실제 서버 검증

사용자가 오류 수정과 실제 DB·AI 호출·녹화를 추가 요청했다. 기존 `feat/writing-plan-panel`에서 수행했으며 당시 요청에 따라 PR은 만들지 않았다.

- 원인: Toast UI Editor 3.2.2 툴바의 `ResizeObserver`를 해제해도 이미 예약된 200ms throttle 콜백은 남는다. 편집기 제거 뒤 콜백이 `setState`로 제거된 DOM을 다시 그렸다.
- 수정: pnpm 패치로 툴바 제거 여부를 표시하고 늦은 resize 콜백을 중단한다. ESM·CommonJS 진입점에 동일하게 적용했다. 버전 변경이나 새 production 의존성은 없다. Docker 개발/배포 이미지도 설치 전에 패치 설정과 파일을 복사한다.
- TDD: `toastLifecycle.test.ts`는 실제 라이브러리의 observer를 두 번 호출한 직후 제거한다. 패치 전 `NotFoundError`로 실패, 패치 후 통과했다. `ManuscriptEditor.test.tsx` 포함 **2파일 77개 통과**, TypeScript 검사 통과, `pnpm install --frozen-lockfile --ignore-scripts` 통과. 첫 병렬 실행에서 기존 무작위 편집 테스트가 서버 기동 부하로 5초 제한을 초과해, 파일 순차 실행·20초 제한으로 재검증했다.
- 실제 Chrome에서 기본 모드의 390→1500px 폭 변경 직후 회차 전환을 재검증했다. 기존 전체 17항목도 재실행했으며 두 녹화 모두 pageerror 0건이다.
- CodeRabbit 변경분 리뷰 9파일에서 지적 0건, ponytail-review 과잉 설계 점검에서도 추가 수정 사항은 없었다.

### 실제 DB·AI

기존 공유 데이터 대신 새 로컬 컨테이너 PostgreSQL 18(`storyfork-374-pg`)·Neo4j 5.26(`storyfork-374-neo`)를 사용했다. Core 18074, Content 18075, AI 18076, Vite 5374를 실제 소스로 실행했다. HTTP 대역·모델 대역은 사용하지 않았다. Core/Content 실행 JAR 빌드도 성공했다.

1. 샘플 회원으로 실제 로그인하고 검증 작품 `5762ba15-6649-4e13-89a1-ddf948b5e259`·회차·세계관·인물 2명을 생성했다. 1화를 로컬에서 발행해 AI 근거 회차로 사용했다.
2. 화면에서 플롯과 2화 장면 2개를 만들고 순서를 바꿨다. 새로고침 후 서버 재조회와 DB 직접 SELECT에서 `새로운 약속=0`, `성문 대면=1`, 두 revision=2를 확인했다. `content_schema_history`의 V38 적용 성공도 확인했다.
3. 실제 서버 연결 상태에서 폭 변경·회차 전환 후 툴바 오류가 없었다.
4. 화면 동의 체크 후 저장된 비트를 순서대로 실제 AI에 보냈다. 제공받은 키는 파일에서 읽어 AI 서버 환경에만 전달했으며 저장소·화면·증거 파일에 기록하지 않았다. 모델은 기존 로컬 설정의 `gpt-5.6-luna`를 사용했다.
5. 시뮬레이션은 5턴(나레이션 3·인물 2)을 생성했고, 두 비트 완료·검사 통과 8·위반 0을 표시했다. 생성 완료 전에는 원고가 바뀌지 않았다.
6. 화면의 `원고에 반영`을 누른 뒤 2화 초안이 49→437자로 저장됐다. 새로고침 뒤 생성 문장과 반영 완료 대화가 유지됐다. 별도 AI DB `storyfork_ai_verify`에 체크포인트 56개가 저장됐다. 전체 실제 서버 화면 검증에서 pageerror 0건이었다.
7. 검증 서버를 종료하고 PostgreSQL 컨테이너를 재시작한 뒤 별도 SELECT로 장면 순서와 437자 AI 반영 초안이 그대로 남는 것을 확인했다(`real-db-after-restart.txt`). 검증 컨테이너는 데이터를 보존한 채 종료했다.

한계: 이번 환경은 원고 검색 인덱싱을 켜지 않았다. 서비스가 `원고 발췌 검색을 쓸 수 없어 세계관 설정만으로 진행했어요`라고 표시했으며, **세계관 설정 기반 실제 생성 성공**을 확인한 것이다. 원고 검색·임베딩과 Langfuse 추적은 이번 검증에 포함하지 않는다. Windows AI 실행은 psycopg 호환 Selector 이벤트 루프를 검증용 실행 스크립트에서 지정했다. 운영 배포·공유 DB 적용을 뜻하지 않는다.

후속 녹화·증거(`D:/storyfork-374-verification/`, Git에는 영상·키를 넣지 않음):

- `toolbar-fixed.mp4`: 기존 툴바 오류 재현 절차의 수정 후 녹화.
- `toolbar-full-fixed.mp4`: 전체 17항목 재검증 녹화.
- `real-db-ai-verification.mp4`: 실제 DB·AI 생성·원고 승인·새로고침 검증 녹화.
- `toolbar-fixed-results.json`, `toolbar-full-fixed-results.json`, `real-results.json`: 요청·검사·브라우저 오류 결과.
- `real-db-proof.txt`, `real-ai-response.json`, `real-step-*.png`: DB 조회·실제 SSE 응답·화면 근거.
- `toast-tests-final.log`: 편집기 회귀 77개 통과.

아래는 수정 전 최초 검증 기록이다.

## 실행 범위

- 브랜치 `feat/writing-plan-panel`, 기능 구현 커밋 `286a0012`.
- 사용자 요청으로 로컬 화면·React 조립 테스트를 실행했다.
- Vite 개발 서버와 실제 Chrome 창, 실제 Toast UI 원고 편집기를 사용했다. 화면 조작과 녹화는 Playwright로 수행했다.
- Core/Content/AI 및 Docker가 실행 중이지 않아 HTTP 경계에서 격리된 테스트 응답을 연결했다. 테스트 인증·작품·회차·인물·계획만 사용했다.
- 계획 저장·순서는 테스트 응답 상태로 확인했다. 실제 PostgreSQL 영속성·V38 적용·실제 인증·AI 생성 성공을 검증한 것이 아니다. 공유 DB나 기존 사용자 데이터는 변경하지 않았다.
- 영상에 `UI 검증 · 테스트 API (실DB/AI 미호출)`을 표시했다. 화면은 1500×900, 1100×900, 390×844로 확인했다.

## 확인한 동작

1. 집필실을 떠나지 않고 플롯 생성.
2. 기본/고급 모드 전환 후 미저장 계획 유지.
3. 열린 회차를 기본으로 장면 2개 생성 및 순서 변경.
4. 저장된 순서가 시뮬레이션 흐름 비트에 반영.
5. 계획 저장 409 실패 시 입력 유지와 시뮬레이션 시작 잠금.
6. 재시도 성공 후 열린 흐름 양식 즉시 갱신.
7. 시뮬레이션 요청 본문의 최신 비트·참여 인물·근거 1화/대상 2화 확인. 실제 AI 요청 대신 의도적인 오류 응답을 사용했다.
8. 계획 이탈 확인을 허용한 뒤 원고 이탈을 취소하면 양쪽 입력 유지.
9. 원고 버전 저장이 미저장 계획을 지우지 않음.
10. 계획 조회 회차를 바꿔도 열린 원고 회차 유지.
11. 장면 삭제 후 원고 보존.
12. 삭제한 장면이 시뮬레이션 비트에서 제외.
13. 1100px에서 원고 아래 패널 배치와 가로 넘침 없음.
14. 390px에서 플롯 수정·저장과 가로 넘침 없음.
15. 계획 없음 안내의 버튼이 페이지 이동 없이 고급 패널을 엶.
16. 기존 `?view=narrative` 단독 주소 호환 유지.
17. 집필실에 다시 진입해 API 목록을 재조회하고 계획 표시.

## 최초 발견한 오류 (위 후속 작업에서 해결)

모바일 폭 390px에서 1500px로 넓힌 직후 1화 버튼을 누르면 다음 오류가 기록된다. 전체 시나리오에서 두 번, 고급 패널을 사용하지 않은 기본 모드의 별도 재현에서도 확인했다.

```text
NotFoundError: Failed to execute 'removeChild' on 'Node':
The node to be removed is not a child of this node.
removeNode → diff → commit → rerender → Component.setState
→ Toast UI Toolbar.handleResize (throttle callback)
```

스택은 Toast UI 툴바 폭 변경 처리까지 확인했다. `ManuscriptEditor.tsx`는 이번 #374 구현에서 변경하지 않은 파일이다. 오류 이후에도 계획 동작과 회차 화면은 유지됐고 입력 손실은 관찰되지 않았지만, 편집기 툴바의 후속 동작 전체는 보장하지 않는다. 이 검증 작업에서는 원인 코드 수정 없이 재현 근거를 남겼다.

## 테스트와 변경

관련 React/Hook 테스트 **5파일 201개 통과**. 이전 문구를 기대하던 시뮬레이션 안내 검증, 별도 페이지 링크를 기대하던 검증, 새 계획 조회에 필요한 테스트 대역을 현재 동작에 맞게 정정했다. 제품 동작 코드는 이 검증 작업에서 수정하지 않았다.

실행 파일: `WritingPlanPanel.test.tsx`, `WritingStudio.test.tsx`, `WritingStudio.panels.test.tsx`, `WritingStudio.stage.test.tsx`, `SimulationStage.test.tsx`.

## 녹화·증거 위치

작업 PC의 `D:/storyfork-374-verification/`에 저장했다. 대용량 영상은 Git에 넣지 않았다.

- `issue-374-ui-verification.mp4`: 59.48초, 연속 검증 영상. 17개 동작은 통과했지만 마지막 콘솔 무오류 검사는 위 오류로 실패했다.
- `resize-reproduction.mp4`: 기본 모드에서 폭 변경·회차 전환 오류를 재현한 영상.
- `full-results.json`, `resize-reproduction-results.json`: 항목 결과·HTTP 요청·오류 스택.
- `react-tests.log`: 201개 테스트 통과 결과.
- `step-*.png`: 각 확인 항목의 화면 캡처.
- `harness.mjs`, `phase*.mjs`, `final-run.mjs`, `resize-repro.mjs`: 격리된 재현 스크립트. 저장소 의존성이나 lockfile에는 추가하지 않았다.
