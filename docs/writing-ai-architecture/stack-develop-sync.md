# Stacked PR develop 동기화

2026-11-10. PR 01 #220의 develop 충돌을 해결하고 PR 02~09로 순서대로 전파했다.
GitHub PR 병합은 하지 않았다. 기존 커밋은 재작성하지 않고 merge commit으로 보존한다.
기준 develop은 `b0398b69`다. 작업 전 `feat/frontend-ai-runs` / `074a7ce`는 clean이었다.

## 충돌 해결

기능표는 최신 develop의 병합 완료 현황을 보존하고 AI TASK별 구현 기록을 함께 남겼다.
Content 지침·마이그레이션 테스트는 최신 전역 번호와 V24 결번을 보존한다.
Compose에는 AI grant와 develop의 알림 outbox 설정을 함께 유지한다.
집필 ViewModel은 최신 발행 이력·회차 관리·작가의 말과 AI 권한 철회 초기화를 함께 유지한다.
기존 테스트 대역에 새 history/setPublicationVisibility/checkpoints 계약을 보완했다.

## 미병합 SQL 번호 충돌

최신 develop이 V17~V31을 사용하므로 미병합 AI SQL을 다음 번호로 이동했다.
이미 develop에 있던 모든 SQL과 아래 이동 대상의 SQL 내용은 변경하지 않았다. 운영/공유 DB는 접속하거나 적용하지 않았다.

| 기존 미병합 번호 | 새 번호 | 최초 포함 PR |
|---|---|---|
| V17 ai_run_thread | V32 | PR 03 #241 |
| V18 change_proposal | V33 | PR 06 #279 |
| V19 ai_run_progress | V34 | PR 09 #282 |
| V20 ai_run_input | V35 | PR 09 #282 |

최종 전역 migration은 V1~V35 중 V24를 제외한 34개다.
이전 TASK 인수보고의 번호·당시 테스트 수는 당시 기록이며 현재 계약은 이 매핑을 따른다.
개인 테스트 DB에 옛 AI 번호를 적용한 적이 있다면 이 브랜치의 fresh migration 검증에는 새 격리 DB를 사용해야 한다.
기존 DB의 history를 임의 repair/reset하지 않는다.

## 검증과 한계

PR 01 검색 단위 150개, Frontend HTTP 순수 단위 5개, Frontend 타입 검사를 통과했다.
정적 검사로 전역 번호 중복이 없는 것, develop SQL과 이동한 AI SQL의 내용 보존을 확인했다.
인프라 추출 검사 8개는 UTF-8 옵션으로 실행했다. 7개 테스트는 통과했고 SQL hash 검사 한 테스트의 3개 subcase가
Windows CRLF 때문에 실패했다. 해당 3개 Git 원본 blob hash는 기준값과 일치함을 별도로 확인했다.
검사를 약화하거나 기준 hash·기존 SQL을 바꾸지 않았다. 첫 실행의 cp949 읽기 오류는 `python -X utf8`로 해결했다.
Content 선택 단위 31개(ContentBoundary 11/RunService 19/RunSelection 1)가 통과했다. 최초 offline 시도는 최신 develop의 AMQP 의존성 cache 부재로 실행 전 실패해 기존 의존성을 온라인으로 해석했다.
통합·DB·브라우저·전체 빌드와 실 모델 호출은 실행하지 않는다. 최신 Required CI 성공 여부는 별도 확인해야 한다.

## 스택

`develop` → #220 → #230 → #241 → #244 → #245 → #279 → #280 → #281 → #282 순서다.
모든 PR은 draft를 유지한다. 각 base/head와 앞 head의 조상 포함 관계를 push 전후 검증한다.
강제 push·PR 병합·main/develop 직접 push·TASK 25 이후 구현은 하지 않는다.

검증 명령: AI `python -m pytest -m "not integration" tests/test_canonical_read.py tests/test_retrieval_contract.py tests/test_mock_retrievers.py tests/test_retrieval_coordinator.py --tb=short`; Frontend `pnpm exec tsc --noEmit -p tsconfig.app.json` 및 `pnpm exec vitest run src/data/api/aiRuns.test.ts src/data/api/aiRuns.transport.test.ts`; Content `gradlew unitTest --tests "ai.storyfork.content.episode.ContentBoundaryTest" --tests "ai.storyfork.content.proposal.RunSelectionTest" --tests "ai.storyfork.content.proposal.AiRunServiceTest" --no-daemon`; 인프라 `python -X utf8 -m unittest infrastructure.ci.test_content_extraction`.
