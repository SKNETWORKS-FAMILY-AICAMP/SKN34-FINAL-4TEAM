# 초기 세계관 분석 실행·저장 5-C

## 의존성과 PR 범위

PR #266의 base `feat/initial-world-5c-dependencies`는 develop `0767bb57` + #219 `6c5ed7d8` + #225 `3bf93015` + #235 `0f5d4efd` + #262 `90568cfd`를 고정 통합한 `8d1663c0`이다. 기존 PR 병합이 아니며 각 원본 PR은 Draft 상태를 유지한다. base는 검증 전용이고 단독 병합 대상이 아니다. 선행 PR을 순서대로 develop에 반영한 후 #266의 base를 develop으로 변경하고 증분 diff/마이그레이션/CI를 다시 확인한다. 선행 PR이 squash/rebase되면 5-C 소유 커밋만 새 기준에 이식하여 같은 PR의 범위를 재검증한다. 강제 push나 자동 병합은 하지 않는다.

5-C 소유 변경은 Content 분석 서비스·AI HTTP client·controller·Output 재검증, 추가 V4 migration과 회귀 테스트다. V1~V3 SQL은 수정하지 않는다. 기존 분석/후보 JPA와 worldStudioTransactionManager 및 현재 Neo4j 조회를 재사용한다. 새 DB·큐·워커는 없다. 5-B 제공사·UI·승인·초안 반영은 변경하지 않는다.

## API

소유권은 기존 Core 인증 Principal과 Content world 소유자로 확인한다. 다른 소유자/세계관의 분석 ID는 404다.

- `POST /api/v1/world-studios/{worldId}/analyses`: #219 AnalysisRequest `{key, expectedDraftRevision}`. 최초 요청만 동기 실행한다. 완료 200, 같은 키 실행 중 202 + Location/Retry-After, 키 내용 충돌 409. failed는 502, unknown은 503으로 AnalysisResponse를 반환한다.
- `GET .../analyses`: 소유 분석의 AnalysisResponse 배열.
- `GET .../analyses/{analysisId}`: #219 AnalysisResponse. running은 202, 나머지는 200이며 실행 상태가 성공 여부를 나타낸다. Location을 제공한다.
- `GET .../analyses/{analysisId}/candidates`: `{candidateId, content}` 배열. 완료 전/실패는 빈 배열이며 상세 실행 상태와 함께 사용한다.
- #219 JSON 봉투의 필드는 변경하지 않는다. 상세/POST의 `X-Analysis-Failure-Code` 헤더로 저장된 실패 사유를 전달한다. 검토는 이번 범위 밖이므로 decisions는 빈 배열이다.

## 트랜잭션과 멱등성

1. 소유 world 행 잠금 안에서 world/key를 먼저 조회한다. 요청 hash는 worldId + expectedDraftRevision의 UTF-8 SHA-256이다. key는 유일 키의 일부다. 같은 요청이면 현재 원문을 다시 읽어 기존 입력을 교체하지 않는다.
2. 신규 요청만 #235 입력을 구성한다. world 잠금 안에서 재검증하고 같은 key의 경합 승자를 다시 확인한 뒤 Input 전체·analysisId·basis·실행 token·deadline을 V3 저장소에 기록한다. 준비 commit이 확인되기 전에는 AI를 호출하지 않는다.
3. 트랜잭션과 잠금을 종료한 후 #262 내부 API를 동기 호출한다. 기존 AI 주소/내부 토큰/HTTP helper를 사용하며 read timeout은 75초다. AI의 60초 timeout보다 길고 분석 전체 lease 90초보다 짧다. 서버 내부 자동 재호출은 없다.
4. Content가 strict DTO·7유형·기존 엔터티 ID·관계·localRef·근거 UTF-16 범위/원문/해시를 저장된 Input과 대조한다. AI Output은 analysisId/basis echo가 없는 #219 계약이므로 호출 Input과 저장 행의 worldId/analysisId/basis 및 소유 token으로 결합한다. 제공사가 새로운 binding 필드를 추가하면 거부한다.
5. world 잠금 안에서 running/token/deadline과 저장 snapshot을 재확인한다. 후보마다 Content UUID를 생성하고 candidates 및 completed/output을 같은 PG 트랜잭션에 저장한다. 하나라도 실패하면 후보 전체가 롤백된다.
6. 초안/관계/currentRevisionId가 바뀌면 결과를 지우지 않고 freshness=stale로 조회한다. 관계 쓰기 미완료도 stale이다. 이 기능은 세계관 초안·확정본·Neo4j를 수정하지 않는다.

## 실패·복구

- `AI_OUTPUT_INVALID`, `AI_REQUEST_REJECTED`, `AI_NOT_CONFIGURED`: failed. 후보 없음.
- `AI_TIMEOUT`: upstream/client timeout, unknown. 실행/비용 여부를 확정할 수 없으며 재호출하지 않는다.
- `AI_RESPONSE_UNCONFIRMED`: 연결/응답 유실 또는 확인할 수 없는 upstream 오류, unknown. 503을 받았다는 사실만으로 모델 미실행을 단정하지 않는다.
- `RUN_LEASE_EXPIRED`: GET/POST/list 재조회 시 deadline을 지난 running을 world 잠금과 JPA version으로 unknown 처리한다. 프로세스 중단과 기록되지 않은 응답 유실의 실제 원인을 사후 확정했다고 주장하지 않는다. 관측 가능한 lease 만료와 명시적 timeout은 구분한다.
- `RESULT_COMMIT_UNCONFIRMED`: 결과 저장 오류 후 별도 트랜잭션으로 상태 확인. DB에 completed가 이미 있으면 이를 우선 반환한다. 그렇지 않으면 unknown이며 결과를 재생성하지 않는다.
- 복구 조회/기록도 DB 오류면 503 `ANALYSIS_STORAGE_UNCONFIRMED`와 Location을 반환한다. 동일 key 조회로 확인하며 새 key를 자동 생성하지 않는다. 준비 commit 응답 유실이면 기록이 존재하더라도 원 호출은 재개되지 않고 만료 후 unknown이 될 수 있다.
- 클라이언트가 완료 HTTP 응답을 잃어도 동일 world/key는 영속된 candidate UUID와 같은 결과를 반환한다. failed/unknown도 같은 키로 재실행하지 않는다. 작가가 명시적으로 보낸 새 key만 신규 분석이다.

실패 사유는 V4의 nullable failure_code에 보존한다. 기존 V3 기록은 null로 유지하며 completed/failed/unknown의 불변 정책을 변경하지 않는다. 다른 저장/관계 전이는 기존 계약 그대로다. 분산 원자성이나 한 번만 과금됨을 보장하지 않는다.

## 검증 범위

순수 Output 테스트는 #219 홍길동전 Fixture를 사용한다. PostgreSQL/Neo4j 및 loopback AI 대역 회귀는 CI에서만 실행한다. 실제 인증→Content→키 없는 AI→PG→재조회 HTTP 시스템 회귀도 포함한다. OpenAI 유료 호출·실제 모델 품질·개발 DB 변경·브라우저는 실행하지 않는다. 로컬 JVM 환경 제한이 있어 hosted CI에서 Red/Green을 확인한다.

작가 승인/수정/보류/거절, 승인 후보의 초안 반영, 확정 버전, 관계 이력·Fork·MCP는 후속 범위다. #225/#235/#262 의존 구현이 함께 테스트됐다는 사실은 각 PR의 팀 리뷰나 병합 완료를 의미하지 않는다.
