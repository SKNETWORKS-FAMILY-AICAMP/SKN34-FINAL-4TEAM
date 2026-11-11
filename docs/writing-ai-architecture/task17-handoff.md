# TASK 17 — Content 불변 제안·결정·적용 영수증

> **2026-11-11 현행:** 실제 연결 여부와 남은 선행 조건은 최신 표를 따른다. [실연동 인수보고](live-rag-handoff.md) 참조. 아래 TASK별 결과는 당시 기록이다.

2026-11-10. **로컬 선택 단위 확인. HTTP·실제 PG 원자성/경합 수용은 CI 대기**다.
운영 DB 적용이나 실제 AI 결과·제품 흐름 연결 완료를 뜻하지 않는다.

## 시작 상태와 범위

시작 브랜치 `feat/58-simulation-development`, HEAD `eba811290b8125b884ec1bcaa6358fb883e279ef`, dirty 없음.
로컬 `develop=79855bfc6ac180dbd87109f340b0471e78c30e3e`를 확인했으며 fetch·재기반·강제 checkout은 하지 않았다.
같은 HEAD에서 `feat/60-immutable-proposals`를 만들었다. 기존 스택 #220→#230→#241→#244→#245 위의 로컬 작업이다.
사용자 후속 요청으로 선행 두 결함부터 수정했고, TASK 18 이후는 시작하지 않는다.

수행: 선행 AI 결과 상태 보완, Content의 불변 제안 판·결정·영수증·실패 키 기록,
기존 PG 원고 writer 재사용, 선택 단위, CI용 HTTP/PG/Flyway 회귀 소스, 설계·기능표 보완.
미수행: 실제 모델/사용자 원고 전송·DB migration 실행·Neo4j/외부 저장소 쓰기·인덱스·Writing·자동 resume·UI·push·PR·병합·배포.

## 선행 두 결함

`review.py`·`semantic_review.py`는 공백 원문 또는 공백 설정 기준의 `insufficient_evidence`를 `partial/unverified`로 보존한다.
권한 거부와 혼동하지 않으며 모델과 확정 수정 후속을 호출하지 않는다.
`DevelopmentHandler`는 Simulation opt-in 누락 또는 예산 0에서 함수의 `blocked` BeatPlan을 보존하고
실행기에는 partial 참조를 반환한다. 승인된 Simulation 의존성이 등록됐을 때는 기존 handler/입력 검증을 유지한다.
신규 7개 경계의 Red 후 기존 영향 범위가 **433 passed, 21 deselected in 10.93s**였다.
로컬 커밋 `bf5edc6 fix: 근거 부족과 시뮬레이션 미동의 결과 보존` (Refs #59, #61).

## Content DTO와 서버 경계

`proposal/service/dto/ChangeSet.kt`가 고정 schemaVersion=1의 DTO다.
`ChangeSet`에는 proposalId/version, runId/workId/forkId, 작품 baseVersion, affectedDocuments,
순서 있는 operations, evidence, isMock, idempotencyKey가 들어간다. hash·가변 status·시각은 manifest 밖이다.
서버가 ID·새 판 번호·대상 목록·허용 필드를 만들고 저장 JSON의 SHA-256을 반환한다.
상태는 pending/approved/rejected/revision_requested/cancelled이며 미결정 구판은 superseded로 보인다.
V7의 ai_job running/completed/failed 및 기존 ai_run CHECK는 변경하지 않았다.

`ChangeOperation`은 op, target(type/id/episode/baseVersion/beforeHash), UTF-16 span, content,
명시적 ChangeField 목록, evidenceRefs다. 대상 ID는 기존 `episodeId(work,number)`와 같아야 한다.
원고 전체 beforeHash는 `SHA256(제목 UTF-16 길이 + ':' + 제목 + 본문)`이다. 근거 sourceHash는 선택 원문의 UTF-8 SHA-256이다.
surrogate 중간 구간·잘못된 Unicode·중복 대상/필드·기준 판/hash·미승인 target·발행/권한 필드 변경은 거부한다.
`approvalFields=[title,body]`는 서버가 허용한 쓰기 필드 목록이며 결정 요청은 proposalVersion/proposalHash/decision만 받는다.

지원 writer는 같은 contentTransactionManager의 **PG 원고만**이다. 한 제안은 최대 20개 문서, 문서당 한 연산,
create는 최대 한 개의 다음 새 회차다. `create`는 next_draft/expand_conti run에서 Content가 계산한 다음 번호·안정 ID와
"아직 없음"을 고정하고 승인 때 다시 확인한다. `replace_span`은 원고의 한 UTF-16 구간,
`update_fields`는 title/body만 바꾼다. 범위를 바꾸려면 새 불변 판을 준비하고 다시 승인한다.
다른 target type, 특히 PG+Neo4j 혼합은 첫 쓰기 전에 `unsupported_atomic_scope`로 거부한다.
설정·콘티·플롯은 기존 서비스가 있더라도 승인 writer 연결을 추가하지 않았다.

준비 seam은 Content 내부 `ChangeProposalService.prepare(work,actor,key,PrepareChangeSetRequest)`다.
실제 AI 결과 조립·공개 준비 endpoint가 없으므로 외부 호출자가 Mock 결과를 real로 바꿔 접수할 수 없다.
run/thread의 회원·작품/Fork·작품 revision·현재 Context scopeHash를 확인하고, Content가 저장한 targetRefs에 속한
현재 draft 또는 허용된 발행 원문 발췌의 revision/span/hash를 다시 읽는다. character 문맥에 draft를 넘기지 않는다.
검색 시스템의 임의 Evidence나 미선택 원문은 받지 않는다. Mock 표시는 보존하며 Mock 근거가 하나라도 있으면 승인을 거부한다.

## 멱등·불변 판·결정과 rollback

기존 WorkAccessService.own의 작품 및 Fork source row lock을 재사용해 같은 작품의 준비·결정을 직렬화한다.
버전은 change_proposal_version에 추가만 하고 DB trigger가 UPDATE/DELETE를 금지한다.
준비 키의 범위는 run+keyHash다. 같은 key/payload는 같은 판, 다른 payload는 409다.
pending 또는 revision_requested 판에서 같은 run의 새 판을 만들 수 있고 구판 승인은 409다.
부분 선택·다른 목적/대상으로 범위를 넓히는 공개 API는 없다.

결정 키는 work+actor+keyHash에 requestHash를 **원고 transaction 전에** 고정한다.
준비된 pending 시도는 중단 후 같은 키로 재개할 수 있다. 같은 키의 다른 payload는 409다.
결정 전 모든 원고의 revision·전체 hash·증거·문맥·상속 여부·이미지 참조를 검증한 뒤 기존 EpisodeVersionService.save를 사용한다.
모든 대상 저장·결과 버전 대조·결정/영수증·시도 성공 상태는 한 Content PG transaction이다.
새 회차도 기존 EpisodeService.create를 같은 transaction에서 사용하며 발행하지 않는다.
각 저장 결과의 revision·title/body·version 수를 대조해 대상별 결과 버전을 기록한다.

`ChangeReceipt`는 decisionId, proposal/version/hash, actorRef, decision, applicationId, outcome,
각 대상 before/after revision·versionId, committedAt을 담는다. approved 결정의 외부 outcome은 applied다.
committedAt은 transaction 내부에서 지정한 기록 시각이며 응답은 commit 성공 후 반환한다.
거절·수정 요청·취소는 원고/버전을 쓰지 않는다. 같은 판의 최종 결정 unique와 불변 receipt trigger가 이중 결정을 막는다.
다른 키의 같은 판 결정은 409이며 같은 키 재전송은 현재 소유권을 확인한 뒤 원 영수증을 반환한다.

검증/저장 실패는 원고 transaction을 rollback하고 별도 change_decision_attempt에 안전한 HTTP 상태·사유만 남긴다.
내부 예외 상세를 반환하거나 성공으로 숨기지 않는다. 같은 실패 키는 같은 실패를 반환하고 다른 결정에 재사용할 수 없다.
실패 처리 중 같은 키의 성공 영수증이 먼저 commit되었다면 그 영수증으로 수렴한다.
이미 최종 실패한 시도의 재시도는 현재 판을 재검토하고 새 키를 사용한다. 최종 실패 영수증은 만들지 않는다.

## API와 Flyway

| 경로 | 동작 |
|---|---|
| GET `/api/v1/works/{id}/change-proposals/{pid}?version=N` | 현재 판 또는 보존 판의 전체 변경 조회 |
| POST `.../{pid}/decisions` | Bearer·기존 CSRF·Idempotency-Key와 고정 판/해시/결정 |
| GET `.../{pid}/versions/{version}/receipt` | 현재 소유권 확인 후 commit된 결정 조회 |

기존 `/proposals/{pid}/accept`의 경로·응답·중복 409·버전/결정/적용 이력은 바꾸지 않았다.
신규 Flyway는 다음 미사용 **V18__immutable_change_proposal.sql**이며 기존 proposal leaf와 content_schema_history를 사용한다.
세 업무 테이블과 판/키/결정 unique·FK·불변 trigger만 추가한다. 기존 SQL·Saver schema는 변경하지 않는다.
실제 DB migration/DDL은 실행하지 않았다.

## 검증

AI 서비스에서 실행한 선행 회귀 명령:

```powershell
uv run --offline --locked --extra dev python -m pytest -m 'not integration' tests/test_development.py tests/test_semantic_review.py tests/test_simulation.py tests/test_story_context.py tests/test_mechanical_review.py tests/test_template_recommendation.py tests/test_task_graph.py tests/test_task_runner.py tests/test_main_graph.py tests/test_retrieval_coordinator.py tests/test_mock_retrievers.py tests/test_retrieval_contract.py tests/test_canonical_read.py --tb=short
```

결과 **433 passed, 21 deselected in 10.93s**. 신규 7건이 기존 구현에서 실패한 뒤 최소 구현으로 통과했다.
샌드박스 uv 캐시 제약 때문에 명령 단위 host 실행으로 offline/locked를 유지했다. 실 모델/DB 호출은 없다.

Content 서비스에서 실행한 선택 단위:

```powershell
./gradlew.bat unitTest --tests 'ai.storyfork.content.proposal.ChangeProposalServiceTest' --tests 'ai.storyfork.content.proposal.ProposalServiceTest' --tests 'ai.storyfork.content.proposal.AiRunServiceTest' --tests 'ai.storyfork.content.proposal.AiRunGrantServiceTest' --tests 'ai.storyfork.content.regression.ContentServiceTest' --tests 'ai.storyfork.content.episode.EpisodeMutationPolicyTest' --tests 'ai.storyfork.content.episode.ContentBoundaryTest' --no-daemon --offline
```

결과 **39 tests, 0 failures/errors/skipped**, BUILD SUCCESSFUL in 47s. 신규 ChangeProposal 12개·기존 accept 회귀 1개 포함.
신규 DTO/서비스 부재의 컴파일 Red, 실패 키 재사용의 assertion Red를 각각 확인했다.
초기 실행은 Gradle 캐시 권한과 JDK 21 부재로 중단됐다. 공식 Temurin 21.0.13+9를 작업 전용 TEMP에 받고 공식 SHA-256을
검증한 뒤 해당 프로세스의 JAVA_HOME만 지정했다. 전역 Java·저장소 의존성·lockfile은 변경하지 않았다.
Mockito non-null matcher와 테스트 DTO 기본값 오류는 테스트 설정에서 수정했다. 기존 Jackson asText deprecation 경고는 남아 있다.
기존 ContentBoundaryTest의 V1~V17 고정 기대값에서 1 failed/5 passed를 확인하고 V18로 갱신했다.
마이그레이션 재생/검증 실패 뒤 보존 개수의 CI 기대값도 18로 맞췄다. 기존 SQL은 바꾸지 않았다.

ChangeProposalPostgresTest의 동시 승인/취소/거절·동시 수동 편집·두 번째 PG 대상 실패 전체 rollback,
ChangeProposalHttpIntegrationTest의 Bearer/CSRF·DTO/상태 매핑, ContentMigrationTest의 V18·불변/unique 검사는
**소스 작성·컴파일만 확인**했다. 로컬 실행 금지 지침에 따라 CI에 남겼으며 실제 통과를 주장하지 않는다.
단위의 rollback manager 호출 확인은 실제 PostgreSQL rollback 증거가 아니다.

CodeRabbit `review --agent --uncommitted --include-untracked`는 TASK 17 코드·테스트 16개 파일을 검토하고
`review_completed`, **findings=0**으로 종료했다. 인증된 공식 사용자 설치 CLI를 사용했고 실제 비밀·사용자 원고가 없는 범위를
확인했다. 이후 문서 및 V18의 잔여 기대 개수 보완은 로컬에서 확인한다. 무료 OSS 검토이며 PR 게시나 push는 없다.
저장소 ponytail-review로 별도 점검했으며 추가 인터페이스·범용 writer·분산 transaction·의존성 없이 기존 잠금/저장 재사용을 확인했다.

## 설계·이슈·영향·종료

참조: [01 현행 Proposal/EpisodeVersion](01-current-system-analysis.md), [04 §15 제안·영수증](04-infrastructure-integration.md),
[05 고정 제안/HITL 실패 수용](05-implementation-roadmap.md), [06 결정 12·14·15](06-design-decisions.md),
[서비스 경계](../design/service-boundaries.md), DEC-36·37·41, 이관 계약·유스케이스·Content/AI 지침.
2026-11-10 현재 [#60](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60),
[#54](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54)는 open·kyo-135다.
[#157](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/157)은 closed/completed·yerin816이므로 새 작업으로 연결하지 않는다.
구형 이슈의 Core 정본 문구보다 최신 DEC-41의 Content 경계를 따른다. 이슈 변경·자동 종료는 하지 않는다.

새 production 의존성·외부 서비스·유료 모델 호출·실 사용자 원고 전송·실 DB 쓰기는 없다.
단위의 isMock=false 자료는 합성 Content 대역의 정본 계약을 검증하기 위한 것이며 실제 창작 결과가 아니다.
작품 행 단위 직렬화는 기존 잠금 정책을 재사용한다. 대량 문서·운영 처리량·실제 모델 품질은 평가하지 않았다.
추천: 현재 내부 준비 seam과 PG 원고 범위 유지 후 CI를 확인한다. 설정/플롯 writer와 실 Agent 연결은 별도 계약·새 단계가 대안이다.
실제 CI·HTTP·PG 동시성/rollback 증거가 확인되기 전 제품 행은 ❌를 유지한다.

TASK 17 로컬 커밋: `5471bbe feat: Content 불변 제안과 멱등 적용 영수증 구현` (Refs #60, #54).
push·PR 생성/변경·병합·배포는 하지 않았다.
후속 TASK 18은 같은 날 사용자 새 요청과 해당 문서를 받은 뒤 별도 `feat/62-writing-editing`에서 시작했다.
