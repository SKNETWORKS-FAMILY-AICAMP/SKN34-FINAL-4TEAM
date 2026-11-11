# 10-A 최종 최신화 및 병합 준비

## 기준과 보존 증거

기존 test/initial-world-integration / f05cec6ce834781d263c2612d588c9224dfe7636과 원래 증거를 보존했다. 별도 test/initial-world-integration-refresh에서 develop 09f7d4349e8242db609ef18494a5c744e4b080ae를 결합했다. 정확한 원본 HEAD/base, patch-id, SQL 해시는 [manifest](manifest.json)에 있다. 원래 증거 파일은 Git blob 바이트 동일성을 검사했다(Windows working tree 줄바꿈과 구분).

최신 develop은 #283의 크레딧 원장 UI 관련 18개 파일이다. 텍스트 충돌 없이 결합됐다. integration에 들어온 develop delta patch-id가 원래 develop delta와 같고, 최신 develop 대비 WorldStudio 소유 변경 patch-id도 기존 10-A와 동일하다. 이 문서 추가만 별도 커밋이며 production 회귀 수정은 없다.

DI 실서비스·목업·types에 크레딧 원장과 initialWorld 등록을 모두 유지했다. 기능표의 크레딧 행과 전처리 항목도 보존했다. 크레딧 Core 조회/목업 계약은 유지하며 AI 비용 차감과 임의 연결하지 않는다. #286 후보 UI와 #288 확정 UI는 변경하지 않았다. V1~V5 SQL 해시는 기존 manifest와 일치한다. 새 API/마이그레이션/DB 정책은 없다.

## 검증

새 브랜치에서 기존 CI workflow_dispatch를 full=true로 실행한다. 프런트 단위·React(크레딧 DI/계정 화면 및 WorldStudio 포함), AI 단위·HTTP, Content PostgreSQL/Neo4j, V1~V5 fresh/순차/재실행, HTTP 시스템 및 Required CI를 확인한다. 정확한 최종 HEAD/run/결과는 최종 보고 및 해당 HEAD CI 기록으로 확인한다. 실제 개발 DB·유료 모델은 사용하지 않는다.

성공 분석은 Content+PG/Neo4j+AI HTTP 대역, 실제 AI 추출 서비스는 제공사 대역 통합으로 검증한다. HTTP 시스템은 실제 인증/분석 실패 및 완료 Fixture 이후 검토·반영·확정을 확인한다. 이것을 실제 배포의 단일 모델 성공 E2E로 보고하지 않는다.

## PR별 base와 병합 절차 — 이번에는 실행하지 않음

11개 PR은 동일 원본 HEAD·Draft·OPEN이며 조회 시 현재 base 기준 MERGEABLE/CLEAN, 원본 HEAD Required CI 성공이다. 이 상태는 각 base 기준이며 최신 develop에서 순차 병합 승인까지 완료됐다는 뜻이 아니다.

| 순서 | PR | 현재 base | 선행 병합 후 점검 |
|---|---|---|---|
| 1 | #219 | develop | 계약/Fixture 증분 |
| 2 | #225 | develop | #219 이후 V3/저장 계약 |
| 3 | #235 | develop | #225 이후 입력/공유 Fixture |
| 4 | #262 | develop | #235 이후 추출 API/기능표 |
| 5 | #266 | feat/initial-world-5c-dependencies | 앞 네 PR 병합 후 develop으로 base 변경, dependencies 자체 병합 금지 |
| 6 | #270 | feat/initial-world-analysis-execution | #266 이후 develop base, V5/검토 증분 |
| 7 | #284 | feat/initial-world-candidate-decisions | #270 이후 develop base, 반영/receipt |
| 8 | #285 | feat/initial-world-approved-application | #284 이후 develop base, metadata |
| 9 | #286 | fix/initial-world-metadata-roundtrip | #285 이후 develop base, 운영/크레딧 DI 및 후보 UI |
| 10 | #288 | feat/initial-world-review-ui | #286 이후 develop base, 버전 API 중복 제외·실제 /content 경로·경합 정책 |
| 11 | #289 | feat/worldstudio-revision-ui | #288 이후 develop base, 회차 summary 및 내부 Context |

각 단계 공통 절차:
1. 직전 PR의 실제 merged 상태·merge commit, 최신 develop과 다음 PR HEAD를 다시 고정한다.
2. [기존 manifest](../initial-world-10a/manifest.json)의 PR별 소유 diff와 비교한다. squash 등으로 ancestry가 달라지면 GitHub 표시 diff만 신뢰하지 말고 파일 내용/patch 동등성으로 선행 변경 중복을 확인한다.
3. 선행 병합 이후에만 다음 base를 develop으로 바꾼다. #266 검증 dependencies 및 두 통합 브랜치는 develop에 통째로 병합하지 않는다. 예상 밖 파일이 있으면 병합을 멈추고 원인을 조사한다.
4. 필요한 최신화·충돌 수정은 해당 기능 브랜치에 일반 commit/push로 반영한다. 이전 10-A 해결 기록에 따라 기능표/DI/버전 summary/이동 경로와 팀 변경을 유지한다. force push나 일괄 ours/theirs 선택은 하지 않는다.
5. 새 HEAD의 관련 단위·React·PG/Neo4j·HTTP 및 Required CI, 리뷰 승인 상태를 재확인한 후 사람 승인으로 병합한다. 이번 CI는 후속 변경 HEAD로 자동 승계되지 않는다.

## #288 경합 정책과 작업 재개 — 팀 결정 필요

현재 요청 A가 성공한 뒤 다른 탭이 B를 확정하면, 같은 key 재전송은 A를 반환하지만 currentRevisionId는 B라서 성공 표시/요청 정리를 하지 않는다. 새로고침·재로그인·최신 조회로도 이 차이는 사라지지 않는다. 사용자는 작성 화면으로 돌아가 초안 편집/저장은 할 수 있지만 새 확정은 pending key로 차단된다. **정상 UI에서 이 pending을 정리해 새 확정을 재개하는 기능은 없다.** 저장소 수동 삭제나 새 key 자동 생성은 복구 절차로 권장하지 않는다.

권장 후속안(이번에 미구현): 같은 key의 성공 응답과 원래 revision 상세·소유권·목록으로 A의 실제 저장을 확인했다면, `결과 미확인`과 `저장 확인됨·현재 기준은 다른 버전`을 구분한다. 원래 저장 ID를 보존하고 “내 확정은 저장됐으며 다른 탭에서 후속 확정이 생겼습니다”라고 안내한다. 명시적 “결과 확인 후 계속 작성”에서 최신 초안을 재조회하고 미저장 입력을 보호한 뒤 확인된 요청만 정리한다. 새 확정·복원·원문 덮어쓰기는 자동 실행하지 않는다. 네트워크/응답/상세 확인 실패는 기존 key/payload를 계속 유지한다.

팀이 정책을 승인하면 #288 소유의 최소 수정 및 경합/응답 유실/미저장/중복 클릭 테스트를 별도로 추가하고 #289·통합 HEAD도 재검증한다. 이번 최신화에는 정책을 임의 변경하지 않았다. 이 판단 전에는 #288을 무조건 병합 준비 완료로 표시하지 않는다.

## 경계와 배포 수용

9-A는 소유자용 확정 카드 Context 조각이다. 전체 Builder·작품/회차 연결·인물별 지식·MCP·관계 이력/Fork를 변경하지 않는다. 실제 DB 이력/체크섬, 인증·CSRF·proxy, 모바일·재로그인·timeout/재시작, 실제 모델 품질은 별도 배포 수용 항목이다. develop 직접 push, 기존 PR/Draft 변경, PR/자동 병합, 개발/운영 DB 배포는 수행하지 않는다.
