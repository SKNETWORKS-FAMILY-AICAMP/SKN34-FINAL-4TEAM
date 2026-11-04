# STORYFORK Operations Service

운영 서비스의 독립 Spring Boot 실행 골격입니다. 고객지원·신고·감사 등 업무 기능과 DB·배포는 구현하지 않았습니다. 실제 회원·콘텐츠 조치는 소유 서비스가 담당하며, 목표와 미정 계약은 [서비스 경계](../../docs/design/service-boundaries.md)를 따릅니다.

## 실행 기반

- 독립 Gradle 프로젝트: `storyfork-operations-service`, group `ai.storyfork`
- 패키지: `ai.storyfork.operations`, 진입점: `OperationsServiceApplication` (`Application.kt`)
- Core와 같은 JDK 21, Kotlin 2.4.10, Spring Boot 4.1.0, dependency-management 1.1.7
- Core에서 바이트 그대로 재사용한 Gradle 9.5.1 wrapper
- production 의존성은 `spring-boot-starter-webmvc`와 `kotlin-reflect`만 선언합니다. 테스트는 Boot가 버전을 관리하는 JUnit Jupiter·Platform launcher를 사용합니다.

## 네이티브 실행

JDK 21의 `JAVA_HOME`을 해당 프로세스에 설정하고 이 디렉터리에서 실행합니다. 아래는 수동 실행 안내이며 CI/로컬 단위 검증이 앱을 기동하지는 않습니다.

```bash
./gradlew bootRun
```

기본 주소는 `127.0.0.1:8082`, `spring.application.name`은 `storyfork-operations-service`입니다. Core의 8080, 콘텐츠 골격의 8081과 구분한 제안 포트이며 실제 호스트의 사용 여부는 별도로 확인해야 합니다. 포트 변경이 필요하면 Spring Boot 표준 옵션을 사용합니다.

```bash
./gradlew bootRun --args='--server.port=18082'
```

기본 실행에 DB·SMTP·AI 키나 별도 환경설정은 필요하지 않습니다. 서비스별 `.env`를 만들거나 루트 `.env` 전체를 source하지 않습니다. 향후 필요한 설정도 루트 `.env`에서 관리하고 해당 프로세스에 필요한 값만 전달합니다.

## 선택 단위 검증

```bash
./gradlew test --tests 'ai.storyfork.operations.ApplicationPropertiesTest' --no-daemon
```

JUnit 테스트는 JDK `Properties`로 실제 classpath의 `application.properties`를 읽어 서비스명·loopback 주소·포트를 검증합니다. Spring context·HTTP·DB를 사용하지 않습니다. `useJUnitPlatform`, 빈 발견 실패, 필터 불일치 실패를 설정했으며 CI도 위 클래스를 명시해 실행합니다.

루트에서 실행하는 별도 정적 계약 검사는 기본 설정과 Core wrapper의 바이트·실행 권한만 확인합니다.

```bash
python3 -I -m unittest discover -s infrastructure/ci -p test_spring_service_configuration.py -v
```

## 범위와 검증 한계

- 업무 API·Health endpoint·관리자 인증/인가·DB·Flyway·공통 starter·빈 업무 계층은 추가하지 않습니다. 운영 API를 추가하기 전에 관리자 권한 계약을 별도로 구현해야 합니다.
- Compose·nginx·공개 라우팅·운영 배포에 연결하지 않은 loopback 네이티브 골격입니다. 인터넷 운영 준비 완료를 뜻하지 않습니다.
- 로컬에서는 선택 단위/정적 검증만 수행합니다. 앱 기동·`build`/`bootJar`·통합·시스템·브라우저 검증은 실행하지 않았으며, 실제 기동 가능성은 별도 검증 대기입니다.
- hosted `Required CI` 성공은 아직 확인하지 않았습니다. 기능표는 병합과 최신 head의 CI 성공 확인 전까지 ❌를 유지합니다.
