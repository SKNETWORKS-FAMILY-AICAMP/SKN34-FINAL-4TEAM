# WorldStudio 독립 초기 migration

> **현재(플래그 제거 후):** WorldStudio는 기능 플래그 없이 항상 켜지고, 전용 schema는 Content 서버 시작 시 `WorldStudioConfig`가 Flyway로 migrate·validate한다. 별도 `worldstudio-migrate` 명령·`WORLDSTUDIO_CD_MIGRATION_ENABLED` 승인 변수·`APP_WORLDSTUDIO_ENABLED`는 삭제됐다. 아래의 opt-in·명시 실행 설명은 과거 기록이다.

이 디렉터리는 기존 독립 V1 바이트와 additive `V2__neo4j_current_relationship_state.sql`을 둔다. 이전 Content 확장 V1/V2는 저장소의 `docs/archive/worldstudio-content-extension/`에 원본 바이트로 보존했다. 자동 import·기존 Content 테이블 변경·기존 관계 데이터 삭제는 하지 않는다.

> **#132 현재 상태 MVP:** 관계 정본은 Neo4j 현재 상태 하나다. V2는 관계 내용 없이 graph token·key/hash·예상 draft revision·완료 여부만 PG에 추가한다. 기존 V1의 관계/버전 테이블은 보존하지만 새 경로가 관계 payload를 쓰지 않는다. Content HTTP·프론트 연결은 소스 구현이며 실제 이관·hosted CI·배포 완료가 아니다. 짧은 PG prepare → transaction 밖 Neo4j CAS → PG finalization으로 처리하고 과거 카드 revision은 관계 `null/not_recorded`, 전체 restore는 미지원이다. 아래 V1 당시의 `@Transactional`·관계 version/restore·HTTP 미연결 설명은 역사적 기록이며 [최신 계약](../../../../../../../../docs/design/worldstudio-independent-schema.md#현재-관계-mvp-계약--132)을 우선한다. 기존 데이터 이관·migration 실제 실행은 별도 승인 대상이다.

## 실행 계약

> **Core→Content 추출 후 현재 계약:** 명시 main은 Content 이미지의 `ai.storyfork.content.world.migration.WorldStudioMigration`이며 기존 같은 DB를 `DATABASE_URL/USER/PASSWORD`로 받는다. 서버는 `contentDataSource`와 studio-only EntityManager/TransactionManager로 validate만 하며 Auth를 스캔하지 않는다. CD는 fresh 전환 승인 후 ingress/구 writer 중지 → opt-in migration → 새 앱 시작 순서이며 실패 시 ingress를 멈춘 채 자동 rollback하지 않는다. 로컬은 선택 순수 `unitTest`만 허용하고 아래 PostgreSQL/통합 명령은 hosted CI 전용이다. **아래 Core 패키지·기본 persistence unit·통합 로컬 실행 설명은 추출 전 기록으로 사용하지 않는다.** 최신 [Content 안내](../../../../../../README.md)와 [배포 계약](../../../../../../../../docs/deployment/worldstudio-v1-rollout.md)을 우선한다.

기존 서버의 Auth Flyway location과 DataSource는 변경하지 않았다. 이 migration은 평소 서버 시작에 실행되지 않는다. 독립 JPA Repository·Service는 이 schema를 사용하며 HTTP API·기존 UI와는 아직 연결하지 않았다.

명시 실행 시 기존 Flyway API의 다음 설정을 사용한다. 입력은 기존 `DATABASE_URL/USER/PASSWORD`를 사용하며 실제 Core 개발 DB에 대한 allowlist·백업 복원 증거를 확인한다. 별도 접속 설정은 두지 않는다.

```java
Flyway.configure().dataSource(confirmedUrl, user, password)
    .locations("classpath:db/migration/worldstudio")
    .schemas("worldstudio").defaultSchema("worldstudio")
    .table("world_studio_schema_history")
    .load(); // migrate(), validate()는 명시적 실행 단계에서만 호출
```

`baselineOnMigrate`·`baseline`·`repair`를 켜지 않는다. 기존 worldstudio schema/history가 없거나 이 독립 V1의 이력이 있는 검증된 대상만 허용한다. 전용 schema가 이미 비어 있지 않은데 이력이 없으면 Flyway 기본 정책으로 거부한다. 이전 확장 SQL이 적용된 DB는 실행 대상이 아니며 별도 전환 설계가 필요하다. 이력 조회가 불가능하면 미확인 상태로 남기고 적용하지 않는다.

개발 CD는 기존 Core 이미지의 `ai.storyfork.core.world.migration.WorldStudioMigration`을 별도 명령으로 실행한다.
기본 비활성이며 확인된 개발 DB allowlist·백업 복원 기록·명시 활성화 후에만 migrate/validate 성공을 조건으로 새 Core를 기동한다.
공용 DB 적용 여부·환경 승인·복구 책임은 [배포 실행 계약](../../../../../../../../docs/deployment/worldstudio-v1-rollout.md)을 따른다.

과거 이력 차단은 다른 schema의 `world_studio_schema_history` 또는 기본 `flyway_schema_history`에서 아래 **성공한 SQL 이력**만 식별한다. 버전·스크립트명·체크섬·type=SQL·success=true가 모두 일치해야 한다. 이름이나 V1/V2 번호만으로 차단하지 않는다. 정상 타 도메인이 같은 버전·파일명·이력 테이블명을 사용해도 체크섬이 다르면 허용하고, 실패·baseline·불완전 행은 적용된 SQL로 취급하지 않는다. 이력 테이블은 읽기만 한다. 미확인 변형 이력을 자동 import·repair하는 기능은 없다.

| version | script | Flyway CRC32 (signed int) |
|---|---|---|
| 1 | V1__initial_world_schema.sql | 943880700 |
| 2 | V2__protect_world_revision.sql | -391778711 |

이는 보관된 원본 SQL과 설치된 Flyway의 체크섬 계산 API를 대조한 값이며 다른 도메인 소유권을 버전 번호로 추정하지 않는다.

## 독립 JPA Service

`app.worldstudio.enabled=true`일 때만 `WorldStudioConfig`가 EntityScan/Repository 등록을 추가한다. Service의 `@Service`도 같은 조건으로 등록한다. AuthPersistenceConfig의 명시 스캔과 합쳐 Core의 기존 기본 DataSource·EntityManager·TransactionManager를 공유한다. 별도 Hikari pool/persistence unit/접속 환경변수는 없다.

`WorldStudioService`는 생성자 주입과 기본 `@Transactional`을 사용한다. 소유권 잠금 조회를 포함한 외부 작업 하나가 하나의 쓰기 가능한 트랜잭션이다. Hibernate는 Core의 기존 `validate`만 수행한다. 활성화 전에 독립 migration이 완료되어야 하며, 비활성 상태에는 WorldStudio Entity/Repository/Service가 등록되지 않아 테이블 없이도 기존 Core가 시작된다. PostgreSQL 오류 DETAIL 억제도 기존 Core 설정을 따른다.

`WorldStudioService`의 create/edit/draft/save/revision/restore는 DTO를 사용한다. `subject: UUID`는 검증된 JWT에서 호출 계층이 추출해야 하며 요청 본문에는 ownerId가 없다. HTTP 인증·Controller·기존 작업실 UI 연결은 이 작업의 범위 밖이다. 읽기/쓰기 모두 소유 world를 먼저 잠그고 확인한다. 현재는 짧은 DB 작업을 world별로 직렬화한다.

## 저장 트랜잭션 계약

Service는 검증된 JWT subject를 인자로 받아 world.owner_subject를 먼저 대조하고 world별 잠금을 잡는다. 이어 world_draft.draft_revision을 비교한다. 요청 body ownerId나 체험 actor는 소유권의 근거가 아니다. Service 검증을 실제 JWT/HTTP 인증 구현으로 표현하지 않는다.

멱등 키는 `(world_id, request_key)`로 유일하며 Service에서 1~200 UTF-8 바이트로 제한한다. SHA-256 입력은 operation/world ID/expected draft revision/restore 기준 ID다. 모든 초안 변경이 revision을 증가시키므로 동일 world의 잠긴 revision이 전체 초안을 식별한다. 같은 key/hash는 처음 저장한 정확한 revision을 반환하고, 같은 key의 다른 요청은 충돌로 거절한다. 이 판단과 저장은 같은 트랜잭션/잠금 안에서 수행한다. HTTP 재시도 연결은 후속 API의 책임이다.

새 version과 revision을 생성하고 manifest를 조립한 뒤 `sealed=true`로 갱신한다. 활성 관계의 양 endpoint는 해당 revision의 활성 카드여야 한다. 마지막으로 current pointer와 멱등 성공 기록을 갱신하고 커밋한다. 미봉인 revision은 지연 제약으로 커밋을 거부한다. 확정 뒤 version·manifest·revision·멱등 기록을 변경/삭제할 수 없다. DB 관리자에 의한 trigger 비활성화 등은 애플리케이션 무결성 보장 범위가 아니다.

복원은 원래 논리 ID를 유지한 새 version/revision 생성이다. 카드·관계의 전체 필드와 visibility를 복사한다. 명시적 restore는 예상 draft revision을 확인한 뒤 현재 초안을 선택한 과거 확정본 전체로 교체한다. 과거 version·manifest·논리 ID는 삭제하지 않는다. 실패하면 초안 교체·새 버전·포인터·멱등 기록 전체가 롤백된다. 저장은 발행과 다르며 카드 visibility가 public이어도 공개 조회 권한을 자동 부여하지 않는다. 회차별 공개·지식, Fork 및 Graph/AI/이미지는 범위 밖이다.

관계의 direction은 기존 제안의 directed/symmetric, category는 structural/emotional을 사용한다. polarity는 미정인 API 코드 체계를 강제하지 않는 nullable 원문 필드다. 감정의 복합성은 body에 그대로 보존하며 polarity를 감정 분류로 자동 변환하지 않는다. 향후 허용 코드·정규화 정책은 별도 합의가 필요하다.

## 검증 실행

기존 테스트 의존성의 Flyway와 PostgreSQL 드라이버를 사용한다. 추가 라이브러리는 없다. 별도 일회용 PostgreSQL의 테스트 전용 superuser URL/user/password와 `TEST_WORLDSTUDIO_DISPOSABLE=true`를 테스트 프로세스에만 전달하고 다음 선택 테스트를 실행한다. 실제 `.env`를 source하거나 공유하지 않는다.

```text
./gradlew unitTest --tests '*WorldStudioServiceTest' --tests '*WorldStudioMigrationIdentityTest' integrationTest --tests '*WorldStudioServicePostgresTest' --tests '*WorldStudioFlywayPostgresTest' --tests '*WorldStudioHistoryPostgresTest' --no-daemon
```

각 fixture는 `ws_independent_<uuid>` DB를 생성하고 자신이 만든 DB만 제거한다. 독립 SQL은 Auth/Content 없는 DB에서, 공통 JPA는 Auth를 포함한 Core 기본 연결에서 Content 없이 저장·복원·과거 조회·커밋 실패·동시성·무결성을 검증한다. CI도 전용 임시 PostgreSQL service에서만 실행한다. 사용자·공용 개발·운영 DB에 이 환경변수를 설정하지 않는다.

이미 실행한 Content 공존 검증은 일회성 데이터 보호 회귀다. 그 테스트만 별도로 `TEST_WORLDSTUDIO_COEXISTENCE_ONCE=true`를 지정했을 때 실행하도록 보존했으며 기본 검증 명령에는 포함하지 않는다. Content V1~V7은 독립 WorldStudio의 선행 조건이 아니다.
