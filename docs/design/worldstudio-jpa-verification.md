# PR #98 Core 기본 JPA 재사용 검증 계약

팀 리뷰 반영: 독립 스키마·SQL·이력·업무 규칙은 유지하며 기존 Core DataSource/EntityManager/TransactionManager를 공유한다.
조건부 EntityScan/Repository와 @Service/@Transactional을 사용한다. 전용 Hikari/접속 환경변수/TransactionTemplate 및 수동 Service Bean은 제거했다.
갱신 테스트는 활성·비활성 시작, 미적용 상태 활성화 실패, 단일 기본 JPA 인프라와 Auth 매핑 공존,
Core 연결을 통한 카드 8종 저장·과거 조회·복원·실패 롤백·소유권·충돌·멱등 동시성을 검증한다.
로컬은 선택 단위·설정 검사만 수행하며 PostgreSQL/시작 검증 결과는 PR #98 최신 head CI에 기록한다.

리뷰 반영 코드 `48de6a126e06e4ed59c87da845713f487ac26de5`의 [CI 41778704723](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/actions/runs/41778704723)은 Required CI를 포함한 10개 job이 성공했다.
Core 단위·PostgreSQL 통합 및 실제 Docker 이미지/HTTP 시스템 검증을 실행했다. 공통 JPA 인프라 단일성·Auth 공존·활성/비활성/미적용 시작 계약과 기존 저장·복원·실패 롤백·동시성 회귀를 통과했다.
로컬 선택 구성 단위 12건과 migration profile Compose 구문 검사를 통과했다. 로컬 DB·컨테이너·전체 빌드·브라우저는 실행하지 않았다.
첫 리뷰 반영 CI의 임시 PostgreSQL 연결 한도 초과는 테스트 기본 풀만 3개로 제한해 해결했다. 런타임 풀 설정이나 공용 DB를 변경하지 않았다.
최종 ponytail-review에서 전용 인프라·중복 Repository·새 persistence unit·업무 로직 변경이 없음을 대조했고, 공통 JPA 시작과 업무 독립성을 구분하도록 문서를 보완했다. 반영하지 않은 범위 내 지적은 없다.
**아래는 #97의 이전 전용 인프라 검증 기록이며 현재 구성의 새 검증 결과가 아니다.**

# WorldStudio 독립 JPA 저장소·Service 검증

2026-11-04. 현재 제출 범위는 독립 V1·JPA Repository·Service·관련 테스트/문서를 팀원 검토용 Ready 일반 PR로 전달하는 것이다. HTTP API·프런트·회차·이미지·Graph 연결과 실제 DB 적용·PR 병합은 포함하지 않는다.

## 현재 구현

- `WorldStudioConfig`: 명시 활성화 시에만 전용 WORLDSTUDIO_DATABASE_URL/USER/PASSWORD, bounded Hikari pool, EntityManager, JPA 트랜잭션 관리자를 구성한다. Core/Content DataSource fallback과 Auth/Content 초기화 의존은 없다. Hibernate는 validate만 수행하며 migration은 명시 실행한다.
- `world/entity`, `world/repository`: 독립 12개 테이블을 JPA Entity·Spring Data JpaRepository로 매핑한다. 같은 카드 필드를 초안/버전이 재사용하는 Embeddable과 복합 식별자만 둔다. SQL 저장소·native query·Content member/world/setting 참조는 없다.
- `WorldStudioService`: 검증된 UUID subject를 받아 소유 world를 먼저 확인하고 잠근다. create/edit/draft/save/revision/restore가 DTO를 사용하며 Entity를 공개하지 않는다. HTTP JWT 검증·Controller는 이번에 추가하지 않았다.
- 초안 편집은 생략한 항목을 유지하고 주어진 항목만 추가/수정한다. 8종 card_type·7종 area_code, 태그 순서·중복 별칭·원문·metadata·visibility를 보존한다. 빈 카드 원문·미완성 관계는 초안으로 저장할 수 있으나 확정 시 검사한다. 카드나 관계 전체 메뉴를 필수로 요구하지 않는다.
- 확정은 world별 잠금과 예상 draft revision 검증 후 버전/manifest 조립→봉인→현재 포인터→멱등 기록을 한 트랜잭션으로 처리한다. 명시 저장은 발행이 아니다. DB 커밋 실패를 성공으로 반환하지 않는다.
- 멱등 hash는 operation/world/expected draft revision/restore 기준 ID의 SHA-256이다. 모든 초안 변경이 revision을 증가시킨다. 같은 키·같은 요청은 최초 확정본을 재반환하고, 다른 요청은 충돌로 거부한다.
- 복원은 과거 확정본의 카드·관계 전체를 새 버전으로 만든다. 원래 논리 ID와 과거 이력은 유지한다. 예상 draft revision을 확인한 명시적 복원은 현재 초안을 해당 확정본으로 교체한다. 실패하면 초안·버전·포인터·멱등 기록 전체가 롤백된다.

## 이력 식별 수정

기존의 ‘다른 schema에 동명 history가 존재하면 차단’ 조건은 제거했다. 알려진 보관 SQL의 version/script/Flyway checksum/type=SQL/success=true가 모두 일치할 때만 과거 확장 이력으로 식별한다.

| version | script | 실제 Flyway checksum |
|---|---|---|
| 1 | V1__initial_world_schema.sql | 943880700 |
| 2 | V2__protect_world_revision.sql | -391778711 |

보관 SQL 바이트의 SHA-256은 [원본 보관 기록](../archive/worldstudio-content-extension/README.md)을 따른다. 설치된 Flyway 12.4.0 API로 CRC32를 직접 계산하는 단위 테스트를 추가했다. 다른 도메인의 실제 V1/V2가 동일 이력 테이블명·스크립트명을 써도 체크섬이 다르면 허용하고, 원래 이력과 데이터를 변경하지 않는지 검사한다. 실패·baseline·불완전 행은 적용된 SQL로 오인하지 않는다. 알려지지 않은 변형 SQL을 자동 이관/repair하는 기능은 없다.

## 이전 구현 검증과 이번 PR 재확인

독립 기능의 DB 검증은 **Auth·Content가 없는 일회용 PostgreSQL 17.11 DB**에서 수행한다. 기존 QA 컨테이너를 재사용하지만 각 fixture는 별도의 `ws_independent_<uuid>` DB만 생성/제거한다. 실제 `.env`, 기존 QA DB, 공용 DB에는 쓰지 않는다. 검증 프로세스에는 테스트 전용 접속 값만 전달한다.

| 단계 | 실제 결과 |
|---|---|
| 이력 식별 TDD Red | 정상 이력/실패 이력 오차단과 기본 history의 과거 V2 누락, 총 3개 회귀 재현. `output/identity-red.log`, `output/identity-red-results/` |
| JPA TDD Red | 먼저 작성한 소유권·충돌 테스트가 구현 부재로 compileTestKotlin에서 실패. `output/jpa-red.log` |
| 첫 JPA Green | DB 회귀 8건 통과. WorldStudio 단위 3건 통과. 초기 명령에서 태스크 필터가 integrationTest에만 적용돼 전체 단위 34건이 실행됐으며 모두 통과했다. 최종 실행에서는 태스크별 필터로 관련 단위만 선택한다. `output/jpa-green.log`, `output/jpa-first-green-results/` |
| 이전 JPA 구현 최종 선택 실행 | 선택 단위 3건 + PostgreSQL 8건 + 설정 context 1건 통과. 실패·오류·skip 0건. `output/jpa-final.log`, `output/jpa-final-results/`, `output/jpa-final-summary.json` |
| 이번 PR 실제 재실행 | a6ce59f merge 후 unitTest/integrationTest에 각각 --rerun을 지정해 단위 3건·PostgreSQL 8건·설정 context 1건 통과. 실패·오류·skip 0건. `output/pr-worldstudio-rerun.log`, `output/pr-preparation/results/` |
| 이전 CI 선택·경계 순수 단위 | `python -X utf8 -m unittest test_ci.ConfigurationTest.test_core_context_http_and_db_tests_are_not_unit_tests test_ci.SelectionTest.test_workflow_calls_standard_frameworks_without_a_runner_layer` 2건 통과 |

추가 ad63576 merge는 프런트/문서 변경뿐이며 검증된 WorldStudio runtime/test SHA-256 manifest가 그대로임을 대조했다. 최종 head의 전체 영향 검증은 CI에서 확인한다.

이번 PR의 실제 재확인은 아래 두 테스트 task에 각각 `--rerun`을 추가했다. 첫 재확인이 up-to-date 캐시였던 점과 구분하며, Gradle 결과는 2 executed / 6 up-to-date다.

선택 명령:

```text
gradle unitTest --tests '*WorldStudioServiceTest' --tests '*WorldStudioMigrationIdentityTest' integrationTest --tests '*WorldStudioServicePostgresTest' --tests '*WorldStudioFlywayPostgresTest' --tests '*WorldStudioHistoryPostgresTest' --tests '*WorldStudioConfigIntegrationTest' --no-daemon --max-workers=2 --console plain
```

검증 SQL SHA-256은 `3f0689a58a02a3d7031526dee50619dbe7bdfd5029da03af10020a11d14e0a2a`다. 최종 summary에는 실행 대상 source/test SHA-256 manifest도 기록했다. 실행 종료 후 기존 `worldstudio_qa`의 public 테이블은 이전과 같은 0개이며 남은 fixture DB도 0개다. 기존 QA 컨테이너·캐시 이미지는 보존했다.

JPA PostgreSQL 테스트는 다음을 실제 Service/Repository로 검증한다.

1. Auth/Content가 없는 DB에서 독립 World 생성, 카드 8종·7영역·관계 저장, 확정 및 새 JPA context에서 재조회.
2. 수정 후 새 WorldRevision 생성, 지정한 과거 확정본의 원문·ID·버전 조회. 현재 수정이 과거 원문을 덮어쓰지 않음.
3. 비공개 V1→공개 V2→새 비공개 V3 복원, 새 version ID와 원래 restored-from 연결. 관계 원문과 논리 ID 보존.
4. 입력 오류 시 초안 보존, stale revision 거부, 다른 subject의 조회 거부, 다른 world의 카드·revision 참조 거부. 다른 subject 저장의 선행 거부는 별도 Service 단위 테스트로 확인했다.
5. 커밋 단계에 실패를 주입한 뒤 초안·포인터·카드 버전 24건·관계 버전 3건·멱등 기록 보존. Hibernate/DB 실패를 성공으로 대체하지 않음.
6. 동시 동일 키 재시도는 확정본 하나로 수렴. 다른 키의 같은 기준 revision 저장은 하나만 성공하고 하나는 충돌.

독립 SQL 회귀는 같은-world FK, immutable version/manifest/revision, 미봉인 commit 거부와 롤백, 활성 관계 endpoint 및 tombstone 제약, 실제 Flyway migrate/validate/재실행 0건을 계속 검증한다. 활성화하지 않으면 JPA/DB bean이 생기지 않는 설정 검사도 추가했다.

Content 공존 검증은 이전에 완료한 **일회성 데이터 보호 회귀**로만 남긴다. `TEST_WORLDSTUDIO_COEXISTENCE_ONCE=true`를 명시한 경우에만 별도 실행되며 이번 최종 명령에는 없다. Content V1~V7은 WorldStudio 실행·저장·검증의 선행 조건이 아니다. 기존 Auth·Content 코드·migration은 변경하지 않았다.

## 리뷰와 경계

ponytail-review에서 실제 저장 트랜잭션·소유권·동시성·복합 FK·재조회·실패 경로를 확인했다. DB DETAIL에 비공개 원문이 담길 수 있어 전용 pool에서도 logServerErrorDetail=false를 설정했고 설정 검사를 추가했다. 미사용 import 90개를 제거했다. 새 production 의존성·실행 서비스·전달 Facade는 추가하지 않았다.

## PR 제출 기준과 남은 결정

- Base는 develop, Head는 feature/world-studio-schema이며 [일반 PR #97](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97)을 Ready 상태로 생성했다. 직접 병합하지 않는다. 최신 head의 CI는 PR에서 확인한다.
- 최신 develop `ad635761e94544c013a80f7a13aaced4725bf16a`까지 일반 merge했다. 초기 a6ce59f의 기능표/지침과 추가 PR #83의 프런트 집필실 3개 파일·검토 문서 1개는 WorldStudio와 겹치지 않았고 충돌도 없었다. Auth·Content·이미지·회차 실행 코드와 migration에는 변경이 없다.
- SQL 보존 커밋은 `c384ee06580066606c20c6d9dc603a0f95d21310`, 독립 JPA 구현 커밋은 `a9045c4`다. 이후 검증·기능표·문서를 별도 커밋으로 전달한다. 실제 HEAD/파일 목록/CI는 PR을 기준으로 확인한다.
- 기능표의 기존 관련 동작 26행에 독립 JPA 내부 구현 범위를 표시했다. 미병합·HTTP 미연결 상태이므로 완료 체크는 모두 기존 ❌를 유지한다. 후속 API나 Graph 기능을 구현 완료로 올리지 않는다.
- 이전 개발 DB 배포 시도는 인증/접속·대상 확인 실패로 중단됐다. 백업·실제 migrate·개발 DB QA 쓰기를 하지 않았다. [배포 사전 확인](../deployment/worldstudio-v1-rollout.md)은 당시 기록이며 공용 DB 적용 성공의 증거가 아니다. 이번 PR 작업에서는 DB 접속도 시도하지 않는다.

**PR 병합만으로 자동 마이그레이션이 실행되는지는 미확정이다.** 현재 코드의 WorldStudioConfig는 validate만 수행하고 migrate를 자동 호출하지 않는다. 팀 배포 체인에서 사용할 명시적 Flyway 실행 주체/명령/시점/권한, 백업·복원과 기능 활성화 순서는 팀원 검토가 필요하다. 실제 팀 개발 DB의 적용 여부도 확인해야 한다.

WorldStudio는 검증된 UUID subject 계약만 전달받고 Auth/Content 테이블 FK·조회에 의존하지 않는다. HTTP 계층의 JWT 검증·호출 연결, 프런트, Graph, 이미지, 회차·Fork 연결은 이번 범위 밖이다. PR #86의 Content 재사용/공동 writer 방향과 다른 점은 [차이 목록](worldstudio-independent-schema-pr86-delta.md)을 검토한다. PR #86은 수정·병합하지 않는다.

Hosted CI는 PR의 최신 head에서 실제 결과를 확인한다. 실행 중·실패·취소는 통과로 기록하지 않는다. 전체 로컬 빌드·HTTP/브라우저 E2E는 실행하지 않았다. PostgreSQL 새 연결/JPA context 재조회를 실제 서버·브라우저 E2E로 표현하지 않는다. Graphify는 사용할 루트 그래프가 없어 실제 소스를 대조했다. 이전 update가 산출물 cache까지 탐색해 중단된 기록은 로컬에 보존하며 완성된 그래프 검증이라고 주장하지 않는다. 유료 LLM 호출과 추가 production 의존성은 없다.
