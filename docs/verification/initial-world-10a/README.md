# 10-A 통합 검증과 최종 병합 준비

## 검증 기준

최신 develop `b0398b691dd95c79ae04705aea386cf7bd8e2245`에서 `test/initial-world-integration`을 생성했다. 기존 PR은 모두 Draft·OPEN이고 각 원본 HEAD의 Required CI는 성공이었다. 정확한 HEAD/base/증분 파일/적용 커밋/마이그레이션 SHA-256은 [manifest](manifest.json)에 고정한다. 실제 develop·원본 PR 브랜치에는 쓰지 않았다.

## 통합 방식과 소유 변경

각 PR의 `git merge-base(base, head)..head` 증분만 순서대로 적용해 PR별 커밋을 만들었다. #266의 `feat/initial-world-5c-dependencies`는 선행 4개 HEAD를 묶은 테스트 base일 뿐 실제 기능 PR이 아니므로 별도로 적용하거나 병합 대상으로 삼지 않았다. #270 이후도 바로 아래 PR 대비 diff만 적용했다. 통합 전 11개 PR union 밖 파일 변경이 없음을 검사했다. 이후 본 검증 문서와 순차 마이그레이션 검증 보강은 별도 통합 검증 커밋으로 구분한다.

| PR | 소유 범위 | 통합 조정 |
|---|---|---|
| #219 | 계약/JSON Schema/Fixture | 증분 자동 적용 |
| #225 | 분석·후보·검토·반영 예약 PG | 증분 자동 적용 |
| #235 | Content 입력 스냅샷 | 증분 자동 적용 |
| #262 | AI 내부 추출 | docs/feature-roadmap.md: #225와 #262 항목 모두 보존 |
| #266 | 분석 실행·후보 저장 | 증분 자동 적용 |
| #270 | 검토 결정 API | 증분 자동 적용 |
| #284 | 승인 후보 초안 반영 | 증분 자동 적용 |
| #285 | metadata 왕복 | 증분 자동 적용 |
| #286 | 후보 검토 UI | frontend/src/app/di/registerAppServices.ts: develop의 운영 댓글/관리자 활동 등록과 initialWorldUseCase를 모두 보존 |
| #288 | 확정 버전 UI | WorldStudioController.kt 및 WorldStudioService.kt: develop 목록/단일 summary API 보존, 중복 이식 제외; WorldStudioPage.tsx: develop 실제 /content 경로 유지 + 확정 버전 도구 추가 |
| #289 | 확정 설정 내부 Context | WorldStudioService.kt: develop summary 두 메서드 보존 + confirmedContext만 추가 |

충돌 수정은 양쪽의 실제 기능을 유지하는 결합뿐이다. #288의 목록 DTO/query는 develop에 이미 동일하므로 중복 추가하지 않았다. 회차에서 사용하는 revisionSummary/sealedRevision/summary 경로와 실제 모드 /content 이동, 운영 댓글·관리자 활동 DI를 보존했다. GitHub의 개별 PR mergeable 상태가 전체 순차 통합 충돌 없음을 뜻하지 않는다.

## 검증 계약

- V1/V2는 develop 원본, V3~V5는 기존 PR 원본과 바이트/체크섬을 대조했다. SQL 변경·repair·실제 DB 연결 없음.
- 기존 fresh 설치, V2→V5, V4→V5 검증에 V1→V2→V3→V4→V5 단계별 migrate/validate/재실행 0건 검증을 추가했다. 세계관·카드 원문/metadata·분석 key/snapshot 보존 및 자동 관계 backfill 없음도 검사한다.
- 분석→검토→선택 반영→PG/Neo4j 재조회→명시적 확정→이전 버전→내부 Context는 기존 `InitialWorldAnalysisPostgresTest`, `WorldStudioServicePostgresTest`, HTTP 시스템 `test_content_initial_world_review_survives_relogin_and_keeps_original`에서 검증한다. UI는 HTTP adapter 단위와 React 통합 테스트를 별도로 검증한다. 하나의 실제 배포 브라우저 E2E라고 표현하지 않는다.
- 중복/동시 실행, stale, UUID/원문/근거/metadata 보존, PG/Neo4j 부분 실패, unknown key/예약 유지, 응답 유실·재시작은 기존 분석/반영 PG 및 프런트 요청 복구 테스트를 유지한다.
- `workflow_dispatch`는 기존 CI 선택기에서 full=true로 모든 서비스 단위/통합·전체 HTTP 시나리오를 선택한다. 빌드·PostgreSQL·Neo4j·HTTP는 격리 GitHub CI에서 실행한다. 유료 모델 대신 대역만 사용한다.

## 실제 병합 절차 — 이번 작업에서는 실행 금지

1. 팀 리뷰 후 #219 → #225 → #235 → #262 순서. 각 병합마다 다음 PR을 최신 develop과 비교/재검증한다.
2. #266은 위 네 PR이 실제 develop에 반영된 뒤 **base를 develop으로 바꾸고** 증분을 재검증한다. 검증 의존성 브랜치를 먼저 develop에 병합하면 안 된다. squash 병합이라 원래 commit ancestry가 달라질 경우 파일 diff/patch 동등성을 다시 확인한다.
3. #266 → #270 → #284 → #285 → #286 → #288 → #289. 아래 PR이 병합되면 다음 base를 develop으로 바꾸고 이번 충돌 해결과 비교해 diff·CI를 다시 확인한다.
4. 이 통합 브랜치는 검증용이며 통째로 병합하지 않는다. 통합 중 별도 회귀 수정이 생기면 해당 PR 소유 변경으로 이식하고 팀 리뷰한다. 강제 push·자동 병합 없음.

## 사람 리뷰·배포 수용

- 원본 PR의 Draft 해제와 승인 여부는 팀 결정이다. CI 성공만으로 병합 승인으로 간주하지 않는다.
- #288 다른 탭의 후속 확정으로 pointer가 달라지면 key를 유지하고 자동 성공/새 요청을 차단한다. 보수적 미확인 상태를 수동 해소하는 별도 UX는 현재 없다. 실제 사용자 흐름의 수용 여부를 리뷰한다.
- 실제 DB에는 과거 배포 이력/체크섬을 읽기 전용으로 대조한 뒤 승인된 배포 절차만 사용한다. archived WorldStudio history가 있으면 자동 repair/전환하지 않는다.
- 배포 후 별도 QA 세계관에서 인증/CSRF/proxy, 재로그인, 분석 상태, 후보 수정·재승인·반영, 관계·metadata 왕복, 확정/과거 버전을 확인한다. UI 실제 모바일/키보드, 서버 timeout/재시작 구성도 수용 검증 대상이다.
- 실제 모델 품질·비용은 미검증. 이번 통합에서 유료 호출 없음.
- 9-A는 소유자용 확정 카드 Context 조각이다. 전체 집필 Context Builder, 작품/회차 연결, 인물별 지식, MCP, 관계 이력/Fork를 구현하거나 완료로 표시하지 않는다.

## CI 실행 결과

원본 HEAD의 성공과 통합 HEAD의 성공은 별개다. 통합 실행의 정확한 HEAD·run·결과는 작업 최종 보고와 이 브랜치의 CI 기록으로 확인한다. 아직 실행되지 않은 항목을 성공으로 간주하지 않는다.
