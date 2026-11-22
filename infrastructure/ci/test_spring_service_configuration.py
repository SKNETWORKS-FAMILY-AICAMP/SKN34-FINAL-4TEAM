"""신규 Spring 앱의 정적 설정·wrapper 계약만 검사한다. JVM·Spring·HTTP는 실행하지 않는다."""
from configparser import ConfigParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SERVICES = {"content": "8081", "operations": "8082"}


class SpringServiceConfigurationTest(unittest.TestCase):
    def test_native_defaults_are_distinct_and_loopback_only(self):
        # 서비스 기본 식별·bind와 각자의 persistence 설정 경계를 검사한다.
        # 실제 Java Properties resource 로딩은 서비스별 JUnit 테스트가 검사한다.
        for service, port in SERVICES.items():
            with self.subTest(service=service):
                resource = ROOT / f"backend/{service}-service/src/main/resources/application.properties"
                self.assertTrue(resource.is_file(), f"설정 파일 누락: {resource.relative_to(ROOT)}")
                config = ConfigParser(interpolation=None, delimiters=("=",))
                config.read_string("[application]\n" + resource.read_text(encoding="utf-8"))
                expected = {
                    "spring.application.name": f"storyfork-{service}-service",
                    "server.address": "127.0.0.1",
                    "server.port": port,
                }
                self.assertEqual(expected, {key: config["application"][key] for key in expected})
                if service == "operations":
                    settings = config["application"]
                    self.assertEqual("validate", settings["spring.jpa.hibernate.ddl-auto"])
                    self.assertEqual("false", settings["spring.jpa.open-in-view"])
                    self.assertEqual("operations", settings["spring.jpa.properties.hibernate.default_schema"])
                    self.assertEqual("UTC", settings["spring.jpa.properties.hibernate.jdbc.time_zone"])
                    self.assertEqual("classpath:db/migration/operations", settings["spring.flyway.locations"])
                    self.assertEqual("operations", settings["spring.flyway.schemas"])
                    self.assertEqual("operations_flyway_schema_history", settings["spring.flyway.table"])
                    self.assertEqual("${OPERATIONS_SERVICE_TOKEN:}", settings["app.operations.service-token"])
                    self.assertEqual("20", settings["spring.data.web.pageable.default-page-size"])
                    self.assertEqual("100", settings["spring.data.web.pageable.max-page-size"])
                else:
                    self.assertNotIn("app.content.enabled", config["application"])
                    self.assertNotIn("spring.datasource.url", config["application"])
                    self.assertNotIn("spring.flyway.locations", config["application"])

    def test_core_flyway_includes_sample_migrations_in_normal_order(self):
        properties = (ROOT / "backend/core-api/src/main/resources/application.properties").read_text(encoding="utf-8")
        self.assertIn("spring.flyway.locations=classpath:db/migration/auth,classpath:db/migration/notification,classpath:db/migration/credit,classpath:db/migration/sample\n", properties)
        self.assertNotIn("out-of-order", properties)

    def test_signup_trial_credit_is_turned_on_only_by_configuration_and_is_off_by_default(self):
        # 가입 체험 크레딧은 팀 결정 전이라 기본 0(지급 안 함)이다. 값은 환경 설정(CREDIT_SIGNUP_TRIAL_AMOUNT)으로만 켜고 Core에만 넘긴다.
        properties = (ROOT / "backend/core-api/src/main/resources/application.properties").read_text(encoding="utf-8")
        self.assertIn("app.credit.signup-trial-amount=${CREDIT_SIGNUP_TRIAL_AMOUNT:0}\n", properties)
        self.assertRegex((ROOT / ".env.example").read_text(encoding="utf-8"), r"(?m)^CREDIT_SIGNUP_TRIAL_AMOUNT=0$")
        compose = (ROOT / "infrastructure/docker-compose.yaml").read_text(encoding="utf-8")
        core = compose.split("\n  core-api:\n", 1)[1].split("\n  content-service:\n", 1)[0]
        self.assertIn("CREDIT_SIGNUP_TRIAL_AMOUNT: ${CREDIT_SIGNUP_TRIAL_AMOUNT:-0}", core)
        self.assertNotIn("CREDIT_SIGNUP_TRIAL_AMOUNT", compose.replace(core, ""))

    def test_ai_serial_credit_limits_reach_only_content_with_the_same_defaults_everywhere(self):
        # AI 자율 연재(#659)의 크레딧 예약 상한이다(시뮬레이션 5·선택지 5·회차 요약 5·회차 150). 코드 기본값·.env.example·base compose가 같은 값이고 Content에만 넘긴다.
        example = (ROOT / ".env.example").read_text(encoding="utf-8")
        self.assertRegex(example, r"(?m)^SERIAL_SIMULATION_CREDIT_LIMIT=5$")
        self.assertRegex(example, r"(?m)^SERIAL_CHOICE_CREDIT_LIMIT=5$")
        self.assertRegex(example, r"(?m)^SERIAL_SUMMARY_CREDIT_LIMIT=5$")
        self.assertRegex(example, r"(?m)^SERIAL_EPISODE_CREDIT_LIMIT=150$")
        runner = (ROOT / "backend/content-service/src/main/kotlin/ai/storyfork/content/serial/service/SerialRunner.kt").read_text(encoding="utf-8")
        self.assertIn(r"\${SERIAL_SIMULATION_CREDIT_LIMIT:5}", runner)
        self.assertIn(r"\${SERIAL_CHOICE_CREDIT_LIMIT:5}", runner)
        self.assertIn(r"\${SERIAL_SUMMARY_CREDIT_LIMIT:5}", runner)
        self.assertIn(r"\${SERIAL_EPISODE_CREDIT_LIMIT:150}", runner)
        compose = (ROOT / "infrastructure/docker-compose.yaml").read_text(encoding="utf-8")
        content = compose.split("\n  content-service:\n", 1)[1].split("\n  operations-service:\n", 1)[0]
        self.assertIn("SERIAL_SIMULATION_CREDIT_LIMIT: ${SERIAL_SIMULATION_CREDIT_LIMIT:-5}", content)
        self.assertIn("SERIAL_CHOICE_CREDIT_LIMIT: ${SERIAL_CHOICE_CREDIT_LIMIT:-5}", content)
        self.assertIn("SERIAL_SUMMARY_CREDIT_LIMIT: ${SERIAL_SUMMARY_CREDIT_LIMIT:-5}", content)
        self.assertIn("SERIAL_EPISODE_CREDIT_LIMIT: ${SERIAL_EPISODE_CREDIT_LIMIT:-150}", content)
        self.assertNotIn("SERIAL_", compose.replace(content, ""))

    def test_content_service_is_always_enabled_without_feature_flag(self):
        sources = (ROOT / "backend/content-service/src").rglob("*.kt")
        self.assertEqual([], [str(p) for p in sources if "app.content.enabled" in p.read_text(encoding="utf-8")])
        for path in (".env.example", "infrastructure/docker-compose.yaml", "infrastructure/ci/compose.test.yaml",
                     ".github/workflows/ci.yml"):
            self.assertNotIn("CONTENT_ENABLED", (ROOT / path).read_text(encoding="utf-8"), path)

    def test_worldstudio_and_notification_events_are_always_on_in_every_environment(self):
        # local·개발 배포는 같은 구성이다. 기능 플래그·compose profile 없이 Neo4j·RabbitMQ를 항상 띄운다.
        for service, flag in (("content-service", "app.worldstudio.enabled"), ("core-api", "app.notification.events.enabled")):
            sources = list((ROOT / "backend" / service / "src").rglob("*.kt")) + list((ROOT / "backend" / service / "src/main/resources").glob("*.properties"))
            self.assertEqual([], [str(p) for p in sources if flag in p.read_text(encoding="utf-8")], flag)
        for path in (".env.example", "infrastructure/docker-compose.yaml", "infrastructure/docker-compose.local.yaml",
                     "infrastructure/docker-compose.dev.yaml", "infrastructure/ci/compose.test.yaml",
                     ".github/workflows/ci.yml", ".github/workflows/publish-images.yml"):
            text = (ROOT / path).read_text(encoding="utf-8")
            for name in ("APP_WORLDSTUDIO_ENABLED", "CORE_NOTIFICATION_EVENTS_ENABLED", "WORLDSTUDIO_CD_MIGRATION_ENABLED",
                         "worldstudio-migrate", "profiles: [worldstudio]", "profiles: [events]"):
                self.assertNotIn(name, text, f"{path}: {name}")
        dev = (ROOT / "infrastructure/docker-compose.dev.yaml").read_text(encoding="utf-8")
        for service in ("neo4j", "rabbitmq"):
            self.assertIn(f"\n  {service}:\n", dev)
        local = (ROOT / "infrastructure/docker-compose.local.yaml").read_text(encoding="utf-8")
        self.assertIn('"127.0.0.1:${OPERATIONS_SERVICE_PORT:-8082}:8082"', local)

    def test_manuscript_index_is_always_on_in_every_environment(self):
        # 2026-11-22 사용자 결정: 원고 색인(Elasticsearch)은 끄는 플래그 없이 항상 켠다. local·개발은 elasticsearch 서비스를 항상 띄우고 Content가 healthy를 기다리며,
        # CI 통합 job은 content일 때 같은 이미지를 service로 띄우고 시스템 overlay는 호스트 포트를 열지 않는다. 운영 overlay는 외부 Elasticsearch 주소를 요구한다.
        sources = list((ROOT / "backend/content-service/src/main").rglob("*.kt")) + list((ROOT / "backend/content-service/src/main/resources").glob("*.properties"))
        self.assertEqual([], [str(p) for p in sources if "MANUSCRIPT_INDEX_ENABLED" in p.read_text(encoding="utf-8") or "app.manuscript-index.enabled" in p.read_text(encoding="utf-8")])
        files = (".env.example", "infrastructure/docker-compose.yaml", "infrastructure/docker-compose.local.yaml", "infrastructure/docker-compose.dev.yaml",
                 "infrastructure/docker-compose.prod.yaml", "infrastructure/ci/compose.test.yaml", ".github/workflows/ci.yml", ".github/workflows/publish-images.yml")
        for path in files:
            self.assertNotIn("MANUSCRIPT_INDEX_ENABLED", (ROOT / path).read_text(encoding="utf-8"), path)

        def service(text, name):
            return text.split("\n  " + name + ":\n", 1)[1].split("\n\n", 1)[0]

        standalone = (ROOT / "infrastructure/docker-compose.elasticsearch.yaml").read_text(encoding="utf-8")
        local = (ROOT / "infrastructure/docker-compose.local.yaml").read_text(encoding="utf-8")
        dev = (ROOT / "infrastructure/docker-compose.dev.yaml").read_text(encoding="utf-8")
        for name, compose in (("local", local), ("dev", dev)):
            content = service(compose, "content-service")
            self.assertIn("elasticsearch:\n        condition: service_healthy", content, name)
            self.assertIn("MANUSCRIPT_INDEX_URL: http://elasticsearch:9200", content, name)
            self.assertNotIn("host.docker.internal", content, name)
        # local의 서비스 정의는 네이티브 Content용 단독 실행 파일과 같은 공식 이미지·설정이다.
        for setting in ("image: docker.elastic.co/elasticsearch/elasticsearch:9.5.6", "discovery.type: single-node", 'xpack.security.enabled: "false"',
                        "manuscript-index:/usr/share/elasticsearch/data", "mem_limit: 1g"):
            self.assertIn(setting, standalone, setting)
            self.assertIn(setting, service(local, "elasticsearch"), setting)
        self.assertIn("healthcheck:", service(local, "elasticsearch"))
        self.assertIn("\n  manuscript-index:\n", local)
        self.assertIn("SEARCH_INDEX_URL: http://elasticsearch:9200", service(local, "content-service"))
        overlay = (ROOT / "infrastructure/ci/compose.test.yaml").read_text(encoding="utf-8")
        self.assertIn("ports: !reset []", service(overlay, "elasticsearch"))
        integration = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8").split("\n  integration:\n", 1)[1].split("\n  system:\n", 1)[0]
        self.assertIn("matrix.service == 'content' && 'docker.elastic.co/elasticsearch/elasticsearch:9.5.6'", integration)
        self.assertIn('ports: ["127.0.0.1:9200:9200"]', integration)
        self.assertIn('"$RUNNER_TEMP/elasticsearch.log"', integration)
        prod = (ROOT / "infrastructure/docker-compose.prod.yaml").read_text(encoding="utf-8")
        self.assertIn("MANUSCRIPT_INDEX_URL: ${MANUSCRIPT_INDEX_URL:?", service(prod, "content-service"))

    def test_attachments_and_deploy_have_no_on_off_switches(self):
        # 첨부(MinIO)도 항상 켠다. 배포는 승인 변수 없이 develop 머지마다 실행한다.
        sources = (ROOT / "backend/content-service/src").rglob("*.kt")
        self.assertEqual([], [str(p) for p in sources if "setting-attachments.enabled" in p.read_text(encoding="utf-8")])
        self.assertFalse((ROOT / "infrastructure/compose.attachments.yaml").exists())
        for path in (".env.example", "backend/content-service/src/main/resources/application.properties",
                     "infrastructure/docker-compose.local.yaml", "infrastructure/docker-compose.dev.yaml",
                     ".github/workflows/publish-images.yml", ".github/workflows/ci.yml"):
            text = (ROOT / path).read_text(encoding="utf-8")
            for name in ("SETTING_ATTACHMENTS_ENABLED", "setting-attachments.enabled", "compose.attachments",
                         "DEVELOP_CD_ENABLED", "CONTENT_FRESH_SCHEMA_APPROVED", "DEVELOP_INTERNAL_DB_APPROVED"):
                self.assertNotIn(name, text, f"{path}: {name}")
        for path in ("infrastructure/docker-compose.local.yaml", "infrastructure/docker-compose.dev.yaml"):
            compose = (ROOT / path).read_text(encoding="utf-8")
            self.assertIn("\n  minio:\n", compose)
            for secret in ("OPERATIONS_SERVICE_TOKEN", "OPENAI_API_KEY", "INTERNAL_TOKEN", "CONTENT_CORE_AUTH_TOKEN"):
                self.assertIn("${" + secret + ":?", compose, f"{path}: {secret}")

    def test_minio_is_built_once_per_pinned_version_and_reused(self):
        # 고정 버전 이미지는 내용이 같으므로 ghcr에 그 태그가 없을 때만 한 번 빌드한다.
        import re
        version = re.search(r"--branch (RELEASE\.[0-9TZ-]+)", (ROOT / "infrastructure/minio/Dockerfile").read_text(encoding="utf-8")).group(1)
        image = "ghcr.io/sknetworks-family-aicamp/storyfork-minio:" + version
        for path in ("infrastructure/docker-compose.local.yaml", "infrastructure/docker-compose.dev.yaml", "infrastructure/ci/compose.test.yaml"):
            self.assertIn("image: " + image, (ROOT / path).read_text(encoding="utf-8"), path)
        self.assertIn("build: !reset null", (ROOT / "infrastructure/ci/compose.test.yaml").read_text(encoding="utf-8"))
        publish = (ROOT / ".github/workflows/publish-images.yml").read_text(encoding="utf-8")
        self.assertNotIn("ai-service minio; do", publish)
        self.assertIn('docker manifest inspect "$minio"', publish)
        ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertIn('docker pull "$minio" || docker build --load', ci)

    def test_attachment_integration_tests_run_in_ci_against_minio(self):
        # TEST_ATTACHMENT_*가 없으면 첨부 통합 테스트가 조건부 skip된다. CI가 직접 MinIO·전용 DB를 준비한다.
        integration = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8").split("\n  integration:\n", 1)[1].split("\n  system:\n", 1)[0]
        for name in ("TEST_ATTACHMENT_DATABASE_URL: jdbc:postgresql://127.0.0.1:5432/attachment_test",
                     "TEST_ATTACHMENT_S3_ENDPOINT: http://127.0.0.1:19087", "AWS_ACCESS_KEY_ID:", "AWS_SECRET_ACCESS_KEY:",
                     "createdb -U content_test attachment_test", "127.0.0.1:19087:9000", "packages: read"):
            self.assertIn(name, integration)

    def test_system_images_reuse_github_actions_layer_cache(self):
        overlay = (ROOT / "infrastructure/ci/compose.test.yaml").read_text(encoding="utf-8")
        for service in ("ai-service", "core-api", "content-service", "operations-service", "web"):
            self.assertIn(f"cache_from: [\"type=gha,scope={service}\"]", overlay, service)
            self.assertIn(f"cache_to: [\"type=gha,scope={service},mode=max\"]", overlay, service)
        system = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8").split("\n  system:\n", 1)[1]
        self.assertIn("docker/setup-buildx-action@", system)
        self.assertIn("crazy-max/ghaction-github-runtime@", system)

    def test_content_boot_entry_point_is_explicit(self):
        service = ROOT / "backend/content-service"
        build = (service / "build.gradle").read_text(encoding="utf-8")
        self.assertRegex(build, r"springBoot\s*\{\s*mainClass\s*=\s*'ai\.storyfork\.content\.ApplicationKt'\s*\}")
        application = service / "src/main/kotlin/ai/storyfork/content/Application.kt"
        self.assertIn("runApplication<ContentServiceApplication>(*args)", application.read_text(encoding="utf-8"))

    def test_gradle_image_builds_lock_the_shared_user_home_cache(self):
        for service in ("core-api", "content-service"):
            with self.subTest(service=service):
                dockerfile = (ROOT / "backend" / service / "Dockerfile").read_text(encoding="utf-8")
                self.assertIn(
                    "RUN --mount=type=cache,target=/root/.gradle,sharing=locked \\\n"
                    "    ./gradlew bootJar --no-daemon",
                    dockerfile,
                )

    def test_each_independent_build_reuses_core_wrapper_bytes_and_executable_mode(self):
        for service in SERVICES:
            for name in ("gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.jar",
                         "gradle/wrapper/gradle-wrapper.properties"):
                with self.subTest(service=service, file=name):
                    source = ROOT / "backend/core-api" / name
                    target = ROOT / f"backend/{service}-service" / name
                    self.assertTrue(target.is_file(), f"wrapper 파일 누락: {target.relative_to(ROOT)}")
                    self.assertEqual(source.read_bytes(), target.read_bytes())
                    if name == "gradlew":
                        self.assertEqual(source.stat().st_mode & 0o777, target.stat().st_mode & 0o777)


if __name__ == "__main__":
    unittest.main()
