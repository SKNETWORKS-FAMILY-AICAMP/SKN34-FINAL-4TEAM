# 초기 세계관 전처리 4단계 — PostgreSQL 저장 구조

기준 develop `b723e8b`. 계약 의존성은 [PR #219](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/219)
HEAD `6c5ed7d8`이다. 확인 시점 #219는 OPEN, Required CI 성공, 사람 리뷰 없음,
CodeRabbit은 review-ready 라벨 조건으로 생략됐다. 승인 완료로 간주하지 않는다.
이 PR은 develop 기준이며 #219 계약 파일이나 #223 UI diff를 복사하지 않는다. 병합 순서는 계약 검토 후 #219 → 이 저장 구조 PR이다.

## 구현한 저장 범위

기존 Content DataSource, WorldStudio EntityManager/TransactionManager, `world_studio_schema_history`를 재사용한다.
기존 V1/V2를 수정하지 않고 `worldstudio/V3`만 추가한다. 다른 Content 도메인의 V번호와 별도 이력이다.
기존 카드·초안·확정본·Neo4j 데이터는 변경하지 않는다. 신규 공개 API, AI 호출, 큐/워커, 새 의존성 없음.

| 테이블 | 보관 내용 | 보호 |
|---|---|---|
| initial_analysis | Input 전체 JSON(원문·UTF-16 근거 출처·기존 ID), 기준 draft/graph/revision, 요청 hash/key, 실행 token/deadline, Output | world/key 유일, snapshot·기준·deadline 불변, terminal 상태 불변, JPA 낙관적 잠금 |
| initial_candidate | Content UUID ↔ localRef, AI 원본 Candidate JSON | analysis/localRef 유일, 같은 world/analysis FK, 수정/삭제 금지 |
| initial_decision | 후보별 sequence, actor, action/state, 그 시점 Candidate JSON | 순번 유일·소속 FK·수정/삭제 금지. edit→pending, author_revision, evidence=[] |
| initial_application | 요청 key/hash, 기준 revision/graph, replace:false 추가 payload, 상태/결과 revision | 요청 유일, world당 미완료 하나, payload 불변, terminal receipt 불변, 낙관적 잠금 |
| initial_application_item | 승인 decisionSequence, 새 card/relationship ID, 예약 active | 승인 상태 FK, 후보별 활성 예약 하나, 생성 ID 유일·불변, 실패 입증 후에만 예약 해제 |

JSONB는 공개 DTO가 아닌 내부 보관 형태다. 입력/출력의 키·텍스트 값과 배열 순서를 보존한다.
JSONB의 객체 직렬화 순서는 보장하지 않으므로 inputHash를 DB JSON 문자열로 재계산하지 않는다.
실행 API에서 #219의 정렬·UTF-8 해시 규칙을 사용한다. 원문 UTF-16 좌표는 변환/정규화하지 않는다.
목표·계획 등 의미 유형, subjectId/relatedEntityIds, 원본 evidence는 Candidate JSON 그대로 유지한다.
엔터티 ID 재사용·같은 세계관 활성 카드 여부·quoteHash·surrogate 경계의 완전한 검증은 후속 API의 신뢰 경계 책임이다.
이 migration의 JSON CHECK는 주요 구조·출처 오류 방지이며 #219 전체 JSON Schema 검증을 대체하지 않는다.

후보 원본과 작가 수정본은 별도 행이다. 수정 내용에 AI 원본 근거를 복사할 수 없고,
원본은 candidate_id를 통해 읽는다. approve는 해당 본문을 승인한 이력이며 초안 반영·세계관 확정이 아니다.
initial_application_item은 새 정보의 ID만 예약한다. 기존 인물/장소 ID를 생성 ID로 재사용하지 않는다.
관계 payload는 **해당 추가 요청의 감사/재시도 자료**이며 전체 관계 정본이나 과거 관계 복원본이 아니다.

## 후속 실행 연결의 필수 조건

현재 새 Repository를 호출하는 Controller/Service가 없다. 따라서 실행·인가·deadline 복구·정본 반영은 미구현이다.
저장 구조 테스트 성공을 AI 기능이나 실제 서버 저장 검증 성공으로 표시하지 않는다.

1. 분석 실행 PR: Content가 snapshot/해시 구성, 같은 world/key 중복 비교, running=202/Location,
   token/deadline CAS, 조회 시 만료 unknown 복구, Output/후보 원자적 저장을 연결한다.
   freshness는 현재 draft/graph와 비교해 계산하며 영구 current 플래그를 저장하지 않는다.
2. 검토·반영 PR: 소유자 검증, expectedDecisionSequence/최신 검토 비교, ID·근거·최신성 검증 후
   application+item을 한 트랜잭션에 준비한다. 같은 후보의 다른 key는 활성 예약 제약으로 막는다.
   이미 성공한 receipt 조회가 stale 검사보다 먼저다.
3. 반영 준비부터 일반 초안 쓰기도 같은 world 잠금/예약을 확인해야 한다.
   `WorldStudioService.edit()`의 replace:false 추가 저장을 재사용하되 **기존 edit 호출 뒤 별도 receipt 저장은 금지**한다.
   기존 마지막 PG tx의 카드·draftRevision·relationship_state 완료와 application 완료를 같은 tx로 연결해야 한다.
   이 연결과 쓰기 차단은 이번 저장 구조만으로 제공되지 않으며 반영 API 공개 전 필수다.
4. Neo4j 성공 후 PG 실패/응답 유실은 unknown으로 두고 payload/key/hash/생성 ID를 그대로 재사용한다.
   failed는 정본 미적용이 입증됐을 때만 기록한다. 그 후 예약 active=false를 허용해도 감사 행/생성 ID는 삭제하지 않는다.
   판단/장애 주입/동시 요청 테스트는 후속 반영 PR에서 수행한다.
5. UI PR: 검토 이력·관련 설정 그룹화와 metadata 왕복 보존. #223 디자인 PR과 무관하다.

## 검증

- 먼저 `InitialWorldDecisionTest`를 추가해 CI에서 클래스 부재로 Red 확인(run 42591407683).
- 로컬 선택 단위 명령은 Gradle loopback 연결 오류로 실행되지 않았다. 기본 Java 17이며 프로젝트는 21을 요구한다.
  로컬 전체 빌드·DB·컨테이너를 실행하지 않았다. Green 및 DB 검증은 PR의 최신 CI 결과로 기록한다.
- 순수 단위: 수정이 pending인지, 허위 AI 근거를 붙이지 않는지, 검토 상태/순번 오류 거부.
- CI PostgreSQL: V2→V3 업그레이드·원문 보존·재실행, world/analysis 소속, 원본/이력/payload 불변,
  key/후보 중복 예약, 잘못된 완료 revision, unknown 예약 유지, 실패 후 ID 보존.
- CI JPA: 기존 persistence unit validate, 5개 Repository 저장/조회, 재시작 후 원문·ID·상태 보존 및 version 증가.
- 배포 DB migration, 실제 AI, Neo4j↔PG 반영 장애 복구, 브라우저는 이번 PR 미검증/미구현이다.

#122 회차 추출, Fork 시점 복원, 확정 UI, 집필 AI Context 연결은 완료 처리하지 않는다.

## 2026-11-09 후속 계약 점검

#219의 다중 검토 순번·출처 식별·edit provenance 보완을 대조했다. [5단계 준비](initial-world-extraction-readiness.md)에 실행 순서와 검토 API 이전 저장 보완(key/hash/comment)을 기록했다. 이 저장 구조만으로 실행/검토 API 완료를 뜻하지 않는다.
