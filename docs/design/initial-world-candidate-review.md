# 초기 세계관 후보 검토 6-A — PR #270

## 기준과 범위

#266의 검증 HEAD `3c3772924bf18c50e27e5020a723c223ac5332ee`를 base로 사용한다. #219 → #225, #235, #262, #266은 Draft·미병합 의존성이다. 이 PR의 소유 변경은 Content 검토 API·이력 조회·V5 additive migration·검증뿐이다. 선행 PR 병합 후 develop 기준 증분 diff/CI를 다시 확인해야 한다. 임의 병합이나 개발 DB 수정은 하지 않는다.

## API와 전이

`POST /api/v1/world-studios/{worldId}/analyses/{analysisId}/candidates/{candidateId}/decisions`

#219 DecisionRequest `{key, expectedDecisionSequence, action, editedCandidate, comment}` → DecisionRecord `{candidateId, candidateRef, sequence, state, content}`, 성공 200. 기존 AnalysisResponse.decisions에 모든 이력을 반환한다. 새 응답 필드는 없다. comment는 PostgreSQL 감사 기록에 보존하며 현재 #219 DecisionRecord에는 없으므로 반환하지 않는다.

- 최초 후보: sequence=0/pending. AI output/candidate는 불변이다.
- edit: 기존 localRef를 유지하는 author_revision, evidence=[]만 허용하고 pending으로 저장한다. AI 근거를 수정본 근거로 복사하거나 조용히 제거해 허위 입력을 받아들이지 않고 422로 거부한다.
- approve/hold/reject: editedCandidate=null이며 가장 최근 검토의 content(없으면 최초 AI 후보)를 각각 approved/held/rejected로 누적한다. edit는 별도 approve가 필요하다.
- 모든 후보 공통 유형·기존 ID·관계 방향/종류/끝점·goal/plan 주체·문자열 검증을 5-C와 공유한다. AI 응답 경로는 계속 ai_extraction만 허용한다.
- 최신 상태는 후보별 최대 sequence다. 이전 승인 이후 수정/보류/거절이 있으면 과거 승인을 최신 승인으로 사용하지 않는다. 원래 AI 근거는 output 및 과거 이력에 그대로 남는다.

## 소유권·멱등성·저장

인증된 Principal → 기존 Content world 소유자 확인 → analysis/candidate 소속 확인 순서다. 타인·타 세계관·다른 분석 후보는 기존 404다.

기존 world 행 잠금과 worldStudioTransactionManager에서 검토 전체를 처리한다. `(candidate_id, request_key)`가 멱등성 범위이며 DTO 전체(key/expected sequence/action/edit/comment)의 JSON UTF-8 SHA-256을 저장한다. 같은 key/내용이면 이전 기록을 먼저 반환한다. 최신 순번/초안이 바뀌어도 재전송은 새 검토가 아니므로 기존 결과를 반환한다. 같은 key의 다른 내용은 409다. 요청 JSON의 속성 순서·UUID 표기 등은 DTO로 정규화한다.

신규 요청은 completed 분석만 허용한다(409 ANALYSIS_NOT_COMPLETED). draftRevision/relationshipVersion/currentRevisionId 변경 또는 관계 저장 미완료이면 409 ANALYSIS_STALE와 재분석 안내를 반환한다. expectedDecisionSequence는 최신 순번과 일치해야 하며 그렇지 않으면 409다. 소유자 잠금으로 동일/다른 키의 동시 검토를 직렬화하고 기존 `(candidate_id,sequence)` UNIQUE와 새 key UNIQUE가 DB에서도 보호한다.

한 트랜잭션에서 한 이력만 추가한다. DB 오류는 기존 503 WORLD_WRITE_UNCONFIRMED이며 동일 요청을 재전송한다. 커밋 성공 뒤 응답이 유실되었어도 기존 key/hash 기록을 반환하므로 순번을 다시 증가시키지 않는다. 모델 호출이나 Neo4j 쓰기는 없다.

V1~V4를 변경하지 않는다. V5는 nullable request_key/request_hash/comment와 조합 제약·후보별 key UNIQUE를 추가한다. 과거 이력의 요청 정보는 알 수 없으므로 null로 보존하고 임의 생성하지 않는다. 새 API는 세 값을 모두 기록한다. 기존 변경/삭제 금지 트리거와 모든 원본·정본은 유지한다.

## 검증과 6-B 경계

공유 Fixture DTO 왕복·검토 전이·잘못된 근거/ID의 단위 테스트, PostgreSQL/JPA 동시 검토·동일 키·커밋 실패/응답 유실·소유권·stale·원본/관계 불변·context 재시작 후 재조회, V4 이력 보존 migration, 실제 Core 로그인/재로그인과 Content HTTP 시스템 검증을 수행한다. 통합 검증은 CI의 폐기 가능한 DB만 사용한다. 시스템 테스트의 완료 AI 결과는 해당 CI DB에 준비하며 유료 모델을 호출하지 않는다. context 재시작 검증은 OS 프로세스 강제 종료 검증과 구분한다.

6-B는 최신 approved decisionSequence를 다시 확인하고 stale/예약/멱등성 계약을 적용해 초안에 부분 추가해야 한다. 이번 PR은 initial_application, 초안/확정본, 정본 카드/Neo4j, UI, 모델 호출, Fork/MCP를 구현하거나 변경하지 않는다. 승인=검토 기록이며 적용=별도 작업이다.
