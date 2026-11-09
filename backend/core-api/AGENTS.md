# Core Service 구현 지침 (현재 모듈: `core-api`)

`backend/core-api/**`에 적용한다. [루트 공통 지침](../../AGENTS.md)을 함께 따른다.
Core는 회원·인증·세션·Health와 내부 인증 확인을 담당한다. 콘텐츠 정본·인가는 Content다([서비스 경계](../../docs/design/service-boundaries.md)).

## 레이어 구조 (Spring MVC)

- 흐름: `요청 DTO → Controller → Service → Repository → DB`, 외부 호출은 `Controller → Service → (선택적 Facade) → Client`.
- **Controller**: DTO 바인딩·검증, 검증된 Principal 전달, Service 호출, 응답 DTO·HTTP 상태 반환만 한다.
  Repository·Client를 직접 호출하거나 업무 규칙·트랜잭션을 넣지 않는다. 클래스·엔드포인트에 한국어 KDoc을 단다.
- **Service**: 유스케이스·권한 판단·트랜잭션. **Repository**: 영속성. **Entity/domain**: 상태와 업무 규칙(HTTP 객체에 의존하지 않음).
- Facade는 하위 Client 호출·검증·변환이 복잡할 때만 쓰고, `Service ↔ Facade` 순환과 한 줄 전달 Facade를 만들지 않는다.
- 의존성은 생성자 DI로 주입한다.

## 기능 중심 배치

- 기본 패키지는 `ai.storyfork.core`이며 디렉터리와 `package` 선언을 일치시킨다.
- 기능 디렉터리 안에 `<feature>/controller`, `<feature>/service/dto`, `<feature>/repository`, `<feature>/entity`, `<feature>/domain`을 둔다.
  전역 `controller`·`service` 폴더나 빈 미래 기능 폴더를 만들지 않는다.
- 외부 시스템 계약은 `client/dto`, 변환은 `client/mapper`, 전용 예외는 `client/exception`에 둔다.
- 요청·응답은 명시적 DTO(`Request`·`Payload`·`Response`·`Result`)로 주고받는다. Entity·임의 `Map`을 공개 계약으로 쓰지 않고,
  Controller와 Service의 계약이 같으면 `service/dto`의 DTO를 재사용한다(일대일 복사 DTO 금지).
- Controller에 `HttpServletRequest` 같은 원시 HTTP 객체를 받지 않는다. `@RequestBody`·`@ModelAttribute`·`@PathVariable`·`@RequestHeader`·`@CookieValue`를 쓴다.
- 이름: `Controller`·`Service`·`Client`·`Facade`·`Mapper`·`Config`·`Properties`. `Support`·`Util`·`Common` 접미사를 새로 만들지 않는다.
  둘 이상 기능이 쓰는 보조 코드만 `_common/helper`의 `*Helper`로 둔다.

## 영속성과 마이그레이션

- JPA Entity와 Spring Data `JpaRepository`를 사용한다. 직접 작성 SQL·`JdbcTemplate`·`nativeQuery`는 쓰지 않는다.
- 스키마는 Flyway가 소유한다. SQL은 `db/migration/<domain>/`에 두고 기존 SQL 체크섬·이력을 보존한다. Hibernate create/update는 쓰지 않는다.
- Core는 `db/migration/auth`(현재 V1–V4·V7·V8)와 `db/migration/notification`(V5–V6)을 `flyway_schema_history` 하나로 소유한다.
  `db/migration/sample`(V9 샘플 계정)도 같은 전역 버전을 공유하므로 새 SQL은 세 경로 전체의 최댓값 다음 번호를 쓴다.
  `sample/V9`는 CSV에서 생성한 개발 샘플 계정이며 직접 편집하지 않는다.

## 검증

- 테스트 패키지는 production 패키지 구조를 따른다.
- 로컬: `backend/core-api`에서 `./gradlew unitTest --tests '<대상 클래스>' --no-daemon`으로 순수 단위만 실행한다.
- `build.gradle`의 `integrationTestClasses`가 Spring context·HTTP·DB/Flyway 테스트를 분류하며 CI `integrationTest`에서 실행한다.
  새 경계 테스트를 추가하면 분류 목록을 갱신한다.
