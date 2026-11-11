# TASK 24 인수보고

> **2026-11-11 현행:** 실제 연결 여부와 남은 선행 조건은 최신 표를 따른다. [실연동 인수보고](live-rag-handoff.md) 참조. 아래 TASK별 결과는 당시 기록이다.

## 1. 작업 기준

2026-11-10. 시작 checkout `feat/54-run-progress-cancel`, 기준 `1190ca7`(TASK 23), 최초 dirty 없음.
사전 audit 이후 작업 브랜치 `feat/frontend-ai-runs`에서 구현했다.
사용자는 전체 UI에 필요한 최소 Content·AI 계약 보완을 승인했다. 외부 CodeRabbit 전송은 하지 않는 기존 결정을 유지했다.

## 2. 수행 범위

인증된 Run 생성·상태·SSE 재연결·취소와 결과·제안 조회/승인/거절/재수정 UI를 기존 UUID 집필실에 연결했다.
선택 UTF-16/hash/원고 판본 검증, prompt 전달, Content 인가 결과 resolver를 보완했다.
실제 전문 Agent 실행 조립·후보 자동 준비·유료 모델·운영 DB·배포와 TASK 25는 수행하지 않았다.
따라서 UI와 최소 계약은 구현했지만 실제 모델 기반 전체 수용 흐름은 아직 부분 완료다.

## 3. 파일과 동작

| 범위 | 주요 파일·변경 |
|---|---|
| Frontend Domain/DI | aiRun.ts, AiRunUseCase.ts, registerAppServices.ts, types.ts |
| Frontend Data | aiRuns.ts 및 순수/transport 테스트: 인증·CSRF·schema·cursor·멱등 body |
| Frontend UI | AiRunPanel.tsx, useAiRunViewModel.ts와 테스트, WritingStudio/StudioPage/writing.css: 선택·동의·상태·근거·diff·결정 |
| 개인정보 회귀 | useWritingViewModel.ts clearPrivate 및 늦은 저장 응답 테스트, WritingStudio 기존 테스트 유지 |
| Content/AI | RunSelectionPolicy/DTO/input_json V20/result controller·service·typed remote DTO, AI selection/schemas/state/service/graph 및 관련 테스트 |

파일 경로는 해당 서비스 src 또는 AI app/runs 아래다. 상세 인터페이스는 [계약](task24-contract.md)을 따른다.
새 production 의존성·lockfile·환경 파일 변경은 없다.

## 4. 문서와 이슈

공통 규칙, TASK 24, TASK 23 인수보고·계약, 01 현재 구조, 04 연동, 05 로드맵과 서비스 지침을 확인했다.
GitHub #28/#32/#145/#146은 closed/completed다. #28/#32 담당 없음, #145/#146 yerin816이며 회귀 참고로만 사용했다.
신규 Run 범위는 #54/#57의 후속 로컬 작업이다. 이슈 생성·변경·댓글·완료 처리는 하지 않았다.

## 5. 검증

Frontend에서 다음 명령을 실행했다.

```powershell
pnpm exec vitest run src/data/api/aiRuns.test.ts src/data/api/aiRuns.transport.test.ts src/presentation/features/studio/viewmodel/useAiRunViewModel.test.tsx src/presentation/features/studio/viewmodel/useWritingViewModel.test.tsx src/presentation/features/studio/view/WritingStudio.test.tsx
pnpm exec tsc --noEmit -p tsconfig.app.json
```

선택 35개 통과, 타입 검사 통과. 이후 접수 키 회귀를 추가해 Hook 6개를 재실행했다. 중복 승인·승인 전 비적용·세션/본문 변경·권한 실패·모호한 접수 재시도·SSE 재연결/410·취소 구분을 검증했다.
clearPrivate 후 늦은 저장 응답 회귀는 기존 abort guard 덕분에 처음부터 통과했으며 새 버그 재현으로 세지 않는다.

AI 서비스에서 실행했다(모두 합성 대역).

```powershell
.venv\Scripts\python.exe -m pytest -m 'not integration' tests/test_run_input.py tests/test_run_service.py tests/test_remote_content.py tests/test_checkpoints.py --tb=short
.venv\Scripts\python.exe -m pytest -m integration tests/test_run_api.py tests/test_remote_run_api.py tests/test_approval_resume.py --tb=short
```

선택 단위 40개 통과. 통합 최초 29통과/3실패는 새 prompt 일치 계약에 기존 합성 요청이 맞지 않은 것이었다.
요청/문맥 fixture를 일치시키고 잘못된 prompt는 403, 길이 초과는 422로 분리했다. 최종 통합 32개 통과(12.75초).
선택 없는 checkpoint bytes 보존 테스트는 먼저 실패하고 최소 수정 후 통과했다.

Content에서 격리된 임시 PG16/59174의 새 task24_content DB만 사용했다.

```powershell
.\gradlew.bat unitTest --tests 'ai.storyfork.content.proposal.RunSelectionTest' --tests 'ai.storyfork.content.proposal.AiRunServiceTest' integrationTest --tests 'ai.storyfork.content.proposal.AiRunHttpIntegrationTest' --tests 'ai.storyfork.content.proposal.AiRunClientIntegrationTest' --tests 'ai.storyfork.content.regression.ContentMigrationTest.fresh*' --no-daemon --offline
```

단위 20개·통합 12개(HTTP 9/client 1/fresh Flyway 2) 통과, 실패/오류/skip 0. V1~V19를 바꾸지 않았다.
기존 Windows V16 CRLF checksum 회귀는 범위 밖이며 전체 migration 회귀를 통과했다고 주장하지 않는다.

Impeccable audit/polish: 기존 토큰·버튼·라벨·status/alert·diff를 재사용했다. 정적 detector 결과는 []였다.
합성 Repository를 주입한 실제 WritingStudio를 desktop/390px에서 렌더해 줄바꿈·동의·diff·Mock 승인 비활성을 확인했다.
Aside 접근성 트리를 확인했고 이미지 반환 제한 때문에 IAB로 시각 확인했다. 실제 인증 서버/모델 E2E는 아니다.
대비 측정·전체 키보드/스크린리더·다크 모드·전체 테스트/production build는 실행하지 않았다.

## 6. 영향

Content가 현재 권한/판본/인용 검증과 저장을 소유한다. 승인 전 원고 저장은 없다.
input_json은 Content 업무 입력이며 비밀/원고 전체를 SSE·checkpoint·로그로 보내지 않는다.
새 DB는 테스트 전용이며 기존 업무 데이터는 변경하지 않았다. 실제 유료 호출·외부 코드 전송은 없다.
구독과 polling을 함께 사용하므로 실행 중 2초마다 상태 요청이 발생한다. 결과는 메모리에만 둔다.

## 7. 위험과 결정

실제 실행/후보 준비 transport가 연결되지 않아 운영 Run은 명시적 dependency_unavailable로 끝날 수 있다.
권장: 후속으로 명시 승인된 실행 조립과 합성 end-to-end를 연결한 뒤 실제 모델 검증을 별도 승인받는다.
대안: 현재 UI·계약만 시연하고 실 실행을 준비 중으로 유지한다. 임의 Mock fallback은 하지 않는다.
현재 result resolver는 허용 원고 excerpt 인용만 지원한다. 설정/초안 근거 확대는 별도 계약과 검증이 필요하다.
사용자에게 추가로 확정받아야 할 이번 단계 정책은 없다.

## 8. 로컬 커밋

메시지: `feat: 집필실 AI 실행과 제안 검토 연결`. 이 보고서와 같은 로컬 커밋에 전체 변경을 포함한다.
push·PR 생성·병합·배포는 실행하지 않았다. 완료 전 리뷰는 외부 전송 없이 로컬에서 수행했다.

## 9. 다음 단계

TASK 25는 시작하지 않았다. 다음 단계는 사용자 새 요청이 필요하다.
실 모델 기반 전체 흐름 완료 표시는 실행 조립·후보 준비 연결과 Required CI/병합 증거가 있을 때만 갱신한다.
기능표의 관련 전체 기능 행은 미완료 상태를 그대로 둔다.

## 종료 검증

로컬 리뷰에서 확정 종료 뒤 같은 질문의 접수 키 재사용을 실패 테스트로 재현했다.
확정 접수 응답 뒤 생성 키 캐시만 비우는 최소 수정으로 Hook 6개 통과했다. 응답 유실 재시도 계약은 유지한다.
과잉 설계 리뷰에서는 기존 DI/UseCase/인증 fetch와 브라우저 기본 API 재사용을 확인했고 새 추상화/의존성은 추가하지 않았다.
