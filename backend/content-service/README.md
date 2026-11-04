# STORYFORK Content Service

콘텐츠 서비스의 독립 Spring Boot 실행 골격입니다. 기존 Core의 콘텐츠·첨부 코드, API·DB·데이터·배포는 이전하지 않았습니다. 소유권 목표와 미정 계약은 [서비스 경계](../../docs/design/service-boundaries.md)를 따릅니다.

## 실행 기반

- 독립 Gradle 프로젝트: `storyfork-content-service`, group `ai.storyfork`
- 패키지: `ai.storyfork.content`, 진입점: `ContentServiceApplication` (`Application.kt`)
- Core와 같은 JDK 21, Kotlin 2.4.10, Spring Boot 4.1.0, dependency-management 1.1.7
- Core에서 바이트 그대로 재사용한 Gradle 9.5.1 wrapper
- production 의존성은 `spring-boot-starter-webmvc`와 `kotlin-reflect`만 선언합니다. 테스트는 Boot가 버전을 관리하는 JUnit Jupiter·Platform launcher를 사용합니다.

## 네이티브 실행

JDK 21의 `JAVA_HOME`을 해당 프로세스에 설정하고 이 디렉터리에서 실행합니다. 아래는 수동 실행 안내이며 CI/로컬 단위 검증이 앱을 기동하지는 않습니다.

```bash
./gradlew bootRun
```

기본 주소는 `127.0.0.1:8081`, `spring.application.name`은 `storyfork-content-service`입니다. Core의 8080, 운영 골격의 8082와 구분한 제안 포트이며 실제 호스트의 사용 여부는 별도로 확인해야 합니다. 포트 변경이 필요하면 Spring Boot 표준 옵션을 사용합니다.

```bash
./gradlew bootRun --args='--server.port=18081'
```

기본 실행에 DB·SMTP·AI 키나 별도 환경설정은 필요하지 않습니다. 서비스별 `.env`를 만들거나 루트 `.env` 전체를 source하지 않습니다. 향후 필요한 설정도 루트 `.env`에서 관리하고 해당 프로세스에 필요한 값만 전달합니다.

## 선택 단위 검증

```bash
./gradlew test --tests 'ai.storyfork.content.ApplicationPropertiesTest' --no-daemon
```

JUnit 테스트는 JDK `Properties`로 실제 classpath의 `application.properties`를 읽어 서비스명·loopback 주소·포트를 검증합니다. Spring context·HTTP·DB를 사용하지 않습니다. `useJUnitPlatform`, 빈 발견 실패, 필터 불일치 실패를 설정했으며 CI도 위 클래스를 명시해 실행합니다.

루트에서 실행하는 별도 정적 계약 검사는 기본 설정과 Core wrapper의 바이트·실행 권한만 확인합니다.

```bash
python3 -I -m unittest discover -s infrastructure/ci -p test_spring_service_configuration.py -v
```

## Core 인증 클라이언트 준비 — 로컬 초안

- [`CoreAuthClient`](src/main/kotlin/ai/storyfork/content/auth/client/CoreAuthClient.kt)는 기존 Spring HTTP Service Client의 `@HttpExchange`·`@PostExchange` 선언만 준비합니다. 새 production 의존성은 없습니다.
- `POST /internal/v1/auth/verify`와 `VerifiedMemberResponse(memberId: UUID)`는 **콘텐츠 서비스 내부의 잠정 초안**입니다. Core에 해당 endpoint는 구현되어 있지 않으며, 기존 Core 계약이나 전체 프로젝트의 인증 방식으로 채택한 것이 아닙니다.
- 응답은 Core `AuthMember.id`의 UUID 타입에 맞춘 회원 식별자 하나만 제안합니다. 기존 공개 `MemberResponse.id`는 UUID 문자열이며 이 새 DTO와 다른 계약입니다. 원본 자격증명은 `Authorization` 헤더 인자에만 두고 요청 본문·응답 DTO·로그에는 넣지 않습니다. 역할·권한 필드는 추측해 추가하지 않습니다.
- Bean·HTTP proxy·보안 필터·업무 호출부는 없습니다. 실제 Core 호출이나 인증·인가 강제는 수행하지 않습니다. 실제 연결 전에 Core 경로·응답과 서버 간 인증을 합의하고 timeout·오류 매핑·콘텐츠 인가를 구현해야 합니다.

```bash
./gradlew test --tests 'ai.storyfork.content.auth.client.CoreAuthClientTest' --no-daemon
```

위 순수 JUnit 테스트 하나는 reflection으로 HTTP annotation·필수 헤더·UUID-only 반환 DTO만 검사합니다. 서버·소켓·Spring context·MockMvc·실제 토큰 검증은 사용하지 않습니다. 기존 CI의 테스트 선택은 이번 범위에서 바꾸지 않았습니다.

## 범위와 검증 한계

- 업무 API·Health endpoint·인증/인가·DB·Flyway·공통 starter·빈 업무 계층은 추가하지 않습니다. 업무 API를 추가하기 전에 인증·콘텐츠 권한 계약을 별도로 구현해야 합니다.
- Compose·nginx·공개 라우팅·운영 배포에 연결하지 않은 loopback 네이티브 골격입니다. 인터넷 운영 준비 완료를 뜻하지 않습니다.
- 로컬에서는 선택 단위/정적 검증만 수행합니다. 앱 기동·`build`/`bootJar`·통합·시스템·브라우저 검증은 실행하지 않았으며, 실제 기동 가능성은 별도 검증 대기입니다.
- hosted `Required CI` 성공은 아직 확인하지 않았습니다. 기능표는 병합과 최신 head의 CI 성공 확인 전까지 ❌를 유지합니다.
