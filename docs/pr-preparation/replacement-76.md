# PR #76 종료 후 재구성 준비

준비 기록 기준일: 2026-11-03. 이 준비 이후 사용자 승인에 따라 기존 격리 브랜치의 프런트·설계 문서를 분리 커밋하여 공유한다. 새 PR 생성·rebase·병합은 수행하지 않는다. 아래 develop SHA는 준비 시점 기준이며 최종 설계 검토는 6d4ff1d 기준이다.

## 보존 및 기준

- [PR #76](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76)은 사용자 요청으로 병합 없이 closed 처리했다.
- 원격 `feat/world-studio-01-direct`와 head `bb096ebb3146f6bf0faaaa46268fcc6ab08af990` 보존 확인. 브랜치 삭제·수정 없음.
- 기존 통합 브랜치의 `dba4539da6dfc24496ad5d19c3075c9fdf82b9c7` 및 현재 `codex/world-card-classification` 작업 파일 보존.
- 최신 develop fetch 결과: `cbc0205a6cb7154274c2113daca68662958e5fe7`.
- 기존 설계 검토 기준 `017cc48`에서 최신 develop까지 content 코드 및 DB migration 경로 차이 없음을 확인했다.
- 미커밋 프런트·문서는 로컬 `output/pr76-replacement/source-snapshot.zip`, tracked diff는 `working-changes.patch`, 파일별 SHA256은 `manifest.json`에 백업했다. 이 파일들은 개발 DB·비밀값·의존성을 포함하지 않는다.
- 기존 `series.md`의 01~06 패치 적용·CI 기록은 과거 기준이다. 새 develop에 적용 가능한 것으로 간주하지 않는다.

## 새 PR 분리 기준

각 PR은 사용자 동작과 저장 계약의 한 단위다. 파일 확장자나 프런트/백엔드만으로 임의 분리해 동작하지 않는 중간 상태를 만들지 않는다. 순서와 내용은 아래와 같다.

| 순서 | Draft PR 제안 | 포함 범위 | 선행 조건 / 제외 |
|---|---|---|---|
| 1 | docs: 초기 세계관 저장 모델과 통합 계약 제안 | [설계 문서](../design/world-studio-initial-model.md), 현재 6종/2종/별칭 검증, API·DB 합의 항목 | 코드·DB 변경 없음. 먼저 팀 검토 |
| 2 | feat: 초기 세계관 초안과 확정 버전 저장 | 합의된 8종·별칭 DTO/검증, 기존 PostgreSQL 모델 재사용, 안정 ID, 저장·재조회, 소유권·동시성 | API·DB·인증 합의 후 별도 승인 범위로 구현. 기존 H2 writer를 최종 모델로 옮기지 않음 |
| 3 | feat: 세계관 카드 작성과 분류 편집 | 8종 필터/7영역, 기존 데이터 읽기·ID 보존, Core 연동, 오류·미저장 상태 | 2가 develop에 반영된 후. 기존 6종 임시 제한 제거는 실제 capability·왕복 검증 뒤 |
| 4 | feat: 인물 관계와 감정 편집 | 카드 연결·자유 관계/감정 구분, 삭제/복원·endpoint 정합성 | 관계 version/manifest 계약 선행. 3과 공유하는 카드 ID 사용 |
| 5 | feat: 확정 설정 조회와 전체 세계관 지도 | 확정 설정집·초기 시간선·관계 조회·force graph | 2/4의 확정 revision 조회 계약. Graph DB 연동은 별도 합의; 프런트 force graph와 혼동 금지 |
| 6 | feat: 세계관 분석 후보 검토와 초안 반영 | LLM 후보·근거·승인 결과, 승인→초안, stale revision 거절 | AI/Core 계약 합의. 유료 호출은 별도 승인. 후보 도착을 저장 완료로 표시하지 않음 |

2의 변경량이 크면 draft CRUD와 revision atomic 저장을 나눌 수 있으나, 앞 PR에서는 버전 저장을 완료된 기능으로 노출하지 않는다. 아직 팀 계약을 확정하지 않았으므로 신규 migration 또는 Core 구현은 이번 준비에 포함하지 않았다.

## 최신 develop과의 실제 통합 지점

현재 `AuthSecurityConfig.kt`는 JWT/STATELESS와 변경 요청 CSRF를 적용하고, 명시되지 않은 경로를 denyAll한다. 기존 작업실의 체험 HttpSession 계약을 그대로 반입하면 운영 인증과 연결되지 않는다.

코드 변경 전에 팀 협의할 항목:

- `backend/core-api/src/main/kotlin/ai/storyfork/core/auth/config/AuthSecurityConfig.kt`: studio endpoint 접근 정책 및 인증 Principal. permitAll/CSRF 예외로 우회하지 않는다.
- `backend/core-api/src/main/kotlin/ai/storyfork/core/content/repository/ContentRepository.kt`: world/setting draft/version 재사용과 초기 회차 독립 저장.
- `frontend/src/data/api/auth.ts`, `csrf.ts`: bearer·CSRF·갱신·로그아웃 경계 재사용.
- `frontend/src/App.tsx`, `app/di/registerAppServices.ts`, `presentation/shared/shell/Gnb.tsx`: 최신 인증·작품·회차 라우팅을 유지하면서 작업실 연결.
- `backend/core-api/src/main/resources/db/content/`: 합의 후 append-only migration; 기존 Flyway 파일 수정 금지.

이는 이미 develop에 병합된 코드와의 비교다. 열려 있는 다른 팀원의 PR을 fetch·가상 병합·검사하거나 기준으로 수정하지 않았다. 이번에는 가상 병합 및 충돌 수정도 수행하지 않았다.

## PR 1 본문 초안

제목: `docs: 초기 세계관 저장 모델과 통합 계약 제안`

### 변경

초기 세계관 카드 8종·설정 영역 7종, 초안/불변 버전/WorldRevision, 관계 정본과 Graph projection 대안 및 기존 테이블 재사용 범위를 문서로 정리한다. #76은 코드를 보존한 채 종료했으며 이 문서부터 새 통합 방향을 검토한다.

### 동작

문서만 변경한다. 실제 서버·화면·DB 동작은 바뀌지 않는다.

### 결정

카드 ID와 기존 fact/claim/undetermined/relation 의미를 보존한다. 자동저장은 초안, 명시 저장은 불변 버전 묶음으로 제안한다. API·DB·인증 계약 변경은 팀 합의 후 별도 PR로 구현한다.

### 한계

현재 로컬 Core는 6종만 정확히 왕복하고 object/other는 미지원이다. aliases는 성공 응답 후 재조회에서 사라진다. 목표 스키마는 미구현이며 DEC-26의 관계 정본 역할 변경은 합의가 필요하다.

### 남은 일

Core DTO·PostgreSQL 확장, 인증 연계, 8종·별칭 실제 저장, Graph 복구 정책을 협의한다.

### 검증

문서 내용·코드 경로·Markdown fence·diff 공백 검사. 기존 로컬 HTTP 검증은 대상 runtime 한정이며 PostgreSQL 통합 검증을 대체하지 않는다. 새 PR의 CI는 아직 실행되지 않았다.

### 한 줄 요약

세계관 저장 구조를 먼저 합의하고 최신 develop 기준의 기능별 Draft PR로 이어간다.

## 실제 재작성 시 순서

1. 그 시점의 최신 develop을 다시 fetch하고 새 `codex/` 작업 브랜치를 시작한다. 현재 보존 브랜치를 reset/rebase하지 않는다.
2. 첫 PR은 설계 문서만 선별한다. 이 준비 문서의 과거 QA/백업 파일은 기능 코드와 섞지 않는다.
3. 팀 합의 후 필요한 기능을 최신 계약에 맞춰 선택적으로 이식한다. 기존 통합 브랜치 전체 merge나 과거 패치 일괄 적용은 하지 않는다.
4. 관련 TDD·리뷰·Aside E2E 후 Draft 생성. Required CI 실제 결과 확인.
5. 실제 병합 직전에 최신 develop과 충돌 검사. 해당 파일·원인을 확인하고 필요한 부분만 수정한다.

현재 준비 상태는 설계/범위/백업 정리까지다. 최신 develop 기반의 기능 이식 또는 새 PR 생성 완료를 뜻하지 않는다.
