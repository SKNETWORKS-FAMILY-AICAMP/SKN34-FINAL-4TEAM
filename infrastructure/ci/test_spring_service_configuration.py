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
        self.assertIn("spring.flyway.locations=classpath:db/migration/auth,classpath:db/migration/notification,classpath:db/migration/sample\n", properties)
        self.assertNotIn("out-of-order", properties)

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
        publish = (ROOT / ".github/workflows/publish-images.yml").read_text(encoding="utf-8")
        self.assertIn("operations-service ai-service minio; do", publish)
        self.assertIn('"$CD_MINIO_IMAGE"', publish)

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
