# 집필실 편집·저장 실사용 검증

2026-11-18, `feat/studio-editing-save`. 대상은 #406 → #416 → #374이며 사용자 요청으로 Polish, CodeRabbit 리뷰, ponytail full, 로컬 실사용 검증을 진행했다. PR은 만들지 않는다.

## 보완한 동작

- 실제 UUID 집필실에 기존 `RequireRole`을 적용했다. 새로고침 시 세션 복구가 끝나기 전에 원고를 요청하던 인증 오류를 막는다.
- End는 `Selection.modify('move', 'forward', 'lineboundary')`로 브라우저의 표시 줄 끝을 찾고 ProseMirror 선택에 바로 반영한다. 긴 문단 끝으로 건너뛰지 않고, 서식 직후 End→Enter도 원문을 보존한다. 미지원 브라우저는 기본 End 동작을 유지한다.
- 사용자가 정한 인용 Enter 동작은 그대로다. 다음 줄은 일반 문단이며 `>`를 자동 삽입하지 않는다.
- 기존 색상·타이포그래피·패널 배치를 유지했다. 새 추상화·production 의존성은 추가하지 않았다.

## 자동 검증

| 검증 | 결과 |
| --- | --- |
| 표시 줄 End·로그인 복구 회귀 | 구현 전 2개 실패 확인 → 최소 수정 후 관련 2파일 90개 통과 |
| 최종 관련 React/Hook·편집기·패널·무대 회귀 | 10파일 354개 통과 |
| TypeScript `tsc --noEmit -p tsconfig.app.json` | 통과 |
| Core·Content `bootJar` | 현재 작업 트리 소스로 성공, 실제 로컬 서버 실행 |
| 최초 묶음 순수 단위 / Content 단위 | 기존 기록: 69개 / 26개 통과, 이번 프런트 후속 수정으로 백엔드 코드는 바꾸지 않음 |
| CodeRabbit 브랜치 전체 변경 리뷰 | 58파일 검토, End 표시 줄 처리 minor 1건 → 수정 |
| CodeRabbit 수정분 재리뷰 | 6파일 검토, 지적 0건 |
| Impeccable 최종 수정 UI 파일 detector | `[]`, 발견 0건 |
| ponytail-review | 추가로 삭제할 과잉 설계 없음. 네이티브 선택 이동과 기존 인증 보호 컴포넌트 재사용 |

최종 10파일은 `useWritingViewModel`, `ManuscriptEditor`, `WritingStudio`, `WritingStudio.stage`, `WritingStudio.panels`, `StudioPage`, `WritingPlanPanel`, `StoryPlanQuickJump.integration`, `SimulationStage`, `toastLifecycle` 테스트다. 기존 이미지 추가 테스트에서 React의 비동기 `act` 경고 1건이 출력됐지만 실패는 없다. 전체 저장소 테스트는 실행하지 않았다.

## 실제 브라우저·DB 결과

실제 모드 Vite → Core/Content → **새로 만든 격리 PostgreSQL 18**에서 공개 개발용 샘플 계정을 사용했다. 공유 DB나 배포 환경은 변경하지 않았다. 로컬 HTTP의 인증 쿠키는 개발 설정과 같이 `AUTH_COOKIE_SECURE=false`로 실행했다.

| 흐름 | 관찰 결과 |
| --- | --- |
| 4화 생성·제목/원고 입력·버전 저장 | 초안과 버전 1 생성, 실제 저장 시각 표시 |
| 저장 실패 | 이 검증용 Content 프로세스 중단 후 편집: 오류와 재시도 버튼 표시, 입력 유지 |
| 복구·명시적 재시도 | Content 재시작 후 저장 성공, 초안 56자 보존, 저장 버전 수는 1 유지 |
| 새로고침 | 세션 복구 후 4화·초안·버전 1 정상 복원 |
| 인용 → End → Enter | 원문 보존, 다음 줄에 인용 기호 자동 삽입 없음 |
| 긴 문단의 표시 줄 End → Enter | 324자 문단의 첫 표시 줄 끝(69번째 위치)에서 분리, 개행을 제외한 원문 일치 |
| 플롯·장면 | 플롯 1개·장면 2개 저장, 기본/고급 전환 시 작성 폼 유지 확인 |
| 장면 순서 | 위/아래 이동 저장 후 새로고침 복원. 최종 `함께 떠나는 약속` position 0, `성문 앞의 만남` position 1 |
| 흐름 시뮬레이션 입력 | 4화의 저장된 장면 2개를 같은 순서로 비트 목록에 표시 |
| 없는 회차 `?ep=999` | 오류와 회차 목록 표시, 원고 편집/저장 비활성, 임의 회차로 이동하지 않음 |
| 반응형·테마 | 320·390·1100·1500px 확인, 페이지 가로 넘침 없음, 라이트·다크 모드 확인. 모바일 장면 순서 버튼 동작 확인 |
| V38 | `content_schema_history`: version 38, `V38__story_plan_scene_position.sql`, success=true |

DB 조회로 4화 원고 3줄·저장 버전 수 1, 5화의 줄바꿈 검증 원고, 장면 순서와 revision을 확인했다. 폼에서 입력한 미저장 플롯 제목은 DB에 반영되지 않았다.

## 영상과 증거

로컬 산출물 폴더: `D:/storyfork-studio-verification/` (레포에는 영상·런타임·DB·비밀값을 넣지 않음).

- `studio-verification.mp4`: 51초, H.264, 1500×956. **실제 브라우저 조작 중 캡처한 화면을 2fps로 연결한 요약 영상**이다. 대기·로그인 복구 디버깅 구간을 생략하고 마지막에 반응형·오류·흐름 비트 정지 화면을 붙였다. 음성이나 무중단 화면 녹화는 아니다. 인코딩 프레임율 24fps는 같은 캡처 프레임을 반복한 것이다.
- `desktop-dark.jpg`, `mobile-320-dark.jpg`, `mobile-390-light.jpg`, `tablet-1100.jpg`: 화면 크기·테마 증거.
- `keyboard-wrapped.jpg`, `flow-plans.jpg`, `missing-episode.jpg`: 키보드·계획 연결·없는 회차 증거.
- `polish-red.log`, `polish-green.log`, `final-regression.log`: Red/Green와 최종 354개 결과.
- `code-review-final.log`, `code-review-polish.log`, `impeccable-detect.json`: 리뷰 결과.
- `database-proof.txt`, `migration-proof.txt`: 격리 DB의 실제 저장 내용·V38 적용 결과.

## 남은 검증과 한계

- 마지막 미저장 계획의 회차 이동 확인창에서 캡처 도구가 멈췄다. 브라우저 제어 복구도 Windows URL 확인 제한으로 종료됐다. **이탈 취소 이후 입력 유지의 실사용 확인은 완료로 세지 않는다.** 해당 로직의 회귀 테스트는 통과했다. 중단된 탭의 임시 뷰포트도 도구로 해제하지 못했다.
- Chrome의 실제 키보드·마우스와 반응형 뷰포트를 검증했다. 다른 브라우저·실제 터치 기기·스크린리더 전체 검증은 하지 않았다.
- AI·Neo4j 서버는 이번 격리 환경에서 실행하지 않았다. AI 연결 실패를 성공처럼 표시하지 않는 것과 저장된 흐름 비트 구성까지만 확인했다. 실제 모델 생성·세계관 관계 처리는 검증하지 않았다.
- DB 마이그레이션과 UI 저장을 실제 DB에서 확인했지만 DB 통합 테스트 전체·hosted CI·배포 환경 검증은 완료로 표시하지 않는다.
