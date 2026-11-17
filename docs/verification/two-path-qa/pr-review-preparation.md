# 초기 세계관 구축 Draft PR 검토 안내

대상: [#455](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/455), `feat/initial-world-build` → `develop`.
2026-11-17 `cb7e93cf3e3f44dda0ebc748c5cf443127bc2b9c`를 일반 merge로 반영했다. 충돌 표시는 없었으며 WorldStudioService·단위 테스트·HTTP 어댑터 테스트의 자동 병합 내용을 확인했다. 팀원 표지·공개 세계관 변경을 유지한다.

## 이번 보완

- 4/10화 HTTP 수용 테스트가 개발자 PC의 AI 대역 주소를 전제했다. Content CI 안에서 Fixture 전용 FastAPI를 실행하고 `MANUSCRIPT_QA_AI_URL`을 명시한다. 유료 모델 키는 사용하지 않는다.
- 작품 이동 시 이전 시작 동의가 남는 결함을 React 실패 테스트로 확인했다. 작품이 바뀌면 동의·결과·조회 준비 상태를 지우며 5개 패널 테스트가 통과했다.
- unknown 적재를 복구한 뒤 완료 상태에도 실패 코드가 남는 결함을 단위 테스트로 재현했다(60개 중 해당 1개 실패). 최종 완료 PG transaction에서 failureCode만 비우도록 수정 후 WorldStudio 단위 60개 통과. 원래 UUID·payload·receipt는 유지한다.
- 수동 QA 대역·입력 안내·4화 TXT를 보존한다. 대역은 예시만 처리하며 다른 원문을 임의 분석하지 않는다.

## 검증 근거 구분

과거 실행 횟수는 [HTTP/DB 보고서](final-connection.md), [브라우저 보고서](browser-qa.md)의 각 실행 단위 그대로 읽는다. 다른 XML의 테스트 수를 합산하지 않는다.

이번 로컬 재검증: AI 전처리 43개 + 수동 대역 3개 통과, 기존 프런트 선택 108개 통과, 동의 초기화 Red 확인 후 패널 5개 통과. AI 첫 실행은 예전 editable 가상환경의 소스를 읽어 실패했으며, 현재 소스 경로를 명시한 재실행이 위 결과다. 제품 수정으로 숨기지 않았다.

변경 HEAD의 전체 CI 완료 여부는 PR Checks와 workflow_dispatch 실행을 확인한다. 이 문서 작성 시 CI 진행 중이며 전체 성공으로 단정하지 않는다. CI의 `initial-world-http-db-evidence` artifact에 합성 입력의 HTTP/DB 증거와 JUnit 결과를 보존한다(7일). 로컬 브라우저 데이터를 다시 만들거나 기존 QA DB를 초기화하지 않는다.

## 파일 보존·정리 판단

| 파일 또는 경로 | 처리와 이유 |
|---|---|
| 제품 코드·테스트·`tests/preprocessing/fixtures`·`src/test/resources/initial-build` | 유지. 실제 실행과 회귀 테스트에 필요 |
| `final-connection.md`, `browser-qa.md`, `implementation-status.md`, `README.md` | 유지. 과거 단계별 결과·미검증 범위 기록 |
| `current-results/qa/*`, `browser-evidence/*`, `evidence/*` | 유지. 보고서가 참조하는 합성 원문·UUID·HTTP/DB·브라우저 근거 |
| `current-results/test-results/{test,unitTest,integrationTest}/*.xml`, `input-results/*`, 최상위 XML | 유지. 중복처럼 보여도 과거 실행 단계와 Red/Green 증거가 섞여 있어 이번에는 삭제하지 않음 |
| `evidence/hundred-*` | 과거 합성 자료로만 유지. 이번 100화 실행·성능 검증의 근거가 아님 |
| 로컬 `current-results/reports/`, 각 `test-results/**/binary/` | 미추적 상태로 로컬 보존, 커밋 제외. 재생성 가능한 HTML·바이너리이며 공유 XML로 결과 확인 가능 |
| `manual_provider.py`, `test_manual_provider.py`, `manual.html`, `manual-fixtures/*`, `vite.qa.config.ts` | QA 전용 실행·안내 및 검증으로 유지. 제품 빌드 진입점 변경 없음. 안내 HTML의 비밀번호 제거 |

변경 파일에서 개인키·실제 제공사 키·GitHub 토큰·JWT 패턴 및 증거 내 인증 헤더·쿠키·비밀번호를 점검했다. 실제 자격 값은 발견하지 않았다. Compose의 `qa-only-*`, 내부 대역 `qa-token` 등은 격리 QA용 고정값이다. HTTP/DB의 원문은 Fixture의 합성 데이터이며 사용자 원고를 반입하지 않았다. 패턴 검사는 완전한 비밀정보 검증을 대신하지 않으므로 팀 리뷰 시 함께 확인한다.

## 팀 리뷰 중점

1. V1~V8 불변, WorldStudio 전용 이력의 additive V9. Content의 별도 V9와 다른 Flyway 이력이다.
2. job의 전체 회차·원문 버전·해시 고정, 성공 result 불변·실패 회차 재사용.
3. 최초 구축에 한정된 work별 job, UUID/key/payload 고정, 완료 receipt 우선 반환.
4. WorldStudio 부분 추가 경로와 같은 최종 PG transaction에서 초안·관계 완료·receipt 확정. Neo4j 실패를 PG와 동시 롤백으로 취급하지 않음.
5. unknown은 같은 요청으로 복구하고 일반 저장과의 경합을 차단. 실행 중 강제 종료는 별도 수용 검증 필요.
6. DEC-47 IDENTITY·SOUL·GOAL·회차 기억, DEC-51 시작/종료 관계, 기존 확정 카드 불변.
7. 첫 등장 정보와 독자 공개 회차 분리, 기본 비공개, 직접 등록 승인 기록과 원고 출처 구분.
8. 프런트 편집·재조회에서 출처 metadata 보존 및 작품/계정별 요청 보호.

새 DB·큐·범용 실행 계층은 추가하지 않았다. ponytail-review 관점에서 이번 범위에 별도 구조 재작성은 권장하지 않는다. CodeRabbit CLI는 로컬에서 발견되지 않았다. PR 자동 리뷰는 필요한 `review-ready` 라벨이 없어 skipped이며 리뷰 완료로 간주하지 않는다. 라벨과 Draft는 임의 변경하지 않았다.

## 병합·활성화 전 남은 조건

- 최종 HEAD의 Required CI와 전체 서비스 수동 CI 통과, 팀 리뷰.
- develop이 바뀌면 V9 번호 및 자동 병합 파일을 다시 확인하고 CI 재실행.
- 실제 모델 품질·유료 호출은 별도 승인과 비용 상한 필요.
- 실행 중 프로세스 강제 종료, 모바일 시각 QA, 운영 배포는 미검증.
- 기존 카드 세계관 자동 병합·신규 회차 자동 갱신·20~30화 및 100화 성능은 이번 완료 범위 아님.
- Draft 유지. 실행 플래그 기본 false 유지. 이 PR 생성·CI는 배포나 활성화 승인이 아님.
