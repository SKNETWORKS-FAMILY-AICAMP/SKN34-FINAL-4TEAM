# 콘텐츠 서비스 구현 지침

`backend/content-service/**`에 적용한다. [루트 공통 지침](../../AGENTS.md)과 [콘텐츠 이관·서비스 연동 계약](../../docs/design/content-service-migration-contract.md)을 함께 따른다.

- 작품·에피소드·원고·버전·세계관·WorldStudio·Fork·발행·콘텐츠 첨부 및 콘텐츠 인가를 이 앱으로 이전한다. 기존 구현부터 옮기며 미구현 기능을 선제 추가하지 않는다.
- Core는 회원·인증·세션·크레딧·정산·회원 알림 정본을 유지한다. 다른 서비스 Entity·Repository·DB를 직접 이용하지 않는다.
- Kotlin 패키지는 `ai.storyfork.content`다. 기능별 Controller → Service → Repository 구조와 JPA를 사용한다. 공개 DTO는 `service/dto`, 외부 계약은 `client/dto`에 두고 Controller와 Service의 동일 계약은 재사용한다. Entity를 HTTP로 노출하지 않는다.
- Core의 [구현 규칙](../core-api/AGENTS.md) 중 MVC·DTO·Controller 주석·객체 책임·이름·Helper·영속성/보안 원칙을 이 앱의 패키지와 콘텐츠 소유권에 맞춰 적용한다. Core 고유 기능·기본 DB/Bean·테스트 명령을 그대로 복사하지 않는다.
- 인증은 `CoreAuthClient`의 Spring HTTP Service proxy로 `POST /internal/v1/auth/verify`를 호출한다. 사용자 Bearer와 별도 `X-Content-Service-Token`을 함께 보내고 검증된 회원 UUID만 Principal로 사용한다. JWT 서명 키·Core Entity/Repository를 가져오거나 인증 캐시·fallback·재시도를 추가하지 않는다.
- 기존 콘텐츠·첨부·WorldStudio 코드와 테스트, JPA·Flyway·보안·공개 라우팅·이미지/CI 설정을 이 앱으로 추출했다. 소스 구현과 hosted CI·실제 DB 전환·배포 완료는 구분한다. 운영 앱은 실행 골격 그대로다. 필요한 production 의존성을 추가하기 전에 알린다.
- 기존 API·CSRF·UUID·revision·잠금·불변 이력을 유지한다. 사용자가 승인한 개발용 fresh 콘텐츠 스키마는 `db/migration/work`, `episode`, `world`, `episode_version`, `publication`, `fork`, `proposal` leaf와 단일 `content_schema_history`/전역 V1~V9를 사용한다. `db/migration/content` 및 root 직하 SQL·legacy importer를 다시 만들지 않는다. 기존 Content 이력과 호환되지 않으며 자동 repair/reset하지 않는다. Auth·첨부·WorldStudio SQL 바이트/이력은 보존하고 실제 DB 폐기는 정확한 대상·별도 승인 없이 실행하지 않는다.
- 같은 기존 DB에서 writer와 migration 소유권만 나눈다. WorldStudio는 `contentDataSource`를 재사용하되 전용 EntityManager/TransactionManager로 validate만 한다. 별도 DB/pool·교차 서비스 Entity·HTTP 분산 transaction을 추가하지 않는다.
- 로컬은 이 디렉터리에서 `./gradlew unitTest --tests 'ai.storyfork.content.<대상 클래스>' --no-daemon`으로 선택 순수 단위만 실행한다. `build.gradle`의 통합 분류에 해당하는 Spring/HTTP/DB/Flyway 검사는 hosted CI `integrationTest`에서만 실행한다. 전체 빌드·앱/DB/컨테이너 기동·브라우저 검증은 로컬 완료 조건이 아니다.
