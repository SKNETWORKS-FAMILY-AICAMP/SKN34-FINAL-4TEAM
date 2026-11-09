# #84 콘텐츠 책임 분리와 JPA 전환

[메인 README](../README.md) · [문서 목록](README.md)

> **작성 시점 기록:** 종료된 이슈 #84의 작성 시점 기록입니다. 현재 콘텐츠 서비스 경계는 [이관 계약](design/content-service-migration-contract.md)을 따릅니다.

현재 작업 브랜치의 #84 변경이다. 삭제 정책은 사용자 요청으로 보류한다. 이 문서는 구현 범위와 검증 상태를 구분하며 #50·#72 전체 완료를 뜻하지 않는다.

## 책임·파일 대응

| 이전 책임 | 현재 소유 패키지 | 보존 계약 |
|---|---|---|
| ContentController의 작품·정책·이력 | work/controller, work/service | /works, /history, /policy 및 공개 조회 |
| 회차 생성·목록·상세·자동 저장 | episode/controller, episode/service | /episodes, /draft; 회차 edit_revision |
| 수동 저장·복원·기존 작품 작성 | episode_version/controller, episode_version/service | /versions, /restore, /works/{id}/draft |
| 선택 버전 발행 | publication/controller, publication/service | 회차/작품 publish, 발행 사건·권리 확인 |
| 설정 초안·확정·복원·공개 범위 | world/controller, world/service | /world, /settings; 기본 공개 정책·항목 순서 |
| Fork 생성·독립 후 변경 선택 | fork/controller, fork/service | /forks, /world/changes; 기준 회차·버전 |
| AI 요청·명시 승인·실제 결과 이력 | proposal/controller, proposal/service | /proposals, /accept; 실제 결과 버전 연결 |
| 허용 문맥·원문 발췌 | context/controller, context/service | 소유자/공개 context; 비공개·인물 지식 필터 |

요청·응답은 각 기능의 service/dto에 두며 같은 계약은 재사용한다. 중첩 필드도 DTO로 제한하고 Repository는 Entity를 사용한다. 기존 JSON 배열은 JsonValue 목록 DTO로 유지한다. ContentExceptionHandler는 기존 detail 오류 계약을 보존하는 HTTP 경계다. 전달용 Facade나 중앙 저장 DAO는 추가하지 않는다.

## ERD와 실제 처리 연결

기준 문서는 [작품·집필·발행](design/erd/core/work-and-writing.md), [세계관](design/erd/core/world.md), [Fork·체크포인트](design/erd/core/fork-and-checkpoint.md), [AI 작업](design/erd/core/ai-work.md)다. 논리 후보 전체를 구현 완료로 취급하지 않는다. 이번 변경은 새로운 테이블을 만들지 않고 현재 물리 스키마·외부 계약을 보존한다.

| 실행 동작 | 담당 서비스 → 기존 저장 관계 | 동작 검증 |
|---|---|---|
| 회차 생성·초안 수정 | EpisodeService → episode, episode_draft | WritingPostgresTest, EpisodeConcurrencyPostgresTest: 번호 생성·소유권·revision 충돌 |
| 수동 저장·복원 | EpisodeVersionService → episode_version, work_world_history, checkpoint/episode/setting | WritingPostgresTest: 새 불변 버전·롤백·재조회·발행본 보존 |
| 선택 버전 발행 | PublicationService → publication_event, work_publication_history, work_rights_declaration | ContentPostgresTest: 권리·발행 순서·상속 회차 보호 |
| 설정 초안·확정·공개 범위 | WorldService → setting_document/draft/version, setting_visibility_history/range, 태그·지식 범위 | ContentPostgresTest: 외부 작품 범위가 현재 설정을 삭제하거나 과거 공개본을 되살리지 않음 |
| Fork 생성·최초 수정·원본 변경 선택 | ForkService와 WorldService → fork, fork_world_reference, checkpoint, fork_source_change/decision/application | ContentPostgresTest: 추종→독립→선택 적용, 최초 기준 보존 |
| 문맥 조회·AI 제안·명시 적용 | ContextService·ProposalService → ai_job/model_call/input_snapshot/proposal/evidence, proposal_decision/application/episode_change | ContentPostgresTest: 실패 기록, stale 문맥 거부, 사용자 승인 후 정확한 결과 버전 연결 |

Entity만 정의하고 성공 응답을 반환하는 구현이 아니다. Controller에서 실제 Service와 JpaRepository를 호출하며, PostgreSQL 통합 테스트가 저장 행과 FK·이력·롤백 결과를 확인한다. 기존 조회 VIEW는 파생 조회로 유지한다. `content_only` 체크포인트는 원고·설정만 포함하며 인물 상태·관계 그래프 완료를 의미하지 않는다.

## 저장·동시성

- 콘텐츠는 JPA Repository이며 직접 SQL은 Auth의 기존 JDBC와 content/migration의 과거 V5 이관에만 남는다.
- 기존 CORE_DATABASE_* Auth 연결과 CONTENT_DATABASE_* 콘텐츠 연결을 분리한다. 기본 TransactionManager는 Auth JDBC, 콘텐츠 유스케이스는 contentTransactionManager를 명시한다.
- CONTENT_ENABLED=false이면 콘텐츠 JPA 자동 초기화를 하지 않는다. Hibernate는 Flyway 적용 후 validate만 수행한다.
- 작품·원작 행 잠금은 ID 순서로 획득한다. 잠금 전 읽은 Entity는 최신 상태를 다시 읽고 revision을 비교한다. 전체 영속성 컨텍스트 clear로 다른 작업의 변경 추적을 끊지 않는다.
- 원고·버전·체크포인트, 제안 승인·원고·실제 결과 버전·반영 기록은 각각 같은 트랜잭션에서 처리한다. 외부 AI 호출 동안 트랜잭션을 유지하지 않는다.
- PostgreSQL 저장 정밀도에 맞춰 새 시각을 마이크로초로 기록하여 저장 직후와 재조회 응답이 달라지지 않게 한다.

## Flyway와 데이터 보존

SQL은 db/migration/auth 및 db/migration/content에 배치한다. 기존 두 이력 테이블·V1~V8·SQL 내용을 보존하고 과거 공통 이력을 도메인별 새 이력으로 재실행하지 않는다. 이름이 바뀌었던 V1/V2/V6은 실제 적용 이력의 원래 파일명을 복구한다. repair·이력 삭제·DB 초기화는 하지 않는다.

V5와 당시 모델·JDBC 구현은 content/migration에 격리한다. 테스트의 과거 계약 adapter와 JDBC fixture는 test 소스에만 있으며 실제 기능은 새 서비스·JPA를 실행한다. 기존 권한·문맥·이력·롤백 assertions는 유지한다.

## 보류·제외

- 회차 삭제 API·UI·cascade 삭제·soft-delete 필드는 추가하지 않는다. 중간 회차 삭제·번호 재사용·참조 보존 정책은 별도 확정한다.
- 전체 인물·지식·관계 그래프 체크포인트, 운영 부하·페이지네이션·크레딧·자동 발행은 구현하지 않는다.
- 프런트 화면·Auth 업무 로직·실제 .env·모델 설정은 변경하지 않는다. 새 서버·인프라는 추가하지 않는다.
- 유료 OpenAI 호출, 전달은 사용자 추가 요청에 따라 개인 브랜치 커밋·푸시 및 develop 대상 Draft PR으로 진행한다.

## 이번 검증

2026-11-03, `fullstack-content`의 구현에서 아래 로컬 검증을 실행했다. 이후 사용자 요청으로 Draft PR 전달을 진행한다.

- TDD: 책임 경계 테스트 실패 후 분리 구현, 동시 편집의 캐시된 revision 회귀 실패 후 잠금 시 재조회, PostgreSQL 시각 정밀도 회귀 후 마이크로초 정규화, HTTP 바인딩 실패의 400/422 구분을 검증했다. 기존 권한·이력·롤백 검증은 유지했다.
- Core: 실제 PostgreSQL 테스트와 Auth 통합을 활성화한 `./gradlew.bat clean test --no-daemon`: 총 140개 중 138개 통과, 실패 0개, SMTP 통합 2개 스킵. 최종 진단 코드 제거 후 영향 범위 12개를 다시 실행해 모두 통과했다.
- 네이티브 실행: Windows에서 uv에 전달하는 루트 `.env` 경로의 역슬래시 해석 오류를 경로 표기 정규화로 수정했다. `python -m unittest discover -s infrastructure/tests -p test_content_environment.py`: 5개 통과. 실제 `.env`는 변경하지 않았다.
- 기존 DB 업그레이드: 기존 검증 DB를 복제한 `issue84_upgrade_test`에서 양쪽 Flyway 검증 및 Hibernate validate 성공. 사용자 시나리오 실행 전 51개 테이블의 행 수·내용 해시 불변을 확인했다. 이후 E2E가 만든 합성 데이터는 이 복사본에만 남는다. SQL 10개는 CRLF/LF 차이를 제외하고 기존 내용과 동일하다.
- Aside: `http://127.0.0.2:5184/content`와 `/studio/594f5d4a-d230-4103-ab77-da977d7be213`에서 실제 로그인→작품 생성→원고 저장→설정 초안/확정→문맥 조회→검증 대역 제안 생성/명시 적용→선택 버전 발행→자동저장→수동 저장/복원→2화 생성·수정→두 창 편집 충돌 및 입력 보존→다시 불러오기 확인. Fork 생성·설정 승계·최초 수정 시 독립·기준 원고 읽기 전용, 타인 집필실 접근 거부도 확인했다.
- DB 대조: 위 화면 조작 후 원작 저장 버전 4개, 발행 사건 1개, 제안 실제 반영 1개, Fork `independent` 상태를 확인했다. AI는 외부 API를 호출하지 않는 명시적 로컬 검증 대역이다. 초기 대역의 chunked HTTP 처리 실패를 고친 뒤 성공 흐름을 재실행했다. 실제 유료 모델 검증으로 표현하지 않는다.
- Ponytail 리뷰: 기존 단일 작가 검증 규모와 동시 요청의 무결성을 기준으로 호출자·저장 경로를 확인했다. 전역 EntityManager clear 제거, 잠금 순서 통일·캐시 재조회, 불필요한 import 정리를 반영했다. 추가 Facade·범용 DAO·빈 미래 기능은 넣지 않았다. 대규모 목록 부하와 페이지네이션은 이번 범위 밖이며 운영 규모 검증으로 주장하지 않는다.
- Graphify AST 업데이트 완료(4,712 노드, 10,500 간선). SQL 파서 의존성 부재로 SQL 관계는 직접 소스·실제 DB로 대조했다. 문서 의미 그래프를 새 유료 호출로 생성하지 않았다. `git diff --check` 통과.

로컬 증거: `C:/Users/playdata2/Documents/ChatGPT/artifacts/issue84/`의 `core-clean-test-summary.json`, `core-clean-junit/`, `upgrade-preservation-result.json`, `sql-preservation.json`, `browser-db-result.json`, `aside-e2e/`. Aside 원본 세션은 `C:/Users/playdata2/.aside/u/0/sessions/2026-11-03_xhGt524tJ48TeqUE/`다. PNG는 전체 화면 캡처 시간 초과 후 제공된 viewport 캡처이며 텍스트 snapshot과 DB 결과를 함께 증거로 사용한다.

## 검증 대기와 정확한 한계

- Draft PR 준비 시 fetch한 최신 develop `fcee0e8`에는 #88 Auth JPA 전환이 추가되었다. 위 로컬 결과는 기존 Auth JDBC 기반 브랜치 결과다. 새 Auth EntityManager·Repository 스캔·트랜잭션 구성과의 통합은 별도 확인이 필요하며 최신 develop 호환 통과를 주장하지 않는다.

- 이번 구현의 Required CI는 실제 통과 확인 전이다. CI의 Core·인프라 경로 조건에는 변경 경로가 포함되지만 전체 검증 완료로 선언하지 않는다.
- Docker 실제 기동, 운영 부하, 외부 유료 모델, SMTP 2건은 미검증이다. 삭제 정책/API는 보류하며 삭제 시나리오 통과를 주장하지 않는다.
- `aside-browser`라는 정확한 이름의 SKILL.md는 확보하지 못했다. 설치된 공식 Aside CLI의 `aside guide`, `aside guide repl`, 내장 브라우저 지침으로 위 실제 E2E를 수행했다. 정확한 필수 스킬 파일까지 충족했다고 주장하지 않는다.
- 원본 변경의 독립 후 선택 반영·거절, 세부 400/401/403/404/409/422 경계는 PostgreSQL·HTTP 자동 테스트로 검증했다. 이번 Aside 세션에서 그 모든 조합을 반복한 것은 아니다.
