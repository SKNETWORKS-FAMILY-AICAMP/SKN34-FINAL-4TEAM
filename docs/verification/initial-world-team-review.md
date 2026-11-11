# STORYFORK 초기 세계관 AI 전처리 — 팀 리뷰 패킷과 순차 병합 계획

작성 기준: 2026-11-11. **이번 산출물은 문서이며 실행 승인·리뷰 요청·Draft 해제·병합·배포를 뜻하지 않는다.**

## 1. 검증 기준과 읽는 순서

- 현재 원격 develop을 재확인: `63e5618d6022d362bc206bb99607a0b3a85158d1` — 검증 기준과 동일.
- 검증 브랜치 `test/initial-world-recovery-integration`, HEAD `248c23955710e8d281c774b47e11f1fa9ad16e67`.
- [전체 Required CI 성공 · run 42980143164](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/actions/runs/42980143164). 이번 문서 작업에서는 테스트를 재실행하지 않았다.
- 원본 11개 PR은 모두 OPEN/Draft이며 지정 HEAD가 그대로임을 재확인했다. 개별 CI 성공과 통합 CI 성공은 서로 다른 증거다. 사람의 승인·병합 후 새 HEAD 검증을 대신하지 않는다.
- A→B→C 순서로 리뷰한다. 리뷰 묶음은 **검토 순서**이지 세 덩어리의 통합 병합 단위가 아니다.
- 팀원의 작품·회차·Fork·MCP·관계 이력 작업은 본 11개 PR에 추가하지 않는다. 최신 develop에 이미 있는 팀원 기능은 보존하며 우리 변경으로 재분류하지 않는다.
- 기존 통합 증거: [최종 통합 기준 및 검사](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/docs/verification/initial-world-10a-recovery/README.md), [원본 PR별 소유 diff·마이그레이션 해시](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/docs/verification/initial-world-10a/manifest.json). 각 초기 단계 문서의 “미구현” 표현은 그 PR 시점의 범위이며 후속 PR의 현재 구현을 부정하지 않는다.

코드·Schema·검증 자료 링크는 develop의 미병합 파일 존재 여부와 무관하게 검증된 통합 HEAD `248c23955710e8d281c774b47e11f1fa9ad16e67`에 고정했다. 링크의 코드는 검토 증거이며 이 문서 PR에 기능 소스를 포함했다는 뜻이 아니다.

## 2. 고정 HEAD와 의존성

파일 수는 최초 소유 diff 기준이며 #288은 최신 보완을 포함한다. 이미 develop에 존재하는 버전 목록 코드 등은 통합 시 중복 제외되므로 향후 PR diff와 숫자만 기계적으로 맞추지 않는다.

| 묶음 | PR | 고정 HEAD | 현재 base | 소유 diff | 선행 조건 |
|---|---|---|---|---|---|
| A | [#219](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/219) | `6c5ed7d86081fa642c57b440f580bfbf3d143057` | `develop` | 6파일 | 계약 리뷰 |
| A | [#225](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/225) | `3bf930157b462b91a5593e9831b9053e9676d400` | `develop` | 21파일 | #219 |
| A | [#235](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/235) | `0f5d4efd9dad31e777f37ff103c20913e744f7d2` | `develop` | 10파일 | #219 → #225 |
| A | [#262](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/262) | `90568cfda520be91a9c5da7fad936fbadf9281eb` | `develop` | 13파일 | #219/#235 Input 호환, 지정 순서 유지 |
| B | [#266](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/266) | `3c3772924bf18c50e27e5020a723c223ac5332ee` | `feat/initial-world-5c-dependencies` | 21파일 | #219/#225/#235/#262 |
| B | [#270](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/270) | `0192047b1b91e6f70e2cb5c397d00ba6da67cd0b` | `feat/initial-world-analysis-execution` | 18파일 | #266 |
| B | [#284](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/284) | `cf3289346a74fae5c97b3ebba5a9dc51e87f9b01` | `feat/initial-world-candidate-decisions` | 17파일 | #270 |
| C | [#285](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/285) | `23c60ed8e4291a94c4be5329b0774f0d5294e26e` | `feat/initial-world-approved-application` | 6파일 | #284 |
| C | [#286](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/286) | `354555b5e166f98768afb017640c56ed4f1e9060` | `fix/initial-world-metadata-roundtrip` | 24파일 | #285 |
| C | [#288](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/288) | `bae2eca5a289956acca0b7b7e997b36dbb77d8ae` | `feat/initial-world-review-ui` | 21파일 | #286 |
| C | [#289](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/289) | `58265ebf659e04492536b344b5c9e4a934d6029f` | `feat/worldstudio-revision-ui` | 7파일 | #288 최신 보완 |


## A. 계약·분석 기반


### #219 — 초기 세계관 Input/Output·결정·반영 계약을 하나의 기준으로 고정한다.

- **핵심 파일:** [contract.schema.json](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/docs/design/initial-world-preprocessing/contract.schema.json), [honggildong.json](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/docs/design/initial-world-preprocessing/honggildong.json), [initial_world_contract.py](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/ai-service/tests/initial_world_contract.py), [test_initial_world_contract.py](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/ai-service/tests/test_initial_world_contract.py).
- **API·DB 영향:** 문서·Schema·테스트 전용 계약이며 운영 API/DB 변경 없음. Contract 봉투는 테스트용이지 신규 HTTP DTO가 아니다.
- **실패 처리:** 출처 ID/원문/UTF-16 경계/해시/기존 ID/의미 유형/검토 순번 불일치를 거부한다. Schema 통과만으로 의미적 사실성이나 반영 권한을 인정하지 않는다.
- **테스트 근거:** test_initial_world_contract.py: 합성 홍길동전 정상·오류 Fixture와 다중 검토/출처 검증. #235/#262의 공유 Fixture 호환 테스트도 통합 CI에 포함. 통합 성공 근거는 run 42980143164이며, 이 파일 목록은 테스트 탐색 지점이다.
- **팀 리뷰 쟁점:** UTF-16 코드 단위, 원문 무정규화, AI 후보와 author_revision의 근거 분리, 승인/반영/확정의 별도 의미를 계약 기준으로 승인할 것.
- **위험도:** 중간. 위험도는 실패 영향/검토 집중도를 뜻하며 현재 결함이나 자동 병합 차단을 뜻하지 않는다.


### #225 — 분석·후보·결정·반영 준비 기록을 기존 PostgreSQL 영속화 경계에 추가한다.

- **핵심 파일:** [V3__initial_world_analysis_storage.sql](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/resources/db/migration/worldstudio/V3__initial_world_analysis_storage.sql), [InitialWorldAnalysis.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/studio/entity/InitialWorldAnalysis.kt), [InitialWorldApplicationItem.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/studio/entity/InitialWorldApplicationItem.kt), [InitialWorldStoragePostgresTest.java](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/test/java/ai/storyfork/content/world/InitialWorldStoragePostgresTest.java).
- **API·DB 영향:** V3로 initial_analysis/candidate/decision/application/application_item 추가. 기존 DataSource·worldStudioTransactionManager와 별도 world_studio_schema_history 재사용. 공개 API·Neo4j 쓰기 없음. V4는 #266, V5는 #270 소유다.
- **실패 처리:** world/key 및 sequence/예약 UNIQUE, 소속 FK, 원본·payload·terminal 이력 불변을 DB에서도 보호한다. JSON CHECK는 전체 Schema/소유권 검증의 대체물이 아니다. unknown 예약을 임의 삭제하지 않는다.
- **테스트 근거:** InitialWorldStoragePostgresTest·InitialWorldStorageJpaPostgresTest 및 WorldStudioFlyway/Migration/History 테스트: 신규 설치·순차 업그레이드·재실행·기존 기록/ID/원문 보존. V1~V5 Git blob 해시 보존 확인. 통합 성공 근거는 run 42980143164이며, 이 파일 목록은 테스트 탐색 지점이다.
- **팀 리뷰 쟁점:** V3→V4→V5의 additive 적용과 기존 이력 보존을 묶어서 검토하되 각 SQL의 소유 PR은 구분한다. 운영/개발 DB의 실제 schema history 대조는 별도 배포 승인 단계이며 기존 SQL 수정·repair로 해결하지 않는다.
- **위험도:** 높음. 위험도는 실패 영향/검토 집중도를 뜻하며 현재 결함이나 자동 병합 차단을 뜻하지 않는다.


### #235 — 인증된 소유자의 저장된 초안을 분석 입력 스냅샷으로 고정한다.

- **핵심 파일:** [InitialWorldInput.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/InitialWorldInput.kt), [WorldStudioService.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/WorldStudioService.kt), [InitialWorldInputContractTest.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/test/kotlin/ai/storyfork/content/world/InitialWorldInputContractTest.kt), [InitialWorldInputTest.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/test/kotlin/ai/storyfork/content/world/InitialWorldInputTest.kt).
- **API·DB 영향:** Content 내부 구성/검증 함수. 신규 공개 API·migration·모델 호출 없음. draftRevision/relationshipVersion/currentRevisionId 및 기존 카드 ID·title/body·세계관 설명을 보존한다.
- **실패 처리:** 관계 저장 미완료, sourceId/ownerId/field·원문·해시 불일치, UTF-16 surrogate 절단을 거부한다. 사용 직전 world 잠금 안에서 다시 검증하고 외부 AI 호출을 잠금 안에 넣지 않는다.
- **테스트 근거:** 실제 Jackson 직렬화와 #219 Schema/공유 Fixture 호환, Unicode·기존 ID·원문 불변·기준 버전 검증 테스트. 통합 성공 근거는 run 42980143164이며, 이 파일 목록은 테스트 탐색 지점이다.
- **팀 리뷰 쟁점:** 저장된 활성 원문만 포함되는지, 입력 구성과 사용 시점 재검증이 함께 호출되는지 확인한다. 미저장 UI 입력을 분석한 것으로 표시하지 않는다.
- **위험도:** 중간. 위험도는 실패 영향/검토 집중도를 뜻하며 현재 결함이나 자동 병합 차단을 뜻하지 않는다.


### #262 — AI Service에서 7종 후보를 추출하는 내부 API와 실제 Responses 호출 경로를 연결한다.

- **핵심 파일:** [models.py](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/ai-service/app/initial_world/models.py), [router.py](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/ai-service/app/initial_world/router.py), [service.py](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/ai-service/app/initial_world/service.py), [test_initial_world.py](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/ai-service/tests/test_initial_world.py), [test_initial_world_http.py](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/ai-service/tests/test_initial_world_http.py).
- **API·DB 영향:** POST /internal/v1/initial-world/extractions, 기존 내부 토큰/OpenAI 설정 사용. DB/Neo4j 직접 접근 없음. 기존 /internal/v1/proposals는 유지한다.
- **실패 처리:** 입력/토큰/설정/timeout/제공사 오류 및 잘린 JSON을 명시적으로 실패 처리. 인용 원문을 프로그램이 대조하여 UTF-16 좌표/quoteHash 계산. 잘못된 후보를 일부 버리고 전체 성공으로 만들지 않는다. 자동 모델 재시도 없음.
- **테스트 근거:** 제공사 대역의 정상 7유형, 모호한 이름/ID, CRLF/이모지, 잘린 출력, timeout, 내부 토큰 및 프롬프트 데이터 분리 테스트. 실제 모델 품질은 미검증. 통합 성공 근거는 run 42980143164이며, 이 파일 목록은 테스트 탐색 지점이다.
- **팀 리뷰 쟁점:** 유형 오분류 방지의 제한된 한국어 문자열 검사는 의미적 사실성 보장이 아니다. 인용 모호성의 보수적 거절과 diagnostics 범위를 검토하고 실모델 품질 평가는 분리한다.
- **위험도:** 중간. 위험도는 실패 영향/검토 집중도를 뜻하며 현재 결함이나 자동 병합 차단을 뜻하지 않는다.


## B. 분석 실행·검토·초안 반영


### #266 — Content 요청부터 분석 실행·후보 UUID 부여·완료/재조회까지 연결한다.

- **핵심 파일:** [InitialWorldAnalysisService.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/InitialWorldAnalysisService.kt), [InitialWorldExtractionClient.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/client/InitialWorldExtractionClient.kt), [InitialWorldAnalysisController.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/controller/InitialWorldAnalysisController.kt), [InitialWorldOutputValidation.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/InitialWorldOutputValidation.kt), [V4__initial_analysis_failure_reason.sql](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/resources/db/migration/worldstudio/V4__initial_analysis_failure_reason.sql).
- **API·DB 영향:** POST/GET /api/v1/world-studios/{worldId}/analyses, GET 상세/candidates. V4는 기존 분석 기록에 nullable failure_code를 additive 추가한다. 준비 PG tx → tx/잠금 밖 AI 호출 → 결과와 후보를 같은 PG tx에 확정.
- **실패 처리:** 같은 world/key·동일 요청은 기존 결과, 다른 내용은 409. 실행 중 202+Location. AI_TIMEOUT/응답 미확인/lease 만료/커밋 미확인을 구분한다. 만료 조회는 unknown 처리이며 재실행이 아니다. 분석 unknown은 application unknown과 달리 동일 key로 모델 호출을 재개하지 않는다. 늦은 결과는 token/deadline으로 차단한다.
- **테스트 근거:** InitialWorldOutputTest·InitialWorldAnalysisPostgresTest: 동시 중복 호출 차단, 기준 정보·근거/ID 검증, 부분 후보 롤백, stale, 저장/응답 유실·재시작. HTTP 시스템의 실제 인증 경로와 제공사/AI 대역 경계를 구분한다. 통합 성공 근거는 run 42980143164이며, 이 파일 목록은 테스트 탐색 지점이다.
- **팀 리뷰 쟁점:** unknown에서 비용·실행 여부를 단정하지 않는 안내, 자동 새 key/모델 재호출 금지, 명시적 새 분석의 사용자 선택을 검토한다. dependencies는 검증용으로만 사용한다.
- **위험도:** 높음. 위험도는 실패 영향/검토 집중도를 뜻하며 현재 결함이나 자동 병합 차단을 뜻하지 않는다.


### #270 — 작가의 approve/edit/hold/reject를 누적 이력으로 저장한다.

- **핵심 파일:** [InitialWorldDecisionValidation.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/InitialWorldDecisionValidation.kt), [InitialWorldAnalysisService.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/InitialWorldAnalysisService.kt), [InitialWorldDecision.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/studio/entity/InitialWorldDecision.kt), [V5__initial_decision_request_identity.sql](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/resources/db/migration/worldstudio/V5__initial_decision_request_identity.sql), [InitialWorldReviewTest.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/test/kotlin/ai/storyfork/content/world/InitialWorldReviewTest.kt).
- **API·DB 영향:** POST .../analyses/{analysisId}/candidates/{candidateId}/decisions. V5로 request key/hash/comment와 멱등성 보완. 기존 이력을 덮어쓰지 않는다. comment는 DB에 보존하나 기존 DecisionRecord에는 반환하지 않는다.
- **실패 처리:** 동일 key/내용은 기존 이력, 다른 내용/오래된 expectedDecisionSequence는 409. stale/미완료 분석 신규 검토 차단. edit는 author_revision/evidence=[]/pending이며 별도 approve 필요. 허위 AI 근거를 포함한 수정은 422.
- **테스트 근거:** InitialWorldReviewTest 및 PG/HTTP 테스트: 다중 순번, 동시 검토, 응답 유실, 원본 불변, 타 세계관·타인 거부, V4→V5 이력 보존. 통합 성공 근거는 run 42980143164이며, 이 파일 목록은 테스트 탐색 지점이다.
- **팀 리뷰 쟁점:** 승인은 초안 반영이 아님을 확인한다. 최신 sequence의 상태·내용을 사용할 것. 감사 comment의 현재 조회 제한도 명시한다.
- **위험도:** 중간. 위험도는 실패 영향/검토 집중도를 뜻하며 현재 결함이나 자동 병합 차단을 뜻하지 않는다.


### #284 — 승인된 후보를 별도 application 요청으로 기존 초안에 부분 추가한다.

- **핵심 파일:** [InitialWorldApplicationService.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/InitialWorldApplicationService.kt), [InitialWorldAdditionMapper.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/InitialWorldAdditionMapper.kt), [WorldStudioService.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/WorldStudioService.kt), [InitialWorldApplicationController.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/controller/InitialWorldApplicationController.kt), [InitialWorldAnalysisPostgresTest.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/test/kotlin/ai/storyfork/content/world/InitialWorldAnalysisPostgresTest.kt).
- **API·DB 영향:** POST .../analyses/{analysisId}/applications 및 GET .../applications/{applicationId}. 새 migration 없음. V3 예약/receipt 구조와 replace:false 저장 경로, Neo4j 현재 상태 CAS 재사용. 새 카드·draftRevision·관계 완료·applied receipt는 최종 동일 PG tx에서 확정.
- **실패 처리:** 준비 tx에 UUID/payload/key 영속화. Neo4j 성공 후 PG 실패는 그래프 롤백으로 가정하지 않고 unknown을 유지한다. 동일 요청 POST로 재개하며 성공 receipt는 stale 검사보다 우선한다. 미완료 예약은 일반 저장·확정/경합을 차단한다. 자동 예약 해제·취소 API 없음.
- **테스트 근거:** InitialWorldAdditionTest와 실제 격리 PG/Neo4j 장애 주입: 그래프 호출 전/후 실패, PG finalize/commit 응답 실패, 동일 key 복구, 재시작, 원문/기존 관계/확정본 불변, 동시 저장 경합, HTTP receipt. 통합 성공 근거는 run 42980143164이며, 이 파일 목록은 테스트 탐색 지점이다.
- **팀 리뷰 쟁점:** 분산 원자성을 주장하지 않는지, 미확인 예약으로 쓰기가 막힌 경우 동일 key 복구만 제공하는 제약을 검토한다. 영구 장애에 대한 새 key 우회/예약 강제 삭제를 운영 절차로 만들지 않는다.
- **위험도:** 높음. 위험도는 실패 영향/검토 집중도를 뜻하며 현재 결함이나 자동 병합 차단을 뜻하지 않는다.


## C. 작가 UI·확정 버전·Context


### #285 — AI 생성 부분 studio DTO를 기존 UI 모델로 읽고 metadata를 왕복 보존한다.

- **핵심 파일:** [HttpWorldStudioRepository.ts](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/data/world-studio/HttpWorldStudioRepository.ts), [studioWorld.ts](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/domain/entities/studioWorld.ts), [studioCards.ts](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/domain/entities/studioCards.ts), [http.test.ts](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/data/world-studio/http.test.ts).
- **API·DB 영향:** 프런트 어댑터/모델 변경. 기존 공개 API·DB 변경 없음. 부분 DTO를 정본 카드/관계 필드와 조합하며 preprocessing/serverMetadata를 보존한다.
- **실패 처리:** 검증을 제거하거나 전부 note로 변환하지 않는다. 저장할 수 없는 관계 표현을 임의 편집 가능으로 표시하지 않는다. replace:true 재저장에서도 출처·의미 유형·ID를 보존한다.
- **테스트 근거:** http.test.ts: AI 카드/관계 파싱, semanticType/provenance/evidence/decisionSequence 왕복, 기존 DTO·카드·관계 회귀. 통합 성공 근거는 run 42980143164이며, 이 파일 목록은 테스트 탐색 지점이다.
- **팀 리뷰 쟁점:** UI에서 본문을 바꾼 뒤 현재 본문의 근거와 최초 적용 감사 메타데이터가 혼동되지 않는지 확인한다. #286 적용 후 재조회 경로와 함께 리뷰한다.
- **위험도:** 중간. 위험도는 실패 영향/검토 집중도를 뜻하며 현재 결함이나 자동 병합 차단을 뜻하지 않는다.


### #286 — 작가용 분석→검토→승인→선택 반영→서버 재조회 화면을 연결한다.

- **핵심 파일:** [HttpInitialWorldRepository.ts](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/data/world-studio/HttpInitialWorldRepository.ts), [initialWorldSchemas.ts](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/data/world-studio/initialWorldSchemas.ts), [useInitialWorldReview.ts](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/presentation/features/worldstudio/viewmodel/useInitialWorldReview.ts), [InitialWorldReview.tsx](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/presentation/features/worldstudio/view/InitialWorldReview.tsx), [useWorldStudioViewModel.ts](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/presentation/features/worldstudio/viewmodel/useWorldStudioViewModel.ts).
- **API·DB 영향:** 프런트에서 기존 Content 분석/decisions/applications API만 사용. DB/API 추가 없음. mockup은 미지원 안내. #285 metadata 어댑터를 사용해 적용 카드·관계를 다시 읽는다.
- **실패 처리:** 계정/세계관별 key/path/payload를 전송 전에 보존하고 unknown/통신 오류 때 새 key를 자동 생성하지 않는다. applied 응답만으로 성공하지 않고 GET receipt 및 생성 ID/revision을 포함한 초안 재조회까지 확인한다. edit 후 재승인, stale/held/rejected 차단, 미저장 이동 보호.
- **테스트 근거:** initialWorld.test.ts·InitialWorldReview.test.ts·useInitialWorldReview.integration.test.tsx 및 metadata http.test.ts: 중복 클릭/키 보존/계정 격리/수정→승인/receipt→재조회/unknown 복구. 이전 localhost HTTP 대역 QA는 실제 배포 E2E가 아니다. 통합 성공 근거는 run 42980143164이며, 이 파일 목록은 테스트 탐색 지점이다.
- **팀 리뷰 쟁점:** 후보 원본·작가 수정·승인·실제 반영을 시각적으로 구분하고 metadata 왕복을 #285와 합쳐 확인한다. localStorage에 수정문이 포함될 수 있음, 다른 장치/브라우저 데이터 삭제 시 복구 기록이 없음, 취소 API 없음도 인지한다.
- **위험도:** 높음. 위험도는 실패 영향/검토 집중도를 뜻하며 현재 결함이나 자동 병합 차단을 뜻하지 않는다.


### #288 — 초안 저장과 별개인 확정 생성·목록·읽기 전용 상세 및 후속 확정 복구 UX를 제공한다.

- **핵심 파일:** [useWorldRevisions.ts](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/presentation/features/worldstudio/viewmodel/useWorldRevisions.ts), [WorldRevisions.tsx](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/presentation/features/worldstudio/view/WorldRevisions.tsx), [HttpWorldStudioRepository.ts](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/data/world-studio/HttpWorldStudioRepository.ts), [useWorldRevisions.integration.test.tsx](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/presentation/features/worldstudio/viewmodel/useWorldRevisions.integration.test.tsx), [WorldRevisions.integration.test.tsx](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/frontend/src/presentation/features/worldstudio/view/WorldRevisions.integration.test.tsx).
- **API·DB 영향:** 기존 POST /world-studios/{id}/revisions와 GET 목록/상세 연결. 목록 API의 develop 중복 구현은 통합에서 제외/보존 처리했다. 복구 보완 자체는 UI/ViewModel·테스트·문서이며 백엔드 계약 변경 없음.
- **실패 처리:** 동일 key 응답의 원래 revisionId를 상세/목록/최신 초안과 검증한다. 원래 확정 성공과 현재 최신 버전이 다르면 후속 버전 존재로 표시한다. 명시 확인 전 key 유지. 확인 버튼은 새 POST 없이 재조회 후 해당 기록만 정리한다. 검증 불가·다른 key·미저장 입력·계정/화면 변경은 정리 차단.
- **테스트 근거:** Hook 17개+화면 1개, HTTP Repository 단위와 전체 React/HTTP: 응답 유실·후속 포인터·확인 전 보존·POST 금지·새 확정·재로그인/탭 잠금 대역·이전 버전 불변. 통합 성공 근거는 run 42980143164이며, 이 파일 목록은 테스트 탐색 지점이다.
- **팀 리뷰 쟁점:** 원래 성공한 확정과 현재 최신 포인터를 분리하는 정책, 사용자의 명시 확인, 확인 실패 시 같은 key 유지에 동의할 것. 확정은 작품/회차 발행이 아니며 과거 관계/복원 버튼은 지원하지 않는다.
- **위험도:** 중간. 위험도는 실패 영향/검토 집중도를 뜻하며 현재 결함이나 자동 병합 차단을 뜻하지 않는다.


### #289 — 소유자에게 지정된 확정 설정만 제공하는 Content 내부 읽기 전용 Context를 구성한다.

- **핵심 파일:** [WorldStudioService.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/WorldStudioService.kt), [WorldConfirmedContextResult.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/dto/WorldConfirmedContextResult.kt), [WorldStudioServiceTest.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/test/kotlin/ai/storyfork/content/world/WorldStudioServiceTest.kt), [WorldStudioServicePostgresTest.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/test/kotlin/ai/storyfork/content/world/WorldStudioServicePostgresTest.kt), [InitialWorldAnalysisPostgresTest.kt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/248c23955710e8d281c774b47e11f1fa9ad16e67/backend/content-service/src/test/kotlin/ai/storyfork/content/world/InitialWorldAnalysisPostgresTest.kt).
- **API·DB 영향:** confirmedContext(worldId, subject, revisionId) 내부 함수/DTO. 신규 공개 API·DB 변경 없음. world/revision/cardVersion 출처·기존 엔터티·의미 metadata를 보존한다.
- **실패 처리:** 기존 소유권/확정 버전 조회를 재사용한다. 이후 초안·원본 AI 후보·pending/held/rejected·미반영 승인 후보를 합성하지 않는다. 과거 관계는 not_recorded, 현재 관계도 미포함, completeWorldContext=false.
- **테스트 근거:** 지정 확정본 반복 재현, 원문/ID/metadata 불변, 이후 수정/미승인 후보 격리, 타인·미확정 거부, PG 재시작 재조회. 최신 #288과 통합 검증했지만 #289 원본 HEAD는 이전 기반 그대로다. 통합 성공 근거는 run 42980143164이며, 이 파일 목록은 테스트 탐색 지점이다.
- **팀 리뷰 쟁점:** 소유자 권한이 회차별·인물별 공개 권한을 의미하지 않는다. authorizedSubject는 재사용 가능한 권한 토큰이 아니다. 작품/회차 연결·지식 필터·Fork·MCP·관계 이력/전체 Context Builder는 팀원 별도 범위다.
- **위험도:** 높음. 위험도는 실패 영향/검토 집중도를 뜻하며 현재 결함이나 자동 병합 차단을 뜻하지 않는다.


## 3. 위험과 실제 병합 차단을 구분

**이미 검증됨:** 지정 HEAD의 모든 Required CI, 프런트 단위 1,025개·React 통합 1,097개, AI 단위/HTTP, PostgreSQL/Neo4j 통합, 전체 HTTP 시스템, V1~V5 원본 해시·신규/순차/재실행·기존 기록 보존. #288과 #289의 결합, 이전 확정 불변과 후보 격리도 포함한다. 이 기준에서 알려진 통합 CI 실패나 수동 해결이 필요한 충돌은 남아 있지 않았다.

**위험하지만 현재 테스트로 보호되는 지점:** V3~V5 영속 이력, 모델 결과 미확인/비용 불확실성, PG/Neo4j 부분 성공, 브라우저 재시도 기록, 소유자 Context의 권한 경계. 문서에 기록한 제한을 팀이 이해하고 수용하는 리뷰가 필요하다.

**현재 절차상 보류:** 모든 PR이 의도적으로 Draft이고 실제 실행 승인이 없다. 이번 문서는 자동 병합 허가가 아니며 사람 리뷰 완료를 주장하지 않는다. 실모델 품질 미검증은 구조/계약 CI 실패와 다르지만 실제 모델을 사용자에게 개방하기 위한 별도 판단 항목이다.

| 차단 조건 | 처리 |
|---|---|
| 승인받지 않은 Draft 해제/병합 또는 팀원 수정 요청 미처리 | 해당 단계 중지, 사람 리뷰/명시적 실행 승인 후 진행 |
| 최신 대상 HEAD Required CI 실패·대기·누락 | 다음 PR 진행 금지. 해당 HEAD에서 원인 확인 후 관련 CI 성공 |
| base 변경 뒤 선행 코드가 중복 포함되거나 기능 범위가 커짐 | 소유 manifest와 실제 tree를 비교하고 증분만 남기기 전 중지 |
| 팀원 코드·기존 API·migration 체크섬/이력 손실 | 병합 차단. SQL 수정/repair/DB 초기화로 우회하지 않음 |
| 미확인을 성공으로 표시, 새 key 자동 재호출, 권한/원문/버전 오염 | 병합 차단 결함으로 회귀 테스트와 최소 수정 필요 |
| 실제 배포 SHA·설정·schema 상태 미확인 | 배포 수용 판정 보류. 단순 코드 CI 실패로 혼동하지 않음 |

## 4. 순차 병합 실행 체크리스트 — 실행은 별도 승인 후

고정 순서: **#219 → #225 → #235 → #262 → #266 → #270 → #284 → #285 → #286 → #288 → #289**.

저장소는 merge/squash/rebase 방식을 모두 허용한다. **이번 stack의 권장 실행 방식은 원본 이력을 보존하는 merge commit**이다. 이를 팀이 결정하기 전 병합을 시작하지 않는다. 팀 정책상 squash가 필요하면 같은 내용이 다른 SHA가 되는 점을 반영해 patch/tree 기준으로 비교하며 강제 push로 이력을 재작성하지 않는다.

### 시작 전

- [ ] 책임자와 리뷰 담당을 팀에서 정하고 A/B/C 각 검토 결과를 기록한다. 이 문서에서는 담당자를 임의 지정하거나 리뷰 요청을 보내지 않는다.
- [ ] 배포 자동화 연결 여부와 배포 수행 주체를 확인한다. develop 병합이 자동 배포를 유발한다면 병합 승인이 배포 영향까지 포함하는지 먼저 확인한다. 설정은 임의 변경하지 않는다.
- [ ] develop·각 PR HEAD·base·Draft·리뷰·Required CI를 다시 조회해 위 기준과 차이를 기록한다.
- [ ] merge 방식 및 실행 승인을 받고, 승인된 PR만 순서에 맞춰 Draft 해제/리뷰/병합 절차를 진행한다. 자동 병합은 사용하지 않는다.

### 매 PR마다 반복

- [ ] 선행 PR의 실제 merged 상태와 merge commit을 확인하고 최신 develop을 fetch한다.
- [ ] 다음 PR HEAD를 고정한다. base가 선행 브랜치라면 선행 반영 뒤 develop으로 전환한다. 이미 develop인 #219/#225/#235/#262도 기준 SHA를 다시 확인한다.
- [ ] `git diff <소유기준>..<PR HEAD>`와 변경 파일/내용을 검증 manifest와 대조한다. GitHub 3-dot diff만 보고 squash 중복을 새 변경으로 오인하지 않는다.
- [ ] 필요한 최신화는 **해당 기능 브랜치에 develop을 정상 merge**하는 방식으로 수행한다. force push·reset·원본 브랜치 삭제/재생성은 하지 않는다.
- [ ] DI의 initialWorld/creditLedger/workNotice 등 팀원 등록, 기능표, 기존 Auth/Content/회차 동작과 migration을 보존한다. blanket ours/theirs 해결은 금지한다.
- [ ] 이미 develop에 있는 #288 버전 목록 API는 유지하고 중복 이식을 제거한다. 통합 당시 해소 근거는 최초 manifest의 resolutions를 따른다.
- [ ] 변경 HEAD의 관련 테스트와 **Required CI**를 재확인하고, 격리 통합 예상 tree에서 회귀가 없는지 확인한다. 기존 녹색 배지만 승계하지 않는다.
- [ ] 팀 리뷰 쟁점·수정 요청 처리 및 명시적 승인 확인 후 **이 PR 하나만** 병합한다.
- [ ] 병합 결과 SHA·실제 diff·CI·보존 사항을 아래 기록 양식에 남기고 다음 PR로 넘어간다.

### #266 특별 절차

`feat/initial-world-5c-dependencies`는 검증용이며 **develop에 병합할 대상이 아니다**. #219/#225/#235/#262가 실제 반영된 다음 #266 base를 develop으로 전환한다. #266 브랜치에 최신 develop을 정상 merge하고, 원래 dependencies 기준의 5-C 소유 변경(21파일)을 대조한다. 선행 구현이 diff에 남으면 중복 원인을 해결하기 전 중지한다. squash로 ancestry가 다르더라도 내용이 같으면 불필요한 선행 재적용을 하지 않는다. dependencies 브랜치를 별도 PR로 올리거나 통째로 merge하는 우회는 없다.

### #289 특별 절차

원본 HEAD `58265ebf`는 #288 이전 기반이다. 최신 #288과 함께 동작하는 것은 통합 HEAD에서 검증됐지만 원본 HEAD 자체가 최신 #288을 포함하는 것은 아니다. 원본 갱신이 필요하면 먼저 방식·영향을 보고한다. 권장 방식은 선행 #288이 포함된 develop을 #289 브랜치에 정상 merge하여 이력을 보존하는 것이다. #289 고유 7파일/132줄과 Context 경계를 대조하고 새 HEAD CI를 실행한다. 새로운 기능이나 전체 Context Builder를 섞지 않는다.

### 통합 브랜치 사용 제한

`test/initial-world-integration`, `test/initial-world-integration-refresh`, `test/initial-world-recovery-integration`은 모두 **검증 증거**다. develop으로 merge하거나 11개 PR을 대신하는 합본 PR로 쓰지 않는다. `6abb5ab1→bae2eca5` 보완을 이미 포함한 #288을 병합할 때 보완 커밋을 다시 이식하지 않는다.

### 실행 기록 양식

| PR | 이전 develop | 원본/갱신 HEAD | 전환 base | 소유 diff·팀원 보존 확인 | 새 CI URL | 리뷰/승인 | 병합 SHA | 다음 단계 |
|---|---|---|---|---|---|---|---|---|
| 미실행 | — | — | — | — | — | — | — | 이번 작업에서는 채우지 않음 |

## 5. develop 변경에 따른 재검증 기준

현재는 원격 develop이 검증 기준 `63e5618d`와 일치한다. 이후에는 다음 표로 판단한다.

| 변경 | 재검증 |
|---|---|
| PR HEAD/base 또는 선행 병합으로 diff/ancestry 변경 | 소유 diff·팀원 보존 확인 및 해당 HEAD Required CI 재실행 |
| 문서만 변경 | 실제 문서-only인지 확인. Schema/Fixture/실행 지침은 단순 문서로 분류하지 않음. CI 정책이 요구하는 검사는 그대로 수행 |
| Auth/세션/CSRF/권한·DI·프런트 저장 변환/UI 변경 | 프런트 단위·React, 권한/계정 격리·재시도, 관련 HTTP 시스템 |
| Schema/Fixture·Input/Output·AI 클라이언트 변경 | 계약/Python·Kotlin 호환, AI 단위/HTTP, 근거/ID/유형/stale·분석 실행 통합 |
| PG entity/migration/transaction·Neo4j CAS·WorldStudio 저장/버전 변경 | 신규/순차 업그레이드·기존 데이터 보존·부분 실패·동시 요청·재시작·버전/Context 및 전체 HTTP 시스템 |
| CI/Compose/서비스 경계 또는 영향 범위를 확정할 수 없는 변경 | 별도 격리 통합에서 전체 workflow_dispatch 재검증 |

최종 11개 순차 병합 뒤에는 **실제 develop HEAD의 전체 CI**를 다시 확인한다. 지금의 통합 CI는 미래 merge 결과를 자동 보증하지 않는다. 새 기준과 실행 결과를 함께 기록하고 검증 중 추가 변경이 발생하면 포함/미포함 SHA를 명확히 구분한다.

## 6. 병합 후 실제 개발 서버 E2E 수용 시나리오 — 아직 미실행

배포와 검증 실행은 별도 승인 후 진행한다. 대상은 제공된 STORYFORK 개발 서버이며 일반 V4 테스트 계정과 별도의 `QA-initial-world-<시각>` 세계관만 사용한다. 비밀번호는 보고서/스크린샷/HAR에 기록하지 않는다. 기존 사용자 데이터 삭제·임의 DB fixture 주입·개발 DB 설정 변경은 하지 않는다.

**사전 조건:** 배포 artifact/build SHA가 승인된 develop과 일치하는지 확인한다. 확인 가능한 근거가 없으면 일치한다고 가정하지 않는다. 배포 담당자가 schema history/체크섬/기존 기록 보존을 확인하고 V3~V5 정상 적용을 증명해야 한다. 현재 목업 모드가 아닌 실제 HTTP 어댑터인지, 테스트 계정 권한·내부 토큰·API 라우팅을 확인한다.

| 단계 | 사용자 동작·요청 관측 | 수용 기준/보존 증거 |
|---|---|---|
| 1 | QA 세계관 생성, 인물 2명·장소/규칙·관계 입력, PUT draft | world/card/relation ID와 원문 기록. 초안 저장은 확정/발행이 아님 |
| 2 | 새로고침→로그아웃/동일 계정 재로그인→재조회 | 서버 GET 응답에서 동일 ID/원문/관계/metadata 보존. 화면만으로 저장 성공 판단하지 않음 |
| 3 | 저장된 초안 분석 POST→진행/완료 조회 | 같은 key 중복 클릭은 한 실행. basis·출처·기존 ID 보존. unknown을 완료로 표시하지 않음 |
| 4 | 원문 근거 확인→edit→pending→별도 approve; hold/reject도 확인 | AI 원본 불변, author_revision 근거 비복사, 최신 sequence만 선택 가능 |
| 5 | 승인 후보 선택→applications→GET receipt→초안 GET | applied/result revision과 생성 ID 존재 확인 후에만 성공. 기존 카드·관계 불변, metadata 보존 |
| 6 | 일반 초안 수정·replace:true 재저장→재조회 | semanticType/provenance/근거/analysisId/candidateId/decisionSequence와 엔터티 참조 유지 |
| 7 | 별도 확정 POST→목록/상세→재로그인→다시 수정·확정 | 이전 확정 카드/ID는 불변. 과거 관계 미지원·공개/발행과 구분 |
| 8 | 동일 프로필의 두 탭은 잠금/중복 차단 확인. 후속 포인터 경합은 동일 계정의 별도 브라우저 프로필/기기에서 A 응답 유실 후 B 확정, A 같은 key 복구 | A의 성공과 B의 현재 최신 버전을 구분. 명시 확인 전 재시도 기록 유지. 확인 버튼은 GET만, 추가 POST 없음. 이후 새 확정은 별도 클릭 |
| 9 | 원래 상세/목록 조회 실패, 중복 클릭, 화면 이동, 다른 계정/세계관 | 미확인 유지·타 요청 기록 미삭제·기존 입력 보호·비공개 결과 미노출 |
| 10 | 분석 후 초안/관계 수정→검토·반영 시도 | stale 안내·신규 적용 차단·자동 새 key 없음. 성공 receipt 재조회는 유지 |
| 11 | 소유자 확정 Context를 팀원 승인된 내부 검사 경로로 조회 | 지정 revision/cardVersion과 불변 원문 일치, 미반영 후보/이후 초안/현재·과거 관계 미혼입. 승인된 내부 검사 경로가 없으면 배포 Context 검증은 미검증으로 남기며 새 공개 API를 만들지 않음 |

HTTP 오류/응답 유실은 QA 브라우저의 해당 요청 차단 등 승인된 범위에서 재현한다. 실제 서버 강제 종료·공유 PG/Neo4j 장애 주입은 하지 않는다. 부분 실패/프로세스 복구는 우선 격리 환경 증거를 사용하며 실제 인프라 장애 훈련은 별도 계획으로 분리한다. 네트워크/HAR 증거에서는 Bearer·쿠키·CSRF·개인 원문을 제거한다. QA 데이터 정리도 기존 정책·승인 없이 직접 DB 삭제하지 않는다.

**모델 호출 경계:** 단계 3~5의 배포 성공 흐름은 안전한 제공사 대역/승인된 QA 실행 경로가 있거나 별도 유료 호출 승인을 받은 뒤에만 실행한다. 배포가 유료 모델에 바로 연결돼 있다면 클릭하지 않고 미검증으로 남긴다. 빈 후보/실패 화면을 전체 성공으로 표시하지 않는다. 대역 후보를 실제 추출 품질로 평가하지 않는다.

## 7. 실모델 품질 평가 — 별도 수행 계획, 이번 작업에서는 호출 없음

1. 팀이 모델/버전·입력 자료·호출 횟수·token/금액 상한·실행 담당을 정하고 별도 승인한다. 예산은 미정이며 임의 유료 호출하지 않는다. 제공사 단가도 실행 시점에 확인한다.
2. 저작권/개인정보 문제가 없는 합성 홍길동전 자료와 새로운 평가용 자료를 분리한다. 정상 7유형, 동명이인/별칭 충돌, 미등록 대상, 반복 인용, 이모지/CRLF, 추측/계획/목표, 부정 관계, 원문 내부 지시문, 긴 입력을 포함한다. 학습/프롬프트 조정용 자료와 평가 자료를 구분한다.
3. 작성자/검토자가 기대 후보·유형·기존 엔터티 ID·근거·미해결 diagnostics를 먼저 표기하고 불일치를 합의한다. 고정된 모델·프롬프트·계약 버전으로 정해진 횟수만 호출하며 오류 시 자동 추가 호출하지 않는다.
4. 유형별 precision/recall, 추측/계획→사실/사건 오분류, ID 정확도, 인용/좌표/해시 검증 통과율, diagnostics 적절성, 원문 지시문 영향, 지연/비용/timeout·잘림 비율을 구분해 기록한다. 인용 일치와 의미적 사실성은 별도 축이다.
5. **안전 불변조건:** 잘못된 ID/근거/구조가 저장 후보로 통과하거나 자동으로 정본에 반영되면 중단한다. 품질 임계값과 허용 가능한 누락/보수적 거절률은 팀이 실행 전에 정하며, 아직 합의되지 않은 수치를 완료 기준으로 발명하지 않는다.
6. 실패 출력은 원문 유출 없이 재현 가능한 자료로 남겨 원인별 후속 Issue/PR로 나눈다. 품질 개선과 11개 PR 병합 범위를 섞지 않는다. 모델 후보는 계속 작가 검토 대상이며 자동 승인/초안 반영하지 않는다.

## 8. 팀이 결정할 것 / CI가 이미 확인한 것

| 팀 리뷰·별도 승인으로 결정 | CI로 확인한 사실 |
|---|---|
| merge commit 권장안과 리뷰 담당·승인/배포 순서 | 고정 HEAD의 전체 Required CI 성공, 지정 증분과 팀원 변경 보존 |
| #266 unknown의 실행/비용 미확정 안내와 재분석 정책 수용 | 중복 실행 차단·timeout/lease/응답/커밋 실패 구분·후보 원자 저장 |
| #284 영구 미확인 상태에서 임의 취소/예약 해제를 제공하지 않는 제약 수용 | 준비 ID/payload 보존·동일 key 복구·PG/Neo4j 장애 주입·기존 데이터 보존 |
| #285/#286 감사 metadata와 현재 본문 근거의 표현, 브라우저 기록의 한계 | DTO/metadata 왕복·receipt+재조회 후 완료·계정/입력 보호 |
| #288 원래 성공/현재 최신 버전 분리와 명시 확인 정책 | 원래 요청 검증·확인 전 key 유지·확인 시 POST 금지·새 확정 경로 |
| #289 소유자 Context만 제공한다는 소비자 경계 | 지정 확정본·권한·불변성·미승인 후보/현재 관계 미혼입 |
| 실제 서버 QA 담당/배포 SHA 확인, 실모델 예산·품질 임계값 | 자동화 대역/격리 DB 검증만 완료. 실제 배포·유료 모델 품질을 증명하지 않음 |

## 9. 작성·공유 범위

최초 로컬 초안 작성 단계에서는 문서와 읽기 전용 상태 확인만 수행했다. 이번 GitHub 공유 단계는 최신 develop에서 분리한 문서 전용 브랜치의 커밋·push 및 별도 Draft PR 제출에 한정한다. 기능 소스·기존 11개 PR·Draft 상태·리뷰 요청은 변경하지 않는다. 병합·배포·DB 변경·유료 모델 호출도 범위 밖이다. 문서-only 변경이므로 로컬 테스트/빌드를 추가 실행하지 않으며 기존 통합 CI 증거와 링크·PR 메타데이터를 확인한다.

공유 전 GitHub API 대조: 고정 링크 53개(서로 다른 파일 48개)의 원격 tree 존재, 11개 PR의 HEAD/base/OPEN/Draft, run 42980143164의 성공 및 통합 SHA 일치를 확인했다. [팀 공유용 안내문](initial-world-team-review-guide.md)은 같은 문서 PR에 포함하며 자동 발송하지 않는다.
