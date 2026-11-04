"""신규 Spring 앱의 정적 설정·wrapper 계약만 검사한다. JVM·Spring·HTTP는 실행하지 않는다."""
from configparser import ConfigParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SERVICES = {"content": "8081", "operations": "8082"}


class SpringServiceConfigurationTest(unittest.TestCase):
    def test_native_defaults_are_distinct_loopback_only_and_need_no_external_settings(self):
        # 현재 설정은 escape·continuation 없는 단순 key=value 세 개다.
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
                    self.assertEqual(expected, dict(config["application"]))
                else:
                    self.assertEqual("${CONTENT_ENABLED:false}", config["application"]["app.content.enabled"])
                    self.assertNotIn("spring.datasource.url", config["application"])
                    self.assertNotIn("spring.flyway.locations", config["application"])

    def test_content_boot_entry_point_is_explicit_while_studio_migration_remains_available(self):
        service = ROOT / "backend/content-service"
        build = (service / "build.gradle").read_text(encoding="utf-8")
        self.assertRegex(build, r"springBoot\s*\{\s*mainClass\s*=\s*'ai\.storyfork\.content\.ApplicationKt'\s*\}")
        application = service / "src/main/kotlin/ai/storyfork/content/Application.kt"
        self.assertIn("runApplication<ContentServiceApplication>(*args)", application.read_text(encoding="utf-8"))
        migration = service / "src/main/kotlin/ai/storyfork/content/world/migration/WorldStudioMigration.kt"
        self.assertIn("fun main(args: Array<String>)", migration.read_text(encoding="utf-8"))

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
