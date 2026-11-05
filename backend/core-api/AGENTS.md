# Core Service 구현 지침 (현재 모듈: `core-api`)

> **서비스 경계는 DEC-41과 [4개 서비스 구조](../../docs/design/service-boundaries.md)를 따른다.** Core는 Auth·세션·Health와 내부 인증 확인을 유지한다. 기존 콘텐츠·첨부·WorldStudio 코드/테스트는 Content로 추출했으며 hosted CI·실제 DB 전환·배포는 대기다. 콘텐츠의 정본·인가·발행은 Content, 회원·인증·크레딧·알림은 Core, 운영 업무는 운영 서비스의 목표 책임이다. 미구현 업무를 선제 추가하지 않는다.

`backend/core-api/**`에 적용한다. [루트 공통 지침](../../AGENTS.md)을 함께 따른다.
아래 STORYFORK 업무 경계는 후속 구현 기준이며 현재 기능이 구현되었다는 뜻이 아니다.

## 개발 아키텍처: Spring MVC 필수

- **Core API는 Spring MVC 패턴으로 개발한다.** 기능별 패키지 안에서 Controller와 Model의 책임을 분리하고,
  업무 처리는 Service, 영속성 처리는 Repository로 나누는 레이어드 구조를 적용한다.
- **Controller:** HTTP 요청을 DTO로 바인딩·검증하고 Service를 호출한 뒤 응답 DTO와 HTTP 상태·헤더를 반환한다.
  Repository·EntityManager·외부 Client를 직접 호출하거나 업무 규칙을 구현하지 않는다.
- **Model:** 도메인 객체·Entity는 상태와 업무 규칙을, Service는 유스케이스·권한 판단·트랜잭션을,
  Repository는 영속성 조회·저장을 담당한다. Model은 HTTP 요청·응답 객체에 의존하지 않는다.
- **View:** Core는 REST API이므로 서버 HTML 템플릿 대신 응답 DTO를 JSON으로 직렬화하여 표현한다.
  DTO 자체를 View 로직으로 취급하지 않으며, 사용자 화면 렌더링은 Frontend가 담당한다. 별도 View 클래스·템플릿 계층은 만들지 않는다.
- 기본 흐름은 `요청 DTO → Controller → Service → Repository → DB`, 응답은
  `Service 결과 DTO → Controller → 응답 DTO의 JSON 직렬화`다. 외부 API는 Service가 Client를 통해 호출한다.
- MVC는 전역 `model/view/controller` 폴더를 만들라는 뜻이 아니다. 아래 기능 중심 배치와 DTO·책임 분리 규칙을 함께 적용한다.
  신규 개발과 수정 범위의 리팩터링은 이 기준을 따르며, 기존 코드가 이미 모두 준수한다고 간주하지 않는다.

## 기능 중심 배치

- Kotlin 기본 패키지는 `ai.storyfork.core`다. 소스 루트는 `src/main/kotlin/ai/storyfork/core/`이며
  루트 패키지를 생략하지 않고 실제 디렉터리와 `package` 선언을 정확히 일치시킨다.
- 업무 코드는 기능 디렉터리 안에서 `controller → service → repository` 또는 외부 호출 시
  `controller → service → (선택적 facade) → client` 흐름을 사용하고,
  프레임워크와 무관한 업무 모델은 `domain`에 둔다.
- `_health`와 `_health_ai_service`만 상태 확인 기능으로 제공한다.
  `_common`에는 기존 HTTP 설정·오류 격리와 전역 CORS가 남아 있다. 업무 기능 폴더는 미리 만들지 않는다.
- DTO·Controller·Service·Repository·Entity는 기존 기능 중심 배치를 유지하면서 기능 안의 서로 다른 폴더에 둔다.
  예: `<feature>/controller`, `<feature>/service/dto`, `<feature>/repository`, `<feature>/entity`.
  기능을 가로지르는 전역 `controller`·`service`·`repository`·`entity` 폴더나 빈 미래 기능 폴더를 만들지 않는다.
- 공개 HTTP 요청·응답과 내부 서비스 입출력 DTO는 해당 기능의 `service/dto`에 두고 Controller와 Service에서 사용한다.
  동일 경계에 전달만을 위한 중복 DTO를 만들지 않는다. 외부 시스템 전용 계약은 `client/dto`,
  프레임워크와 무관한 업무 모델은 `domain`, JPA 매핑은 `entity`에 둔다.
- Controller·Service·Client의 요청·응답 데이터는 명시적인 DTO로 받아 DTO로 전달한다. 공개 API와 내부 서비스 간 API 모두 적용하며,
  요청은 `Request`·`Payload`, 응답은 `Response`·`Result`처럼 역할을 드러내는 타입을 사용한다.
- Controller에서 `HttpServletRequest`·`HttpServletResponse`·`ServletRequest`·`WebRequest` 같은 원시 HTTP 객체를
  요청·응답 인자로 받거나 Service·Client로 전달하지 않는다. 본문은 `@RequestBody` DTO, 쿼리는 `@ModelAttribute` DTO로 바인딩하고,
  경로·헤더·쿠키는 `@PathVariable`·`@RequestHeader`·`@CookieValue`로 필요한 값만 명시적으로 받는다.
  인증 주체는 검증된 Principal로 받으며 클라이언트가 보낸 사용자 ID를 인증 정보로 신뢰하지 않는다.
  Servlet 객체가 필수인 Filter·Interceptor·예외 처리 등 프레임워크 경계에서만 해당 객체를 사용하고 업무 계층에 넘기지 않는다.
- Entity·도메인 객체·임의 `Map`을 요청·응답 계약으로 직접 사용하지 않는다. 목록·페이지·오류 응답도 DTO로 정의하고,
  DTO에는 해당 경계에서 허용된 필드만 명시한다. HTTP 상태·헤더와 본문 없는 응답을 위해 빈 DTO를 만들지는 않는다.
- Repository의 영속성 입출력에는 Entity를 사용하되 Service에서 DTO와 변환한다. DTO 사용을 이유로 영속성 모델이나
  업무 로직까지 DTO로 대체하거나, 동일 경계에 불필요한 중간 DTO·전달 계층을 추가하지 않는다.
- DTO는 계층 수가 아니라 계약·검증·노출 범위가 달라지는 경계를 기준으로 나눈다. Controller → Service → Facade처럼
  호출 계층이 늘었다는 이유만으로 같은 필드의 DTO와 일대일 복사 코드를 단계마다 만들지 않는다.
  Controller와 Service의 계약·허용 필드가 같으면 `service/dto`의 동일 DTO를 재사용한다.
- 공개 HTTP 계약, 내부 실행 결과, 외부 시스템 계약의 필드·의미·변경 이유가 다르면 별도 DTO로 정의한다.
  예를 들어 로그인 내부 결과의 refresh token은 Controller가 HttpOnly 쿠키로 설정하고, 공개 JSON 응답 DTO에는
  access token과 허용된 사용자 정보만 담는다. 내부 결과 객체를 그대로 직렬화하여 비밀값을 노출하지 않는다.
- DTO 안에 Entity·도메인 객체를 중첩하거나 그 목록을 담아 공개하는 방식으로 경계를 우회하지 않는다.
  중첩 응답도 허용 필드가 명시된 DTO를 사용한다. Domain은 업무 상태·규칙을, Entity는 영속성 상태를 담당하며
  둘을 계층 전달용 DTO로 취급하지 않는다. Repository의 Entity 계약을 DTO로 일괄 치환하지 않는다.
- 경로·헤더·쿠키 값과 검증된 Principal은 위의 Spring MVC 바인딩 규칙을 따른다. 식별자 하나나 본문 없는 응답을
  감싸기 위한 빈약한 DTO를 만들지 않으며, DTO 분리 자체를 위해 Mapper·Facade·인터페이스 계층을 추가하지 않는다.
- 외부 DTO를 내부 모델로 변환하는 Mapper는 해당 외부 시스템의 `client/mapper`에 둔다.
- 외부 시스템에서만 사용하는 예외는 해당 시스템의 `client/exception`에 둔다.
- DTO, 예외, 설정을 프로젝트 전체의 중앙 폴더에 모으지 않고 그 계약을 소유하는 기능 가까이에 둔다.

## Controller 주석과 객체 책임

- 모든 Controller 클래스와 모든 엔드포인트 메서드에 한국어 KDoc을 작성한다. 클래스에는 담당 기능과 책임 범위를,
  메서드에는 수행 동작·요청/응답 DTO·인증/권한 조건·주요 실패 조건을 설명한다. 해당하지 않는 항목은 생략하며,
  코드와 주석이 달라지지 않도록 함께 갱신한다. 단순히 메서드 이름을 반복하거나 매 줄을 해설하는 주석은 피한다.
- Controller는 관리 대상 리소스의 CRUD 묶음 단위로 분리한다. 서로 다른 리소스의 API를 하나의 Controller에 모으거나
  HTTP 메서드마다 별도 Controller를 만들지 않는다. 기본적으로 클래스·DTO·Entity별 파일을 사용하며,
  Controller 안에 DTO나 예외 처리 클래스를 함께 선언하지 않는다. Entity 전용 복합키처럼 밀접한 타입은 함께 둘 수 있다.
- Controller는 입력 바인딩·검증, 검증된 인증 주체 전달, Service 호출과 HTTP 응답 변환만 담당한다.
  업무 규칙·권한의 최종 판단·트랜잭션·영속성 처리·외부 API 통신을 Controller에 넣지 않는다.
- 단일 책임 원칙에 따라 클래스·파일을 변경 이유가 같은 응집된 책임 단위로 나눈다. 작품·회차·세계관·Fork 등
  독립적인 업무 책임을 하나의 거대 Controller·Service·Repository에 몰아넣지 않는다. 서로 다른 책임의 Entity·DTO도
  한 파일에 일괄 선언하지 않고 책임별로 분리한다.
- 분리한 객체는 자신의 상태와 규칙을 캡슐화하고 필요한 협력 객체만 주입받는다. 파일만 쪼개고 하나의 객체가
  모든 업무를 계속 지휘하거나, 범용 Helper로 책임을 옮기는 방식은 책임 분리로 보지 않는다.
- 분리는 실제 업무 경계와 변경 이유를 기준으로 하며 임의의 줄 수 제한, 메서드마다 클래스 생성,
  불필요한 인터페이스·상속·전달 계층 추가로 대체하지 않는다. 관련 변경의 리뷰에서 책임 혼재와 과도한 의존성을 확인한다.

## 역할별 이름

- 공개 HTTP 진입점은 `Controller`, 업무 흐름은 `Service`, 외부 HTTP 통신은 `Client`로 끝낸다.
- 하위 Client 호출·응답 검증·도메인 변환을 하나의 진입점으로 감추는 객체는 `Facade`로 끝낸다.
- 외부 DTO 변환은 `Mapper`, Spring 구성은 `Config`, 환경설정 값은 `Properties`로 끝낸다.
- 전송 객체는 경계에 맞춰 `Request`, `Response`, `Payload`, `Result`를 사용한다. 필드가 같다는
  이유만으로 서로 다른 경계의 타입을 합치지 않는다.
- 이름은 수행 역할을 드러내야 하며 `Support`, `Util`, `Common`처럼 의미가 모호한 접미사를
  새로 만들지 않는다.

## Helper 규칙

- 다른 코드의 반복 작업을 보조하는 파일과 `object`·클래스 이름은 `Helper`로 끝낸다.
- 둘 이상의 기능이 실제로 함께 사용하는 Helper는 `_common/helper`에 둔다.
- 특정 기능이나 외부 시스템만 사용하는 Helper는 해당 기능의 `helper` 디렉터리에 둔다.
- Helper 함수 이름은 `executeHttpCall`, `buildRestClient`, `decode`처럼 동작을 나타내며
  함수 이름에 `Helper`를 반복하지 않는다.
- `Controller`, `Service`, `Facade`, `Client`, `Mapper`처럼 더 정확한 역할명이 있으면 Helper로
  분류하지 않는다.
- 실제 사용처가 하나뿐이고 호출부 안에 두는 편이 더 명확한 작은 함수는 불필요하게 별도
  Helper 파일로 추출하지 않는다.

## 의존 방향과 변경 원칙

- 기본 의존 방향은 `Controller → Service → Repository` 또는
  `Controller → Service → (선택적 Facade) → Client`다. Facade는 필수 계층이 아니다.
- Controller는 Facade나 Client를 직접 호출하지 않고 사용자 유스케이스를 담당하는 Service만 호출한다.
- Service는 필요한 Repository를 직접 사용하며, 외부 하위 시스템의 호출·검증·변환이
  복잡할 때만 Facade를 사용한다. 단순 Client 호출을 한 줄 전달하는 Facade는 만들지 않는다.
- Facade는 상위 Service를 다시 호출하지 않는다. `Service ↔ Facade` 순환 의존성은 금지한다.
- Facade가 필요 없는 단순 외부 호출은 Service가 Client를 직접 사용할 수 있다.
- 필요한 의존성은 Spring Bean의 생성자 DI로 주입한다. 명시적인 조립·설정이 필요한 경우
  `@Configuration`·`@Bean`을 사용하고, DI를 위해 불필요한 전달용 객체를 추가하지 않는다.
- 외부 시스템의 원본 JSON과 예외를 공개 API에 그대로 노출하지 않는다. Client 경계에서 DTO와
  안정적인 내부 예외로 변환한다.
- 새로운 공통 추상화는 production 사용처가 둘 이상이거나 외부 시스템 장애·보안 경계를
  격리해야 할 때만 추가한다.
- 구조나 이름을 변경하면 [Core README](README.md)와 [아키텍처 문서](../../docs/architecture.md)도 함께 갱신한다.

## 영속성과 마이그레이션

- 업무 영속성은 JPA Entity와 Spring Data `JpaRepository` 인터페이스를 사용한다.
  예: `interface WorkRepository : JpaRepository<Work, Long>`. `Long`은 예시이며 실제 타입은 Entity의 `@Id`와
  일치시킨다. 기존 UUID·String 식별자를 예시에 맞추려고 변경하지 않는다.
- 조회 메서드 파생·JPQL·JPA Entity 연산을 사용한다. 애플리케이션의 직접 작성 SQL·`JdbcTemplate`·
  `nativeQuery` 영속성은 금지하며 SQL을 Service·Helper·custom Repository 구현으로 옮겨 우회하지 않는다.
- 스키마의 소유자는 Flyway다. SQL 마이그레이션은 `src/main/resources/db/migration/<domain>/`에 두고
  `db/migration` 바로 아래에 SQL 파일을 두지 않는다. 도메인별 locations와 이력 테이블을 분리하여
  독립적인 버전 번호가 충돌하지 않게 한다. 기존 SQL 체크섬·이력은 보존하고 Hibernate create/update를 사용하지 않는다.
- Core는 Auth JPA·`db/migration/auth`와 알림함(#89) JPA·`db/migration/notification`을 `flyway_schema_history` 하나로 소유한다(알림 버전은 V5부터, Auth V1–V4와 겹치지 않는다). Auth SQL 바이트/이력은 유지하며 Content Entity/Repository·첨부/Studio migration을 다시 스캔하지 않는다.
- Content의 사용자 승인 개발용 fresh 이력 재작성은 Auth에 적용하지 않는다. 같은 기존 DB에서 writer/migration 소유권만 분리하며 실제 DB 삭제·개인 `.env` 수정·자동 repair/clean은 승인 범위 밖이다. Content 초기화·불변 이력·동시 편집은 Content hosted CI에서 검증한다.

## 정본·권한·승인 경계

- 세계관의 기본 정의와 작품별 상태, 원작·Fork·미공개 초안·시뮬레이션 상태를 분리한다.
  버린 시뮬레이션의 사건·기억을 정본이나 다른 실행에 반영하지 않는다. 플롯의 예정 사건은 확정 관계가 아니다.
- 작품 Fork의 기준 회차·원고 버전은 보존한다. 기준 회차에 공개된 세계관 전체에는 설정·인물 상태·지식·관계가 함께 포함된다. 수정 전에는 기준 회차에 영향을 주는 원본 변경을 따라가고 최초 수정 시 전체를 독자 소유로 Fork한다. 독립 후에는 변경을 알리고 사용자 선택으로만 반영한다(DEC-37).
  모든 참조·복사·알림·AI 문맥에서 기준 회차와 권한을 확인한다. 실제 필터링, 체크포인트·관계 동기화는 후속 설계다.
- 세계관 설정은 항목별 공개/비공개와 회차별 공개 범위를 둔다. 기본은 비공개다(DEC-36). 사용자 권한·미공개 초안·독자 발행 범위·Fork 분기 시점·캐릭터 지식은 구분한다.
  사용자가 보낸 ID나 프롬프트만 신뢰하지 말고 콘텐츠 서비스에서 권한·허용 문맥을 확인한다. Core는 별도 서비스 자격과 기존 JWT 검증을 통과한 회원 UUID만 내부 endpoint로 제공하며 콘텐츠 인가를 대신하지 않는다.
- 사용자가 선택·승인한 제안만 권한과 기준 버전을 검증한 뒤 반영한다. 수정안에는 기준 버전·변경 전후·근거·
  처리 상태를 연결하고, 기준 버전이 바뀌면 무조건 덮어쓰지 않는다. 작품 내 PR은 GitHub 연동을 전제하지 않는다.
- AI 응답 성공을 저장·승인·발행 성공으로 처리하지 않는다. 접수·검토·승인·반영의 실제 상태를 반환한다.
- MVP에서 PostgreSQL은 설정·원고 원문과 버전·체크포인트·Fork를, 그래프 DB는 관계 정보를 다룬다. `pg_git`은 MVP에 적용하지 않는다. 확정 콘텐츠 변경과 되돌리기는 새 버전으로 남긴다. 그래프 DB 제품·관계 정본·연결 키·동기화·복구와 AI 조회 경로는 미정이며 실패한 관계 반영을 성공으로 표시하지 않는다.
- 작품 등록이나 Fork 설정만으로 외부 IP 권한이 생기지 않는다. 등록자에게 2차 창작 권리 확인 여부를 묻되 플랫폼이 각 작품의 권리를 직접 확인한다고 가정하지 않는다. Fork 생성·공개 조건은 별개이며 조건 철회 시 기존 Fork 보호 원칙은 DEC-38을 따른다. 신고·법적 제한은 별도로 처리한다.
- 크레딧 잔액·사용 확정·복구는 Core가 판단한다. AI 사용량 보고를 금전성 원장 자체로 취급하지 않는다.
  열람료와 AI 이용료, 유료 충전분과 보상 크레딧을 구분하고 실행 전에 비용을 안내한다.
  미정인 금액·한도·배분율·재시도·오류 복구 기준은 임의로 정하지 않으며 실패를 성공 차감으로 숨기지 않는다.
- 저장 한도·추가 비용은 사전 안내하고 한도 초과로 기존 작품을 자동 삭제하지 않는다.
- AI 자율 연재의 허용·발행·검토·중단·비용 조건은 아직 미정이다. 합의 전에 자동 발행이나 worker를 추가하지 않는다.

## 검증

- 테스트 패키지는 production 패키지 구조를 따라 배치한다.
- 로컬: JDK 21 환경의 `backend/core-api`에서 `./gradlew unitTest --tests '<대상 클래스 또는 패턴>' --no-daemon`으로
  변경·직접 영향 범위의 순수 단위 테스트만 실행한다. Spring context·HTTP·DB 테스트, 전체 suite·빌드는 로컬 개발 검증으로 실행하지 않는다.
- `build.gradle`의 `integrationTestClasses`가 Spring context·실제/모의 HTTP transport·DB/Flyway 테스트를 분류한다.
  `unitTest`는 이를 제외하고 `integrationTest`는 이들만 포함한다. 혼합 클래스는 통합에 둬서 중복 실행하지 않는다.
  새 경계 테스트를 추가하면 분류 목록을 갱신하며 `infrastructure/ci/test_ci.py`의 누락 검사도 유지한다.
- CI: 워크플로가 `./gradlew unitTest`·`./gradlew integrationTest`와 기능 패키지 `--tests`를 직접 호출한다. 별도 runner·shell wrapper는 두지 않는다.
  기능별 범위가 명확하면 해당 기능 전체, 공통·설정·의존성·미등록 기능이면 Core 전체를 검증한다.
  통합 계층에서 임시 PostgreSQL·Mailpit·Flyway로 Auth와 내부 인증 보안을 확인한다. 이전된 콘텐츠·첨부·WorldStudio 통합 테스트는 Content job에서 실행한다.
  이후 관련 HTTP 시스템 시나리오를 실행한다. 문서만 변경하면 runtime job을 생략하고 hosted 결과 확인 전에는 검증 대기로 보고한다.
- 파일 이동 후에는 이전 package·import·문서 경로가 남지 않았는지 `rg`로 확인하고
  `git diff --check`를 통과시킨다.
