"""첨부의 문서·Compose 설정 계약 검사. 앱·DB·컨테이너는 실행하지 않는다."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]


class AttachmentEnvironmentTest(unittest.TestCase):
    def test_native_guidance_scopes_s3_settings_to_content_command(self):
        self.assertFalse((ROOT / "infrastructure/scripts/run-native.py").exists())
        readme = (ROOT / "infrastructure/README.md").read_text(encoding="utf-8")
        native = readme.split("### 네이티브 Content 첨부 설정\n", 1)[1].split("\n## ", 1)[0]
        command = native.split("```bash\n", 1)[1].split("```", 1)[0]
        tokens = shlex.split(command.replace("\\\n", " "))
        self.assertEqual("env", tokens[0])
        self.assertEqual(["./gradlew", "bootRun"], tokens[-2:])
        settings = dict(token.split("=", 1) for token in tokens[1:-2])
        self.assertEqual({"SETTING_ATTACHMENTS_ENABLED", "ATTACHMENT_S3_ENDPOINT",
                          "ATTACHMENT_S3_REGION", "ATTACHMENT_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"}, set(settings))
        self.assertEqual("true", settings["SETTING_ATTACHMENTS_ENABLED"])
        self.assertEqual("http://127.0.0.1:9000", settings["ATTACHMENT_S3_ENDPOINT"])
        for key in ("AWS_SESSION_TOKEN", "AWS_REGION", "AWS_PROFILE"):
            self.assertIn(key, native)
        self.assertIn("루트 `.env` 전체를 source하지 않습니다", readme)
        self.assertNotIn("OPENAI_API_KEY", settings)

    def test_optional_compose_preserves_base_and_isolates_local_credentials(self):
        env = {key: value for key, value in os.environ.items() if key in ("PATH", "HOME", "DOCKER_CONFIG", "SystemRoot")}
        env.update(DATABASE_USER="synthetic-user", DATABASE_PASSWORD="synthetic-db", AUTH_JWT_SECRET="synthetic-jwt",
                   INTERNAL_TOKEN="synthetic-internal", OPENAI_API_KEY="synthetic-ai-key", NEO4J_PASSWORD="synthetic-graph",
                   CORE_RABBITMQ_PASSWORD="synthetic-broker",
                   AWS_ACCESS_KEY_ID="synthetic-s3-id", AWS_SECRET_ACCESS_KEY="synthetic-s3-secret")
        command = ["docker", "compose", "--env-file", str(ROOT / ".env.example"), "-f", str(ROOT / "infrastructure/docker-compose.yaml"),
                   "-f", str(ROOT / "infrastructure/docker-compose.local.yaml")]

        def config(args):
            result = subprocess.run(args + ["config", "--format", "json"], env=env, capture_output=True, text=True, check=True)
            return json.loads(result.stdout)

        base = config(command)
        combined = config(command + ["-f", str(ROOT / "infrastructure/compose.attachments.yaml")])
        services = combined["services"]
        self.assertEqual(base["services"]["postgres"], services["postgres"])
        self.assertEqual(base["volumes"], {name: value for name, value in combined["volumes"].items() if name in base["volumes"]})
        self.assertEqual(set(base["services"]) | {"minio"}, set(services))
        for name, service in services.items():
            settings = service.get("environment", {})
            for key in ("SETTING_ATTACHMENTS_ENABLED", "ATTACHMENT_S3_ENDPOINT", "ATTACHMENT_S3_REGION", "ATTACHMENT_S3_BUCKET",
                        "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
                self.assertEqual(name == "content-service", key in settings)
                self.assertNotIn(key, service.get("build", {}).get("args", {}))
            self.assertEqual(name == "ai-service", "OPENAI_API_KEY" in settings)
            self.assertNotIn("env_file", service)
            for port in service.get("ports", []):
                self.assertEqual("127.0.0.1", port["host_ip"])
        self.assertEqual("synthetic-s3-id", services["minio"]["environment"]["MINIO_ROOT_USER"])
        self.assertEqual("synthetic-s3-secret", services["minio"]["environment"]["MINIO_ROOT_PASSWORD"])
        content = services["content-service"]["environment"]
        self.assertEqual("true", content["SETTING_ATTACHMENTS_ENABLED"])
        self.assertEqual("http://minio:9000", content["ATTACHMENT_S3_ENDPOINT"])
        self.assertEqual("storyfork-setting-attachments", content["ATTACHMENT_S3_BUCKET"])
        self.assertEqual("us-east-1", content["ATTACHMENT_S3_REGION"])
        self.assertEqual("synthetic-s3-id", content["AWS_ACCESS_KEY_ID"])
        self.assertEqual("synthetic-s3-secret", content["AWS_SECRET_ACCESS_KEY"])
        self.assertEqual("service_healthy", services["content-service"]["depends_on"]["minio"]["condition"])
        self.assertEqual(base["services"]["content-service"]["build"], services["content-service"]["build"])
        self.assertEqual("/data", services["minio"]["volumes"][0]["target"])
        self.assertEqual("volume", services["minio"]["volumes"][0]["type"])
        for name in set(base["services"]) - {"content-service"}:
            self.assertEqual(base["services"][name], services[name])

    def test_example_has_active_local_and_commented_aws_settings(self):
        example = (ROOT / ".env.example").read_text(encoding="utf-8")
        self.assertIn("ATTACHMENT_S3_ENDPOINT=http://127.0.0.1:9000", example)
        self.assertIn("# ATTACHMENT_S3_ENDPOINT=", example)
        self.assertIn("# ATTACHMENT_S3_REGION=ap-northeast-2", example)
