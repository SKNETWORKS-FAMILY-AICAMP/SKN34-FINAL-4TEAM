# syntax=docker/dockerfile:1
# Java 21 + Gradle 배포판 + 서비스 3개의 Maven 의존성을 미리 받아 둔 빌드용 이미지.
# ponytail: 이미지 이후 바뀐 의존성만 빌드 때 외부에서 받는다. develop 반영 시 builder-images.yml이 다시 만든다.
FROM eclipse-temurin:21-jdk-jammy
WORKDIR /warm
COPY backend/core-api/gradlew backend/core-api/build.gradle backend/core-api/settings.gradle core-api/
COPY backend/core-api/gradle core-api/gradle
COPY backend/content-service/gradlew backend/content-service/build.gradle backend/content-service/settings.gradle content-service/
COPY backend/content-service/gradle content-service/gradle
COPY backend/operations-service/gradlew backend/operations-service/build.gradle backend/operations-service/settings.gradle operations-service/
COPY backend/operations-service/gradle operations-service/gradle
COPY infrastructure/builders/resolve-all.gradle ./
RUN for service in core-api content-service operations-service; do \
      (cd "$service" && chmod +x gradlew && ./gradlew --init-script ../resolve-all.gradle resolveAllDependencies --no-daemon --no-configuration-cache) || exit 1; \
    done && \
    rm -rf /warm /root/.gradle/daemon
WORKDIR /workspace
