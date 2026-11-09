# 콘텐츠 서비스 구현 지침

`backend/content-service/**`에 적용한다. [루트 공통 지침](../../AGENTS.md)과 [콘텐츠 이관·서비스 연동 계약](../../docs/design/content-service-migration-contract.md)을 함께 따른다.

- 작품·에피소드·원고·버전·세계관·WorldStudio·Fork·발행·콘텐츠 첨부와 콘텐츠 인가를 담당한다. 다른 서비스의 Entity·Repository·DB를 직접 쓰지 않는다.
- Kotlin 패키지는 `ai.storyfork.content`다. 기능별 Controller → Service → Repository 구조와 JPA를 사용한다.
  공개 DTO는 `service/dto`, 외부 계약은 `client/dto`에 두고 Entity를 HTTP로 노출하지 않는다.
  그 밖의 레이어·DTO·이름 규칙은 [Core 지침](../core-api/AGENTS.md)을 이 앱의 패키지에 맞춰 적용한다.
- 인증은 `CoreAuthClient`(Spring HTTP Service proxy)로 Core `POST /internal/v1/auth/verify`를 호출한다.
  사용자 Bearer와 `X-Content-Service-Token`을 함께 보내고 검증된 회원 UUID만 Principal로 쓴다. JWT 서명 키·Core Entity를 가져오지 않는다.
- 기존 API·CSRF·UUID·revision·잠금·불변 이력을 유지한다.
- Flyway: 콘텐츠 스키마는 `ContentPersistenceConfig.MIGRATION_LOCATIONS`의 `db/migration/{work,episode,world,episode_version,publication,fork,proposal,plan,sample}`와
  단일 `content_schema_history`다. 버전은 경로를 가로질러 전역으로 매기며(현재 V1~V17) 새 SQL은 최댓값 다음 번호를 쓴다.
  `sample/V16`은 CSV에서 생성한 개발 샘플 행이며 직접 편집하지 않는다. 샘플 변경은 다음 번호의 새 마이그레이션으로 한다.
  `db/migration/content`·root 직하 SQL을 다시 만들지 않는다. Auth·첨부·WorldStudio SQL 이력은 보존하고 자동 repair/reset하지 않는다.
- WorldStudio는 `contentDataSource`를 재사용하고 시작 시 전용 schema(`world_studio_schema_history`)를 migrate한 뒤 전용 EntityManager/TransactionManager로 validate한다. 별도 DB·분산 transaction을 추가하지 않는다.
- 장르 템플릿 세계관은 SQL 마이그레이션이 아니라 `GenreTemplateSeeder`가 서버 시작 시 `WorldStudioService`(create → edit → save)로
  Core `auth/V8` 운영 관리자(`GenreTemplateSeeder.TEMPLATE_OWNER`, 임시 할당) 소유 WorldStudio 세계관으로 적재한다. 리소스는 `genre-templates.json`이며
  소유자 한계(공개 비밀번호·소유자 불일치·타 사용자 미노출)를 포함한 [설계](../../docs/design/worldstudio-independent-schema.md#플랫폼-장르-템플릿-세계관)를 따른다.
- 로컬은 이 디렉터리에서 `./gradlew unitTest --tests 'ai.storyfork.content.<대상 클래스>' --no-daemon`으로 순수 단위만 실행한다.
  Spring/HTTP/DB/Flyway 검사는 CI `integrationTest`에서 실행한다.
