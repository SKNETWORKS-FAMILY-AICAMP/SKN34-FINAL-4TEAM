# 콘텐츠 서비스 구현 지침

`backend/content-service/**`에 적용한다. [루트 공통 지침](../../AGENTS.md)과 [콘텐츠 이관·서비스 연동 계약](../../docs/design/content-service-migration-contract.md)을 함께 따른다.

- 작품·에피소드·원고·버전·세계관·WorldStudio·Fork·발행·콘텐츠 첨부와 콘텐츠 인가를 담당한다. 다른 서비스의 Entity·Repository·DB를 직접 쓰지 않는다.
- Kotlin 패키지는 `ai.storyfork.content`다. 기능별 Controller → Service → Repository 구조와 JPA를 사용한다.
  공개 DTO는 `service/dto`, 외부 계약은 `client/dto`에 두고 Entity를 HTTP로 노출하지 않는다.
  그 밖의 레이어·DTO·이름 규칙은 [Core 지침](../core-api/AGENTS.md)을 이 앱의 패키지에 맞춰 적용한다.
- 인증은 `CoreAuthClient`(Spring HTTP Service proxy)로 Core `POST /internal/v1/auth/verify`를 호출한다.
  사용자 Bearer와 `X-Content-Service-Token`을 함께 보내고 검증된 회원 UUID를 Principal로 쓰고 Core가 알려 준 운영자 여부(`operator`)는 `ROLE_OPERATOR` authority로만 쓴다. JWT 서명 키·Core Entity를 가져오지 않는다.
- 작성자·작가 표시명은 저장하지 않는다. 응답마다 `CoreNicknameService`(같은 `CoreAuthClient`, 서비스 토큰만)로 회원 ID 묶음을 한 번 조회해 채우며, Core에 없으면 `탈퇴한 회원`, 호출 실패는 503/504/502로 응답하고 대체 이름을 쓰지 않는다. Content↔Core 테이블 JOIN은 없다.
- 기존 API·CSRF·UUID·revision·잠금·불변 이력을 유지한다.
- Flyway: 콘텐츠 스키마는 `ContentPersistenceConfig.MIGRATION_LOCATIONS`의 `db/migration/{work,episode,world,episode_version,publication,fork,proposal,plan,sample}`와
  단일 `content_schema_history`다. 버전은 경로를 가로질러 전역으로 매기며(현재 V1~V31·V36·V37, V24는 결번이며 V32~V35는 열린 PR 몫) 새 SQL은 최댓값 다음 번호를 쓰고 결번은 채우지 않는다(`outOfOrder` 미사용).
  `sample/V16`은 CSV에서 생성한 개발 샘플 행이며 직접 편집하지 않는다. 샘플 변경은 다음 번호의 새 마이그레이션으로 한다.
  `db/migration/content`·root 직하 SQL을 다시 만들지 않는다. Auth·첨부·WorldStudio SQL 이력은 보존하고 자동 repair/reset하지 않는다.
- WorldStudio는 `contentDataSource`를 재사용하고 시작 시 전용 schema(`world_studio_schema_history`)를 migrate한 뒤 전용 EntityManager/TransactionManager로 validate한다. 별도 DB·분산 transaction을 추가하지 않는다.
- 장르 템플릿 세계관은 SQL 마이그레이션이 아니라 `GenreTemplateSeeder`가 서버 시작 시 `WorldStudioService`(create → edit → save)로
  Core `auth/V8` 운영 관리자(`GenreTemplateSeeder.TEMPLATE_OWNER`, 임시 할당) 소유 WorldStudio 세계관으로 적재한다. 리소스는 `genre-templates.json`이며
  소유자 한계(공개 비밀번호·소유자 불일치·타 사용자 미노출)를 포함한 [설계](../../docs/design/worldstudio-independent-schema.md#플랫폼-장르-템플릿-세계관)를 따른다.
  템플릿 카드는 공개(`visibility=public`)로 넣고 세계관 자체의 공개 범위는 건드리지 않는다(DEC-46).
- 설정 카드는 기본 비공개다. 공개 세계관 조회는 공개 카드와 그 카드끼리의 관계만, 독자 설정 위키(`GET /api/v1/public/works/{id}/world-cards`)는
  카드의 독자 공개 회차(`semanticMetadata.revealFromEpisode`)가 발행된 회차 안인 카드만 서버에서 걸러 보낸다. 두 기준은 서로 별개이며 화면에서 거르게 두지 않는다(DEC-46).
- 세계관과 소설은 1:1이다. 연결의 정본은 `work.world_studio_id`(UNIQUE) 하나이고 `WorkWorldService`가 맡는다. Content와 WorldStudio 트랜잭션은 겹치지 않게 차례로 연다.
- 로컬은 이 디렉터리에서 `./gradlew unitTest --tests 'ai.storyfork.content.<대상 클래스>' --no-daemon`으로 순수 단위만 실행한다.
  Spring/HTTP/DB/Flyway 검사는 CI `integrationTest`에서 실행한다.
