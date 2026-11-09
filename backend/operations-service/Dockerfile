# syntax=docker/dockerfile:1
FROM ghcr.io/sknetworks-family-aicamp/storyfork-jvm-builder:latest AS builder
WORKDIR /workspace
COPY gradlew ./gradlew
COPY gradle ./gradle
COPY build.gradle settings.gradle ./
RUN chmod +x ./gradlew
COPY src ./src
RUN ./gradlew bootJar --no-daemon && \
    artifact="$(find build/libs -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar' -print -quit)" && \
    test -n "${artifact}" && cp "${artifact}" /workspace/application.jar
FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app
RUN groupadd --system storyfork && \
    useradd --system --gid storyfork --home-dir /nonexistent --shell /usr/sbin/nologin storyfork
COPY --from=builder --chown=storyfork:storyfork /workspace/application.jar /app/application.jar
USER storyfork:storyfork
EXPOSE 8082
ENTRYPOINT ["java", "-jar", "/app/application.jar"]
