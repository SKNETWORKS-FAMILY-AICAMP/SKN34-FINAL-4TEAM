# TASK 24 사전 audit — 승인 전 기록

2026-11-10 구현 전 시점의 기록이다. 이후 사용자가 최소 Content·AI 계약 보완을 승인했다.
현재 구현·검증·남은 한계는 [인수보고](task24-handoff.md)와 [계약](task24-contract.md)을 따른다.
아래 미구현/미실행 표현은 사전 조사 시점을 뜻한다.
시작 브랜치 `feat/54-run-progress-cancel`, 기준 `1190ca7`, 시작 dirty 없음.

## 확인 범위

사용자가 제공한 공통 규칙·TASK 24, TASK 23 인수보고/현재 계약, 설계 01·04·05와 Frontend 지침을 확인했다.
Impeccable context는 저장소 PRODUCT.md와 기존 집필실을 대상으로 실행했다. DESIGN.md·surface brief는 발견되지 않았다.
audit와 polish playbook을 읽었으며 기존 집필실의 Operate 모드와 컴포넌트·토큰을 유지하는 방향이다.
Graphify는 기존 주변 화면 연결만 반환해 실제 UUID 라우팅·인증·HTTP·집필 View/ViewModel을 직접 확인했다.

## 구현 전 차단 항목

### P0 — 선택 구간을 서버에 결합할 계약 없음

`backend/content-service/.../proposal/service/dto/AiRunRequest.kt`의 target은 basisEpisode/forkId/character/baseRevision이다.
선택 UTF-16 span·선택 원문 hash·원고 판본 참조를 받지 않는다. prompt는 접수 hash와 길이 검증에는 쓰지만
실제 내부 dispatch 요청에는 전달되지 않는다(`AiRunService.kt`). 프론트에서 필드를 추가해 보내기만 해서는
선택 편집 요청을 승인 대상과 안전하게 결합했다고 볼 수 없다.
권장: TASK 24에 필요한 최소 서버 계약 보완 범위를 합의한다. 대안: 선택 편집은 연결하지 않고 지원 범위를 표시한다.

### P0 — 근거·Coverage·결과 본문 조회 경로 미연결

`AiRunResponse.kt`는 상태·오류·cursor와 결과 참조를 반환하며 `AiRunOutcome`에는
responseRef/proposalId/decisionId/applicationId/isMock만 있다. Evidence 인용·Coverage/gaps·생성 답변은 없다.
기존 proposal 판 조회는 저장된 변경 연산·근거 참조를 반환하지만, 실제 AI 후보 준비 transport와 결과 resolver는
TASK 23 인수보고대로 미연결이다. 실제 RemoteGrant는 dependency_unavailable로 끝난다.
권장: 인가된 결과 조회/후보 준비 계약을 먼저 보완한다. 대안: 현재 API의 접수·진행·취소·기존 제안 조회/결정만 연결한다.
Mock 성공으로 장애를 대체하거나 없는 근거/완성 원고를 화면에 만들지 않는다.

## 기술 audit

| 차원 | 확인한 근거 | 한계 |
|---|---|---|
| 접근성 | WritingStudio에 label, nav 이름, status/alert, CSS focus-visible 및 최소 44px 버튼이 있음 | 실제 contrast·키보드·스크린리더 미검증 |
| 성능 | 기존 ViewModel의 2초 autosave와 요청 취소 경계를 재사용 가능 | 새 Run 구독/렌더 성능은 구현 전 |
| 테마 | writing.css가 --tfg/--tacc/--pri-soft 등 기존 토큰을 사용 | 라이트/다크 렌더 미검증 |
| 반응형 | 900px·600px breakpoint와 min-width:0·줄바꿈 처리가 있음 | 모바일 실제 배치·터치·zoom 미검증 |
| 구현 정합성 | UUID /studio/:id는 WritingStudio, 이름 기반 데모는 별도 StudioPage 경로로 구분됨 | 위 P0 2건 때문에 전체 AI UX 수용 불가 |

정합성 판정: 기존 시각 체계는 보존 가능하지만 **TASK 24 전체 기능 경로는 현재 계약으로 통과할 수 없다**.
실행 명령:

```powershell
& 'C:/Users/rlarl/.agents/skills/impeccable/scripts/impeccable.cmd' detect frontend/src/presentation/features/studio/view/WritingStudio.tsx frontend/src/presentation/features/studio/view/writing.css --json
```

결과는 `[]`, exit 0이다. 이는 정적 detector 결과이며 렌더 품질이나 수용 테스트 통과 증거가 아니다.
렌더/대비 검증을 하지 않았으므로 종합 /20 점수는 확정하지 않는다. 브라우저·통합·빌드·실 모델·DB 변경은 실행하지 않았다.
새 논리/설정 변경이 없어 단위 테스트도 실행하지 않았다.

## polish 진행 조건

서버 계약 범위가 정해진 뒤 기존 WritingStudio에 한정해 audit의 P0를 해소하고 loading/empty/error/permission/conflict 상태를 연결한다.
선택·회차·작품·세션 세대로 이전 결과를 즉시 숨기고, 승인은 명시적 버튼·서버 판/hash·동일 멱등 키로만 보낸다.
그 후 craft-floor를 읽고 UI를 편집하며 desktop/mobile 렌더와 키보드·접근성·상태를 검증한다.
기존 이어쓰기 데모·API를 교체하지 않는다. 전체 시각 개편이나 새 웹 앱을 만들지 않는다.

## 이슈·영향·다음 행동

GitHub에서 #28·#32·#145·#146은 모두 closed/completed로 확인했다.
#28·#32는 assignee 없음, #145·#146은 yerin816이다. 이들은 이동/실패/역순 회귀의 참고이며 AI Run 새 구현 완료 이슈로 쓰지 않는다.
이슈 변경·댓글·생성은 없다. 새 의존성·lock·환경·원고·운영 데이터·외부 코드 전송·비용 영향은 없다.

사용자에게 한 가지 범위 결정을 요청했다: 최소 Content·AI 계약 보완을 포함할지, 현행 API로 가능한 부분 UI만 구현할지.
TASK 24의 “선행 결과 미완료라면 필요한 부분만 보고”와 공통 규칙의 미정 정책/범위 임의 확정 금지를 따른다.
추천은 최소 계약 보완 후 전체 수용 기준 구현이며, 대안은 축소 구현과 미연결 기능의 명시적 비활성 표시다.
현재 로컬 커밋은 없고 제안 메시지는 `docs: 집필실 AI 연동 선행 계약과 UI 감사 기록`이다.
push/PR/병합/배포와 TASK 25는 실행하지 않는다.
