# #374 실제 화면 검증 (2026-11-16)

결과: **기능 동작 17항목 통과, 브라우저 런타임 오류 1종 미해결**. 오류 없는 수용 완료로 판정하지 않는다.

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

## 발견한 오류

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
