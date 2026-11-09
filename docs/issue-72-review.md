# 이슈 #72 수정 및 검증 기록

[메인 README](../README.md) · [문서 목록](README.md)

> **작성 시점 기록:** 종료된 이슈 #72의 작성 시점 기록입니다. 현재 개발 현황은 [기능표](feature-roadmap.md)를 따릅니다.

기준: `a8d44ffc77e4b91cc21a9a6a3e3644177917e404` (PR #68 병합). 이번 변경은 로컬 미커밋 수정이며 #72 전체 리뷰 완료 선언이 아니다.

## 변경

- AI 입력의 대상 회차와 실제 적용 버전을 명시적으로 보존한다. 문맥 기준 회차와 적용 대상 회차를 구분하며 revision 숫자로 회차·버전을 추정하지 않는다.
- 기존 관계형 입력/적용 테이블에서 명시적 연결을 복원한다. 이미 저장된 과거 감사 이력은 자동 재작성하지 않는다.
- V5 신규 실행 시 과거 JSON의 AI 제안은 revision·원문·결과 본문으로 단일 대상이 확인될 때만 이관한다. 모호하면 실패하고 원본은 유지한다. 기존 V5 트랜잭션 경계는 변경하지 않았다.
- V8은 기존 공개 범위를 검사하고 같은 작품·올바른 시작/종료 순서를 강제한다. 잘못된 기존 이력은 자동 수정하지 않고 마이그레이션을 중단한다.
- 설정 원본/Fork/독립 조회에 해당 작품의 회차 범위를 적용한다. 과거 마이그레이션에서도 조회할 수 있도록 V4 뷰를 변경하지 않고 Repository에서 범위와 작품을 함께 조회한다.
- 회차 이동을 취소하면 선택한 저장 버전과 권리 확인을 보존한다.
- 지침·아키텍처·DI 설명에서 콘텐츠 HTTP 경로와 메모리 데모 경로를 구분한다.

## 로컬 검증

- TDD Red: 회차 이동 취소의 반환값, AI 입력의 3화→1화 오연결, 다른 작품/역순 회차 공개 범위 허용을 재현했다.
- 별도 PostgreSQL `content_review72_test`: Core 콘텐츠 관련 22개 통과, 실패/오류/건너뜀 0. V5 중간 저장 실패 시 work/member/world 롤백과 legacy 원본 보존, 재시도, 모호한 AI 결과 거부 및 결과 ID 보존 포함.
- Frontend 관련 3파일 15개 통과. TypeScript 검사와 변경 파일 oxlint 통과.
- Impeccable detector: 변경 View에서 지적 없음. Ponytail-review: 호출부·조회·이관·기존 데이터 호환성을 확인하고 범위 내 추가 미해결 지적 없음.
- Aside CLI guide/repl을 사용해 실제 서버에서 조회한 합성 작품의 버전 선택과 회차 이동을 확인했다. 정확한 이름의 aside-browser 스킬은 설치 목록에서 찾지 못했으므로 로드했다고 주장하지 않는다.
- 내장 브라우저의 실제 확인창에서 이동 취소 후 1화·미저장 본문·저장 버전 선택·권리 확인이 유지됨을 확인했다. Aside의 정상 이동 검증과 구분한다.
- 화면 URL: `http://localhost:5173/studio/50a562ef-5bf7-4902-aa84-af0e64774c7c`. 별도 합성 검증 작품만 생성했으며 기존 사용자 작품은 수정하지 않았다.
- Aside 증거: `C:\Users\playdata2\.aside\u\0\sessions\2026-11-03_qQSdLZgAg1Eqw88u`의 세션 기록. 스크린샷은 CDP 캡처 timeout으로 저장하지 못했으며 이미지 증거로 간주하지 않는다.
- 현재 로컬 Core의 허용 Origin과 localhost 웹 주소가 달라 브라우저 자동저장은 거부됐다. 이 실패에서도 입력 보존을 확인했으며 저장 성공으로 기록하지 않는다. 실제 .env는 변경하지 않았다.

## 범위 및 남은 검증

- 기존 데모의 HTTP 전환, PR #71 인증 연결, 전체 인물·관계 체크포인트는 이번 수정 범위가 아니다. content_only 한계를 유지한다.
- 실행 중인 Core는 기존 프로세스다. 변경된 Core·V8의 검증은 위 별도 PostgreSQL 테스트에서 수행했으며 기존 로컬 사용자 DB나 배포 서버에 마이그레이션하지 않았다.
- AI는 Mockito 대역으로 검사했으며 유료 모델을 호출하지 않았다. Docker 실제 구동과 미커밋 변경의 Required CI는 미검증이다.
- Graphify AST 갱신. SQL 추출 의존성 부재로 DB 관계는 SQL 직접 확인과 실제 PostgreSQL 테스트로 검증했다.
- 커밋·푸시·PR 수정은 수행하지 않았다.


## develop 병합 호환성 재확인 — 2026-11-03

기준 병합 커밋: `9cb4891` (개인 수정 `e57297c` + 인증 PR #71의 develop).

- Git의 미해결 인덱스는 없었으나 architecture.md에 커밋된 충돌 표시 3곳이 남아 있었다. 실제 인증·콘텐츠·데모 경계를 함께 보존해 정리하고 로컬 링크를 확인했다.
- AuthContentIntegrationTest가 콘텐츠 마이그레이션을 7개로 고정해 V8과 충돌했다. 실제 PostgreSQL/로그인 JWT 테스트에서 실패를 재현하고, 인증 이력과 콘텐츠 V1~V8 적용 여부를 함께 검사하도록 수정했다.
- 새 개발용 Nginx가 기본 60초 읽기 제한을 사용하므로 Core 생성 제한 75초보다 먼저 끊길 수 있었다. 두 Nginx 설정을 검사하는 회귀를 먼저 실패시킨 뒤 개발 프록시도 90초로 맞췄다.
- 로컬 첫 실행은 중지된 테스트 PostgreSQL/미생성 DB 때문에 실패했다. 별도 loopback PostgreSQL을 재시작하고 content_merge_auth_test/content_merge_content_test DB에서 다시 확인했다. 운영/사용자 DB와 실제 .env는 변경하지 않았다.
- 검증: 콘텐츠 관련 22개 통과. 수정 후 AuthContentIntegrationTest 2개 통과(실제 HTTP·JWT·CSRF·타 사용자 거부·인증/콘텐츠 마이그레이션 공존). 서로 다른 실행 단계의 결과이며 동일 시점 전체 테스트 통과로 표현하지 않는다.
- Frontend 인증·콘텐츠·집필 관련 6파일 45개 및 TypeScript 검사 통과. 환경설정 unittest 4개, 개발/이미지 Compose 콘텐츠 설정·비밀값 격리, Nginx 라우팅·제한시간 검사 통과.
- Ponytail-review에서 기존 인증/콘텐츠 계약과 실패 경로 보존을 확인했다. 추가 의존성·서비스·화면 변경은 없다. Graphify AST 갱신 및 git diff --check 통과.
- 이번 수정에는 UI 동작 변경이 없어 별도 Aside 화면 E2E는 수행하지 않았다. 인증/콘텐츠 연결은 실제 HTTP 통합 테스트로 확인했으며, 개발 Nginx를 통한 긴 생성 요청은 Docker Linux 엔진 미기동으로 미검증이다. 유료 AI 호출은 하지 않았다.
- 최신 미커밋 변경의 Required CI는 검증 대기다. 이번 수정은 커밋·푸시하지 않았다.

## PR #78 리뷰 후속 수정 — 2026-11-03

- Major: 공개 회차가 없는 작품에서 revision 0의 AI 제안을 대기시킨 뒤 초안을 revision 1로 수정하면 V5가 대상을 찾지 못하는 사례를 재현했다. 명시적 대상·적용 결과·단일 후보를 우선하며, 대기 상태·공개 회차 없음·후보 없음일 때만 대상을 1화로 복원한다. 발행 회차가 있어 대상을 확정할 수 없거나 적용 결과가 모호하면 계속 거부한다.
- Minor: 루트 AGENTS.md의 후속 인증 작업이 전체 인증 구현이 아니라 해당 서재·열람·Fork 데모의 실제 인증 연결을 뜻한다고 명시했다.
- TDD Red: 새 정상 이관 테스트가 `Legacy proposal target is ambiguous`로 실패했다(마이그레이션 5개 중 1개 실패). Green 및 조건식 정리 후 재실행: 별도 PostgreSQL `content_pr78_migration_test`에서 `./gradlew test --tests '*ContentMigrationTest*' --no-daemon` 5개 통과, 실패·오류·건너뜀 0. 대기 제안의 원문·revision·상태, 최신 초안·저장 버전, 재실행 시 중복 없음 및 대상 불명 거부 시 원본 보존을 확인했다.
- Ponytail-review에서 대상 추론 우선순위·거부 경로·Flyway 호출부·저장 연결을 검토했고 추가 수정 지적은 없었다. 새 의존성·API·화면은 추가하지 않았다. Graphify AST 갱신, 지침 로컬 링크 및 `git diff --check` 통과. Graphify의 기존 SQL 추출 의존성 부재는 유지되며 이관 동작은 실제 PostgreSQL에서 검증했다.
- 이번 변경은 마이그레이션과 문구에 한정되어 브라우저 사용자 흐름 변경이 없으므로 Aside E2E는 제외했다. 기존 사용자/배포 DB와 실제 .env는 변경하지 않았으며 유료 AI 호출도 하지 않았다. Docker·운영 배포·이번 미커밋 변경의 Required CI는 검증 대기다. 커밋·푸시·PR 댓글 작성은 수행하지 않았다.

## PR #78 설정 공개 범위 JOIN 후속 수정 — 2026-11-03

- `readSettings`의 선택적 공개 범위 JOIN 안에서 대상 작품을 제한한다. 다른 작품의 범위만 존재해도 설정 버전 자체는 보존하고 해당 버전의 `default_visibility`를 사용한다. 작품 설정 이력은 현재 작품, Fork 최초 기준과 원본 스냅샷은 원작 작품을 기준으로 조회한다. 기존 SQL 마이그레이션·권한 검사·저장 계약은 변경하지 않았다.
- TDD Red: 별도 PostgreSQL `content_pr78_scope_test`에서 새 회귀 2개가 의도대로 실패했다. 최신 비공개 이력은 2개 대신 1개만 조회됐고 기본 공개 정책의 Fork 기준 설정은 빈 목록이었다. 테스트용 합성 자료에만 타 작품 범위를 구성했으며 기존 사용자/배포 DB는 변경하지 않았다.
- Green: `./gradlew test --tests '*ContentPostgresTest' --tests '*ContentMigrationTest' --tests '*WritingPostgresTest' --tests '*ContentServiceTest' --tests '*ContentAuthorizationTest' --no-daemon` 5개 클래스 26개 통과, 실패·오류·건너뜀 0. 소유자 이력의 최신 비공개 버전 유지, 독자 문맥·Fork에서 이전 공개 내용 재노출 방지, 기본 공개 설정의 Fork 기준·추종·독립 수정·원본 스냅샷 보존을 검증했다. 기존 V5 이관·원고·권한 회귀도 함께 통과했다.
- Ponytail-review에서 세 호출부의 작품 범위·SQL 인자 순서·기본 정책 보존·저장 및 이관 연결을 확인했고 추가 수정 지적은 없었다. Graphify AST 갱신과 `git diff --check` 통과. 기존 SQL 추출 의존성 부재는 유지되며 쿼리는 실제 PostgreSQL 통합 테스트로 검증했다.
- 화면·HTTP 계약·사용자 조작 흐름을 바꾸지 않는 저장소 조회 수정으로 Aside E2E는 별도 실행하지 않았다. 현재 실행 중인 웹/Core의 재시작·브라우저 확인, Docker·운영 배포·이번 미커밋 변경의 Required CI는 미검증이다. 실제 .env·모델 설정은 변경하지 않았으며 유료 호출·커밋·푸시·PR 댓글 작성은 수행하지 않았다.
