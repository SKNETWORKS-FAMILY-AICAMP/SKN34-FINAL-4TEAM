# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk-jammy AS builder
WORKDIR /workspace
COPY gradlew ./gradlew
COPY gradle ./gradle
COPY build.gradle settings.gradle ./
RUN chmod +x ./gradlew
# 의존성은 src보다 먼저 별도 레이어로 받아 CI의 gha 레이어 캐시에 싣는다(#800). cache mount는 그 캐시로 내보내지지 않아 쓰지 않는다.
# 빈 main 하나로 bootJar를 돌려 플러그인·컴파일러·런타임 클래스패스를 받고, COPY src와 섞이지 않게 src·build를 지운다.
RUN mkdir -p src/main/kotlin && echo 'fun main() {}' > src/main/kotlin/Warmup.kt && \
    ./gradlew bootJar --no-daemon && rm -rf src build
COPY src ./src
RUN ./gradlew bootJar --no-daemon --offline && \
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
