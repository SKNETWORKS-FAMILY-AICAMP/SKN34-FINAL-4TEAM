import importlib.util
import os
from pathlib import Path
import json
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("native_attachments", ROOT / "infrastructure/scripts/run-native.py")
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class AttachmentEnvironmentTest(unittest.TestCase):
    def test_s3_settings_and_credentials_are_core_only(self):
        values = {key: "synthetic" for key in (
            "SETTING_ATTACHMENTS_ENABLED", "ATTACHMENT_S3_ENDPOINT", "ATTACHMENT_S3_REGION", "ATTACHMENT_S3_BUCKET",
            "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_PROFILE",
        )}
        with patch.dict(os.environ, values):
            core = native.service_environment("core-api", values)
            for key, value in values.items():
                self.assertEqual(value, core.get(key), key)
            for service in ("web", "ai-service"):
                env = native.service_environment(service, values)
                for key in values:
                    self.assertNotIn(key, env, (service, key))

    def test_optional_compose_preserves_base_and_isolates_local_credentials(self):
        env = {key: value for key, value in os.environ.items() if key in ("PATH", "HOME", "DOCKER_CONFIG", "SystemRoot")}
        env.update(CORE_DATABASE_USER="synthetic-user", CORE_DATABASE_PASSWORD="synthetic-db", AUTH_JWT_SECRET="synthetic-jwt",
                   INTERNAL_TOKEN="synthetic-internal", AWS_ACCESS_KEY_ID="synthetic-s3-id", AWS_SECRET_ACCESS_KEY="synthetic-s3-secret")
        command = ["docker", "compose", "--env-file", str(ROOT / ".env.example"), "-f", str(ROOT / "infrastructure/compose.yaml"),
                   "-f", str(ROOT / "infrastructure/compose.content.yaml")]
        def config(args):
            result = subprocess.run(args + ["config", "--format", "json"], env=env, capture_output=True, text=True, check=True)
            return json.loads(result.stdout)
        base = config(command)
        combined = config(command + ["-f", str(ROOT / "infrastructure/compose.attachments.yaml")])
        services = combined["services"]
        self.assertEqual(base["services"]["postgres"], services["postgres"])
        self.assertEqual(set(base["services"]) | {"minio"}, set(services))
        for name, service in services.items():
            settings = service.get("environment", {})
            for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
                self.assertEqual(name == "core-api", key in settings)
            self.assertNotIn("env_file", service)
            for port in service.get("ports", []):
                self.assertEqual("127.0.0.1", port["host_ip"])
        self.assertEqual("synthetic-s3-id", services["minio"]["environment"]["MINIO_ROOT_USER"])
        self.assertEqual("http://minio:9000", services["core-api"]["environment"]["ATTACHMENT_S3_ENDPOINT"])
        for name in set(base["services"]) - {"core-api"}:
            self.assertEqual(base["services"][name], services[name])

    def test_example_has_active_local_and_commented_aws_settings(self):
        example = (ROOT / ".env.example").read_text(encoding="utf-8")
        self.assertIn("ATTACHMENT_S3_ENDPOINT=http://127.0.0.1:9000", example)
        self.assertIn("# ATTACHMENT_S3_ENDPOINT=", example)
        self.assertIn("# ATTACHMENT_S3_REGION=ap-northeast-2", example)
