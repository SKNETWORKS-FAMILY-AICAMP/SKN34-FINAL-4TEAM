# 초기 세계관 승인 후보 반영 6-B — PR #284

## 의존성과 범위

#270 HEAD `0192047b1b91e6f70e2cb5c397d00ba6da67cd0b` 기준 별도 Draft다. #219 → #225, #235, #262, #266, #270은 미병합 선행 의존성이다. 본 PR은 6-B 준비와 실제 저장·복구를 함께 포함한다. 선행 PR의 팀 리뷰/병합 후 develop 기준 diff·CI를 다시 확인해야 한다. 어떤 PR도 자동 병합하지 않는다.

기존 initial_application/initial_application_item을 그대로 재사용한다. 새 migration·DB·큐·워커가 없다. WorldStudioService.edit()의 기존 단계와 Neo4j 현재 상태 CAS를 유지한다. 관계 이력·회차별 버전·Fork·확정 버전·UI·모델 호출은 범위 밖이다.

## API

- `POST /api/v1/world-studios/{worldId}/analyses/{analysisId}/applications`: #219 ApplicationRequest → ApplicationResponse.
- `GET .../applications/{applicationId}`: 동일 Response receipt 조회. 조회만으로 저장을 재실행하지 않는다.
- applied는 200, applying 조회는 202, unknown POST는 503(GET은 200 상태 조회). Location과 no-store를 제공한다. resultDraftRevision은 applied에만 값이 있다.
- createdCardIds/createdRelationshipIds는 준비 시 고정된 ID다. applying/unknown에서는 예약 ID이며 실제 적용 완료를 의미하지 않는다. applied와 resultDraftRevision을 함께 확인한다.
- 기존 소유권 정책에 따라 타인/타 세계관/다른 분석 후보는 404. 같은 key 다른 요청, 최신 승인 순번 불일치, 중복 예약은 409. 신규 stale는 409 ANALYSIS_STALE와 재분석 안내다. 잘못된 내용은 예약 전 422로 거부한다.

## 준비와 원본 보호

world/key의 기존 receipt를 stale 검사보다 먼저 확인한다. 성공 receipt는 현재 초안이 더 진행돼도 같은 결과다. hash는 world/analysis/전체 요청(선택 후보는 UUID 순 정렬)을 JSON으로 직렬화한 SHA-256이다. 순서만 바꾼 동일 선택은 같은 요청이다.

신규 요청만 저장 초안과 Neo4j 현재 상태를 읽는다. 네트워크는 PG 밖이다. world 잠금 안에서 snapshot·draftRevision·relationshipVersion·currentRevisionId, completed 분석, 후보 소속, 최신 approved decisionSequence, 후보 active 예약을 검증한다. author_revision은 AI 근거 없는 작가 내용으로 검증한다. 배치의 모든 후보를 검증한 다음 하나의 PG 준비 transaction에서 application + 추가 payload + 생성 UUID + item 예약을 기록한다.

- 기존 인물·장소·조직 ID와 카드 원문/별칭/태그를 재전송하거나 수정하지 않는다.
- fact/conjecture/goal/plan은 other, rule은 rule, event는 event 카드로 추가한다. 기본 private. 정확한 의미 유형·조건·시간·극성·근거·검토 출처는 preprocessing metadata로 보존한다.
- studio.item.subjectId/relatedIds로 기존 엔터티를 참조한다. 엔터티 복사/새 정본 엔터티 생성은 없다.
- relation은 새 UUID에 기존 양 끝 ID, category/direction/polarity/label/text를 매핑한다. 같은 끝점/유형/방향/명칭/극성의 중복 관계는 거부한다. symmetric 끝점 순서는 정규화한다.
- replace:false와 예약된 `initial-application:{applicationId}` 저장 key를 고정한다. 이름/설명은 준비 당시 값을 보존한다.
- 생성 ID, 카드/관계 개수, 기존 DTO 길이 제한도 예약 전에 검증한다.

## 저장·원자적 완료·경합

준비 뒤 기존 edit 경로로 부분 추가한다. application 진행 중인 세계관은 일반 edit의 초기/준비/완료 경계와 신규 확정 저장에서 차단한다. 같은 저장 key/payload를 일반 edit에 보내도 우회할 수 없다. 예약된 후보의 신규 검토 변경도 차단하며 기존 결정 재전송은 그대로 반환한다.

Neo4j repository는 기존 전체 현재 상태 CAS 구현을 재사용한다. 기존 관계 payload/ID를 합친 결과를 저장하므로 논리적으로 기존 관계를 삭제·변경하지 않는다. 과거 그래프를 복제하거나 이력 저장소를 만들지 않는다.

최종 PG transaction에서 **새 카드 초안만 추가 + draftRevision 증가 + relationship_state 완료/graphVersion + application applied/resultDraftRevision**을 함께 확정한다. 기존 카드 행의 원문/metadata/updatedAt은 application 경로에서 갱신하지 않는다. edit 반환 뒤 별도 transaction으로 applied를 기록하지 않는다. 확정 버전/currentRevisionId도 바꾸지 않는다.

동시 같은 key는 동일 예약을 재사용하고 Neo4j key/hash/CAS 및 world 잠금으로 같은 결과에 수렴한다. 다른 application은 세계관당 미완료 application UNIQUE와 world 잠금으로 차단한다. 일반 편집이 먼저 준비했다면 application은 관계 미완료 상태를 통과하지 못한다. application 준비가 먼저라면 일반 편집의 준비 단계가 차단된다.

## 장애 복구

| 위치 | 보존/재시도 |
|---|---|
| 준비 commit 전 실패 | transaction 롤백, 그래프 변경 없음. 동일 요청 재전송 가능 |
| 준비 commit 후 그래프 호출 전 실패 | UUID/payload/key/item 유지. unknown이며 같은 요청만 재개 |
| Neo4j commit 후 응답 유실 | PG pending과 예약 유지. 같은 key/hash로 이미 적용된 현재 그래프를 인식 |
| Neo4j 성공 후 PG finalize 실패 | 카드 초안/revision/관계 완료/receipt 모두 PG 롤백. 그래프 성공을 롤백했다고 가정하지 않음. 동일 요청으로 PG finalize 재개 |
| PG finalize commit 후 응답 유실 | applied receipt를 다시 확인해 성공 반환. 새 UUID/새 key/새 관계 생성 없음 |
| 복구 확인도 DB 오류 | 기존 503 저장 결과 미확인. 클라이언트는 입력과 key를 보존해 재조회/재전송 |

이 단계는 안전을 위해 준비 후 오류를 보수적으로 unknown으로 유지한다. 명백한 Neo4j 거절도 예약을 자동 해제하지 않으며 동일 요청 재시도만 지원한다. failed 전환/예약 해제 관리 API는 구현하지 않는다. 영구 장애를 새 key로 우회하거나 성공으로 숨기지 않는다. GET만으로 서버 중단 지점을 추측하지 않으며 applying/unknown 준비 기록은 POST 동일 요청으로 복구한다.

한 번 반영되어 draftRevision이 증가하면 같은 분석의 남은 후보는 stale이다. 자동 연속 적용하지 않고 재분석한다. 승인/수정 이력과 최초 AI 후보는 유지한다.

## 검증과 한계

TDD 매핑/공유 Fixture 단위 검사, 격리 PostgreSQL+실제 Neo4j 통합에서 8개 후보(6개 의미 카드+구조/방향 감정), 원문/확정 버전 보존, 부분 반영 후 stale, 미승인/이전 순번/소유권 차단을 검사한다. 실제 Neo4j 호출 직전/커밋 직후 예외와 PG 완료 trigger 실패·commit acknowledgment 실패를 주입한다. context 재시작 후 예약/receipt 보존, 동시 동일 요청, pending 일반 저장/검토 차단도 검사한다. 이는 실제 네트워크 장비 단절이나 OS 강제 종료 시험과는 구분한다.

HTTP 시스템은 실제 Core 로그인 → 검토 → 별도 application → 초안 재조회와 receipt 재전송을 격리 CI에서 검증한다. AI 완료 후보는 해당 CI DB fixture로 준비하며 유료 모델/개발 DB/기존 사용자 데이터는 접근하지 않는다.

작가 UI와 프런트 metadata 왕복은 미구현·미검증이다. 기존 UI가 새 semanticMetadata를 보존하는지는 별도 UI 연결 PR에서 검증해야 한다. 관계 이력과 과거 시점 복원은 팀 후속 범위이며 이번 성공은 현재 초안 반영까지만 의미한다.
