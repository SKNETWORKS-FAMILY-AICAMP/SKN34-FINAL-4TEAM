> 이 문서는 앞선 단계의 증거를 보존한 기록입니다. 최종 연결 작업의 현재 결과는 [final-connection.md](final-connection.md)를 기준으로 확인하세요.

# 초기 세계관 최초 구축 — 구현·QA 진행 기록

기준: `origin/develop` `6b4b3e19b04ea533b46e652b866928902faa1d60` + `feat/initial-world-build-integration`의 미커밋 변경.
커밋·push·PR·병합·배포·유료 모델 호출은 하지 않았다. 기존 worktree와 첫 등장 정책 변경은 유지한다.

## 실행 환경

- `compose.qa.yaml`의 독립 PostgreSQL 17 / Neo4j 5.26. 외부 DB 주소·실제 `.env`를 사용하지 않는다.
- PostgreSQL 테스트는 매번 생성한 `ws_*` DB만 사용·정리한다. Neo4j는 이 Compose 전용 인스턴스다.
- Windows JDK의 Gradle loopback 실패 때문에 Docker의 JDK 21을 사용했다. Windows bind mount의 SQL 읽기 지연을 줄이려고 컨테이너 내부 소스 사본에서 실행한다.
- `run.sh`는 선택 테스트만 컴파일하는 QA init script를 사용한다. 저장소 전체 테스트/CI 성공을 의미하지 않는다.
- HTTP 테스트의 인증 검증과 AI 추출은 대역이다. HTTP·Content Service·PostgreSQL·Neo4j는 실제다. 브라우저·실로그인·실모델 품질은 별도다.

## 확인된 결과

| 범위 | 상태 | 근거·한계 |
|---|---|---|
| 직접 등록의 실제 HTTP 흐름 | PASS | 세계관 생성, 카드 2개·관계 1개, 분석, hold/reject/edit/approve, 적용·같은 요청 재전송, 재조회, 명시적 확정. `current-results/qa/direct-http.json` |
| 직접 등록의 저장 데이터 | PASS | 카드 3개, 검토 기록 4개, 원래 관계의 끝점·회차를 SQL/Neo4j 조회로 확인. `direct-db.json` |
| 원고 입력·보존 경계 단위 테스트 | PASS | 입력 3 + 결과 완전성 3 + 결과 저장 서비스 2 + 저장본 스냅샷 3 = 11개 |
| 실행권·명시적 재개 단위 테스트 | PASS | 신규 3개. 중복 배달 거절, 만료 후 이전 token을 지목한 재개, 이전 worker의 실패 기록 차단, 적재 중/unknown/완료 상태의 추출 재호출 차단 |
| 실제 PostgreSQL 동시 실행권·실패 후 성공 결과 재사용 | PASS | 두 thread의 동시 claim 중 하나만 token 발급. 실패 후 같은 job 재개에서 기존 결과와 result ID 유지. 서버 프로세스 강제 종료·재시작 검증은 아님 |
| 기존 WorldStudio + 신규 적재 보호 단위 테스트 | PASS | `WorldStudioServiceTest` 58개. 일반 저장/확정/새 후보 반영 예약 보호와 기존 receipt 재사용 포함 |
| 신규 V9 기록·기존 검토 마이그레이션 | PASS | `ManuscriptBuildStoragePostgresTest` 1개, `InitialWorldStoragePostgresTest` 3개. 기존 이력 보존·불변 결과·고유 슬롯·receipt 제약 |
| 회차 결과의 실제 JPA 저장·재조회 | PASS | 한 결과를 두 번 보냈을 때 같은 result ID·DB 행 1개. `manuscript-result-db.json`. 원고 업로드 또는 전체 추출 검증과 구분 |
| 준비된 부분 추가의 Neo4j 성공/PG 실패 복구 | PASS | QA 전용 완료 실패 trigger로 Neo4j 성공 뒤 PG rollback 재현. 초안 revision 유지·unknown, 동일 UUID/key/step 복구, 이후 일반 편집 뒤 원래 receipt 조회, 기존 카드/관계·이전 확정 버전 불변 확인. `manuscript-step-db.json` |
| TXT/EPUB → 최초 구축의 전체 연결 | BLOCKED | 접수/실행 claim·MCP 도구·추출 호출·정체/LoadPayload 검증·준비 매퍼가 아직 미연결 |
| TXT·EPUB 실제 업로드 → 저장 원문 스냅샷 | PASS | 각각 별도 QA 작품에 4회차 업로드. 저장 버전 ID·회차 번호·본문 대조, 발행 0건. `manuscript-upload-http.json`, `manuscript-upload-db.json`, `manuscript-epub-http.json`, `manuscript-epub-db.json` |
| AI 추출·정체·구조화 선택 단위 | PASS | 제공사 대역 41개. 현재 작업 폴더 모듈 경로를 검증한 후 실행. `ai-green.xml`. 실제 모델·AI HTTP·Content 적재 연결 검증은 아님 |
| 기존 카드와 원고 대상의 자동 식별·병합 | 미구현 | 이름만으로 병합하거나 기존 원문을 덮어쓰지 않는다 |
| 100화 최초 구축 → 101화 작성 | NOT TESTED | 이전 참고 코드 probe를 현재 Content 저장 수용 성공으로 사용하지 않는다 |
| Wiki·프런트 metadata 왕복·실로그인·실모델 | NOT TESTED | HTTP 저장 성공으로 대체하지 않는다 |

최신 선택 검증: 단위 **69개**(WorldStudio 58 + 최초 구축 경계 11), 통합·HTTP **16개**, 실패/건너뜀 0개. `current-results/test-results`와 `current-results/qa`에 실행 산출물을 보존한다. 통합 테스트에는 실제 DB 장애를 주입하는 복수 시나리오가 들어 있으며, 숫자는 시나리오 수가 아닌 JUnit test 수다. Required CI는 커밋·push 금지 범위라 실행하지 않았다.

## 구현한 저장 경계

- V1~V8을 변경하지 않고 V9에 `manuscript_build_job/result/load_step`을 추가했다.
- `ManuscriptBuildSnapshot`은 기존 소유자 회차 조회와 Content transaction을 재사용한다. 미저장 편집본 대신 최신 저장본을 읽고, 저장본 누락·상속 회차는 거절한다.
- `ManuscriptBuildInput`은 원문 버전·해시·UTF-16 좌표와 전체 결과 집합을 검사한다.
- `ManuscriptBuildResultStore`는 소유권, 고정 입력, 실행 token/deadline을 확인하고 결과를 누적한다. 같은 결과 재전송은 기존 ID를 반환하고 덮어쓰기는 거절한다. 이 envelope 검증 자체가 AI 의미 추출 스키마 검증은 아니다.
- `ManuscriptBuildExecution`은 world→job 잠금 안에서 실행권만 발급한다. 외부 모델 호출을 transaction 안에서 하지 않으며 자동 재개도 하지 않는다. 사용자/API·worker 연결은 아직 남아 있다.
- `WorldStudioService`에 고정된 load step의 부분 추가 경로를 연결했다. 최종 PG transaction에 카드·revision·관계 완료와 step receipt를 함께 기록한다. 전체 준비 단계가 완료되어야 job 완료다.
- 원고 적재가 pending인 동안 일반 저장/확정과 새 AI 후보 반영 예약을 막는다. 이미 완료된 receipt는 최신 관계를 다시 읽기 전에 반환한다.

## 남은 구현

1. 작품별 시작 동의/고정 대상 요청의 접수·조회, 실행권 서비스와 worker 연결, 실제 프로세스 중단 후 동일 job 재개 수용 검증.
2. 회차 추출의 구조·ID·의미 검증 및 영속 성공 결과 재사용, 전체 결과 기준 정체 통합.
3. 검증된 payload → 기존 WorldStudio 카드/DEC-51 관계의 단계별 준비. UUID·key·payload를 최초 준비에서 고정.
4. `preprocessing_episode_read/progress/load` 및 결과 보존/재조회 연결. 서비스 인증을 사용자 MCP 권한과 분리.
5. 승인된 비공개 정책 및 원고 출처 metadata의 프런트 왕복 검사. `preprocessing` 후보 승인 ID를 위조하지 않고 별도 `manuscriptBuild` 출처 사용.
6. 실제 TXT/EPUB 4회차 업로드부터 전체 적재·작가 확정까지 대역 기반 HTTP 수용 검증.

위 항목이 완료되기 전 원고 자동 구축을 활성화하거나 두 경로 통합 완료로 보고하지 않는다.

## 추가 실행 기록

- TXT/EPUB 검증을 확장한 `InitialBuildHttpIntegrationTest` 재실행: 1개 성공, 실패 0, 2026-11-17 03:31:56 UTC 시작. 기존 직접 등록 및 부분 실패 복구도 같은 테스트에서 재검증했다.
- 첫 TXT 검증은 실제 업로드 HTTP 200 이후 테스트 코드의 Jackson JsonNode `map` 오버로드 선택으로 비교에 실패했다. 명시적 배열 인덱스 순회로 테스트를 수정했고 제품 업로드 코드는 변경하지 않았다.
- AI 테스트 환경에 과거 checkout을 가리키는 editable import가 있어 해당 finder를 테스트 프로세스에서 제외했다. 현재 checkout의 모듈 경로를 assertion으로 확인한 실행만 위 41개에 포함한다.
- AI 기존 `sourceHash`(회차 번호·제목·본문 JSON)와 Content manifest hash(회차 ID·저장 버전 포함)는 서로 다른 값이다. 향후 연결에서 둘을 같은 해시로 취급하면 안 된다.
- 실행권 TDD: 구현 클래스 부재로 컴파일 실패 확인 후 최소 서비스 추가. 실행권 3개 + 결과 저장 2개 선택 단위 재실행 성공(2026-11-17 03:39 UTC). 앞선 69개와 합산한 Content 고유 테스트는 72개이며 전체 suite를 한 번에 실행한 수치는 아니다.
- 실행권 DB 경합을 추가한 HTTP 통합 테스트 재실행 성공(`BUILD SUCCESSFUL in 3m 43s`, 1개 테스트/실패 0). 직접 등록, TXT/EPUB 업로드, 결과 JPA 보존, 분산 적재 복구를 함께 재검증했다. 동일한 composite 테스트를 여러 번 실행한 것이므로 통합 테스트 총수에 중복 가산하지 않는다.
- 최종 원격 develop 재확인: `6b4b3e19b04ea533b46e652b866928902faa1d60`로 기준과 동일. 기존 migration 파일의 diff는 없으며 신규 V9만 추가했다.
