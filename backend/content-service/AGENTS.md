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
  단일 `content_schema_history`다. 버전은 경로를 가로질러 전역으로 매기며(현재 V1~V31·V36~V38, V24는 결번이며 V32~V35는 열린 PR 몫) 새 SQL은 최댓값 다음 번호를 쓰고 결번은 채우지 않는다(`outOfOrder` 미사용).
  `sample/V16`은 CSV에서 생성한 개발 샘플 행이며 직접 편집하지 않는다. 샘플 변경은 다음 번호의 새 마이그레이션으로 한다.
  `db/migration/content`·root 직하 SQL을 다시 만들지 않는다. Auth·첨부·WorldStudio SQL 이력은 보존하고 자동 repair/reset하지 않는다.
- WorldStudio는 `contentDataSource`를 재사용하고 시작 시 전용 schema(`world_studio_schema_history`)를 migrate한 뒤 전용 EntityManager/TransactionManager로 validate한다. 별도 DB·분산 transaction을 추가하지 않는다.
- 세계관 삭제는 소프트 삭제(WorldStudio V9 `world.deleted_at`)다. `StudioWorldRepository`의 `lockOwned`·내 목록·`listed`·`listedByGenre` 쿼리와 `PublicWorldService.listedWorld`·`readerSnapshot`, `WorldCoverService.read`·`WorldCardImageService.read`, `WorkWorldService.link`의 `findById` 확인이 `deletedAt`을 거르므로 새 조회·쿼리도 같은 조건을 둔다. 연결된 소설(`work.world_studio_id`)이 있으면 409 `WORLD_LINKED`이며 컨트롤러가 연결을 먼저 읽어 `WorldStudioService.delete`에 넘긴다(두 트랜잭션을 겹치지 않는다). 확정 버전 되돌리기(`WorldStudioService.restore`)는 초안의 카드만 되돌리고 관계·새 확정 버전은 건드리지 않으며, 사라질 카드가 현재 관계의 끝점이면 409 `WORLD_RESTORE_BLOCKED`다. [계약](../../docs/design/worldstudio-independent-schema.md#확정-버전으로-카드-되돌리기와-세계관-삭제-2026-11-17)
- 장르 템플릿 세계관은 SQL 마이그레이션이 아니라 `GenreTemplateSeeder`가 서버 시작 시 `WorldStudioService`(create → edit → save)로
  Core `auth/V8` 운영 관리자(`GenreTemplateSeeder.TEMPLATE_OWNER`, 임시 할당) 소유 WorldStudio 세계관으로 적재한다. 리소스는 `genre-templates.json`이며
  소유자 한계(공개 비밀번호·소유자 불일치·타 사용자 미노출)를 포함한 [설계](../../docs/design/worldstudio-independent-schema.md#플랫폼-장르-템플릿-세계관)를 따른다.
  새 템플릿은 세계관과 카드를 공개(`visibility=public`)로 생성한다. 기존 템플릿은 고정 입력·이력·관계가 모두 원본인 경우 한 번만 공개하고 세계관별 marker로 이후 비공개 선택을 보존한다(DEC-45·46).
- 확장 역사·전승 후보는 별도 `ExpandedTemplateSeeder`의 기본 꺼진 `app.worldstudio.expanded-seed-enabled`로 보호하며 #425의 권리·감수 선행조건을 확인하기 전에는 켜지 않는다. 플래그가 꺼져도 이미 시작한 미완료 marker는 같은 입력·hash로만 재개한다. 없는 세계관은 비공개 생성해 카드·관계 청크를 전부 기록하고 마지막 확정과 공개를 같은 PG 트랜잭션에서 처리한다. 기존 26종과 저장 완료된 역사 7종은 원본 검사를 통과할 때만 확장하며 옛 카드와 공개 선택을 보존한다. 미완료 중 공개 관계는 unavailable이고 사용자 쓰기·AI 검토는 충돌로 보류한다. 과거 미완료 역사 요청은 보류한다.
- 설정 카드의 공개 설정은 하나('N화부터 공개' 또는 '작가 전용', 기본 작가 전용)다(DEC-53). 독자 설정 위키(`GET /api/v1/public/works/{id}/world-cards`)·공개 세계관(상세·목록 수·이미지)·가져오기·Fork 이어받기·공개 MCP는 같은 규칙으로 서버가 거른다:
  유효 공개 회차(`semanticMetadata.revealFromEpisode`, 없고 `visibility=public`이면 1)가 기준 회차(연결된 소설의 발행된 마지막 회차, 소설이 연결되지 않았으면 1) 이하인 카드와 그 시점의 관계만 보낸다. 화면에서 거르게 두지 않는다. 키가 있는데 값이 잘못된(JSON `null` 포함) `revealFromEpisode`는 작가 전용으로 닫는다(`visibility`로 열지 않는다). 모든 비작가 출구가 `shownCardEpisode` 한 함수를 쓰며(DEC-46의 '공개 세계관=`visibility`, 독자 설정 위키=`revealFromEpisode`' 두 기준을 대체), 공개 목록의 세계관별 기준 회차는 페이지 전체에 연결 작품 조회 한 번과 공개 작품의 마지막 발행 회차 쿼리(`WorkRepository.lastPublishedOfPublicWorks`) 한 번으로 센다. 카드·관계 본문의 링크 `[글자](card:<uuid>)`는 응답에 실리는 보이는 카드에 없는 대상이면 `PublicWorldService`가 `hideCardLinks`(`world/domain/CardLinks.kt`) 한 함수로 글자만 남기고 링크가 아닌 모양(`<card:id>`·제목이 붙은 링크 등)에 남은 `card:<uuid>`도 같은 기준으로 지운다(상세·독자 위키·Fork 이어받기 응답, REST·MCP 공통). AI로 가는 요청(세계관 검토 `WorldReviewInput`·초기 분석 입력 `InitialWorldInput`의 카드 본문 출처·원고 Q&A의 관계 근거)에는 `stripCardLinks`로 모두 글자로 벗겨 id가 모델에 섞이지 않게 한다(초기 분석은 출처 해시·근거 구간이 벗긴 글 기준이고 `validateAgainst`가 같은 규칙으로 다시 만든다)([링크 규칙](../../docs/design/worldstudio-independent-schema.md#카드-본문-링크--dec-53)). [계약](../../docs/design/public-world-contract.md#카드-공개-기준-일원화--dec-53)
- 세계관과 소설은 1:1이다. 연결의 정본은 `work.world_studio_id`(UNIQUE) 하나이고 `WorkWorldService`가 맡는다. Content와 WorldStudio 트랜잭션은 겹치지 않게 차례로 연다. 공개 세계관 상세(`PublicWorldService.detail`)는 연결된 소설이 공개 작품(`WorkAccessResult.publiclyVisible()`)일 때만 그 최소 정보(`linkedWork`)를 싣고 그 밖은 `null`로 존재를 숨기며, 소설 작가명은 세계관 작가와 같은 `CoreNicknameService` 조회 한 번에 묶는다(목록은 바꾸지 않는다, #329).
- 자기 세계관을 연결하지 않은 `following` Fork는 원작 세계관을 읽기 전용으로 이어받는다(#365). `WorkWorldService.inheritedWorld` 한 곳이 조건·상한 회차(Fork 기준 회차)를 정하고 `PublicWorldService.inheritedWorld`가 확정 버전의 카드 중 유효 공개 회차가 상한 이하인 것(DEC-53: 독자 설정 위키와 같은 카드 집합이며 DEC-46·#365의 '공개 카드만'을 대체)과 그 카드끼리의 그 시점 관계만 거른다. 인물 문서·관계 본문 같은 작가용 값은 싣지 않는다. REST `GET /api/v1/works/{id}/inherited-world`·MCP `work_inherited_world`·`QaScopeService`가 같은 결과를 쓰며 원작 작가 권한으로 초안을 읽지 않는다. [계약](../../docs/design/public-world-contract.md#fork가-이어받는-원작-세계관-dec-3237-365)
- MCP 창구(`ai.storyfork.content.mcp`, `/mcp`)는 기존 Service 함수만 호출하는 어댑터다. 공개 도구는 인증 없이, 사용자 도구는 전달된 Bearer를 기존 필터로 검증한 회원 UUID로 호출하며 도구 인자로 회원 ID를 받지 않는다. [계약](../../docs/design/content-mcp-contract.md)
- 로컬은 이 디렉터리에서 `./gradlew unitTest --tests 'ai.storyfork.content.<대상 클래스>' --no-daemon`으로 순수 단위만 실행한다.
  Spring/HTTP/DB/Flyway 검사는 CI `integrationTest`에서 실행한다.

- 플롯·장면 계획(#374)의 기존 POST/PUT은 선택적 `position`을 받는다. 장면 순서는 작품+회차 단위로 플롯을 가로지르며 `own` 잠금 아래 이웃 위치·revision을 함께 갱신한다. V38은 기존 생성순을 보존해 position을 채운다. [계약](../../docs/design/writing-plan-panel-contract.md).

수정 제안 반영 상태는 현재 발행 버전과 복원 출처를 기준으로 계산한다. 독자 제보의 마지막 작가 처리 시각과 최초 확인 시각은 별도로 보관한다.
