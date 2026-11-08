"""배포 원격 명령을 fake Docker로 실행하는 순수 단위 회귀. DB/SSH는 사용하지 않는다."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]


class WorldStudioDeploymentTest(unittest.TestCase):
    def test_migration_reuses_core_credentials_without_worldstudio_connection(self):
        compose = (ROOT / "infrastructure/docker-compose.dev.yaml").read_text(encoding="utf-8")
        migration = compose.split("  worldstudio-migrate:", 1)[1].split("\n  web:", 1)[0]
        self.assertIn('CONTENT_DATABASE_URL: jdbc:postgresql://postgres:5432/storyfork', migration)
        for key in ("USER", "PASSWORD"):
            self.assertIn("CONTENT_DATABASE_" + key + ": ${CORE_DATABASE_" + key, migration)
        self.assertNotIn("WORLDSTUDIO_DATABASE_", compose)
        self.assertNotIn("WORLDSTUDIO_DATABASE_", (ROOT / ".env.example").read_text(encoding="utf-8"))

    def deploy(self, enabled, migration_exit=0, overrides=None):
        bash = shutil.which("bash")
        if os.name == "nt":
            bash = "C:/Program Files/Git/bin/bash.exe"
        workflow = (ROOT / ".github/workflows/publish-images.yml").read_text(encoding="utf-8")
        script = textwrap.dedent(workflow.split("cat <<'REMOTE'", 1)[1].split("\n          REMOTE", 1)[0])
        with tempfile.TemporaryDirectory(dir=ROOT if os.name == "nt" else None) as directory:
            path = Path(directory).resolve()
            directory = str(path)
            (path / ".env").touch()
            docker = path / "docker"
            docker.write_text('#!/bin/bash\n'
                '[[ -z "${COMPOSE_PROFILES:-}" ]] || exit 24\n'
                'echo "$*" >> "$TEST_COMMANDS"\n'
                'case "$*" in\n'
                ' "image inspect"*)\n'
                '   [[ "${CD_LOCAL_COMPOSE_FILE:-}" == "$DOCKER_CONFIG/docker-compose.local.yaml" && -f "${CD_LOCAL_COMPOSE_FILE:-}" ]] || exit 25\n'
                '   [[ "$3 $4 $5 $6" == "$CD_WEB_IMAGE $CD_CORE_API_IMAGE $CD_CONTENT_SERVICE_IMAGE $CD_AI_SERVICE_IMAGE" ]] || exit 26\n'
                '   printf "%040d\\n" 1 ;;\n'
                ' *"run --rm --no-deps worldstudio-migrate"*)\n'
                '   cat > "$TEST_CONSUMED_STDIN"\n'
                '   if [[ -s "$TEST_CONSUMED_STDIN" ]]; then echo "migration stdin consumed" >> "$TEST_COMMANDS";\n'
                '   else echo "migration stdin empty" >> "$TEST_COMMANDS"; fi\n'
                '   exit "$TEST_MIGRATION_EXIT" ;;\n'
                'esac\n', encoding="utf-8")
            docker.chmod(0o755)
            env = dict(os.environ, CD_DIRECTORY=directory.replace("\\", "/"), CD_WEB_PORT="8088", TARGET_SHA="%040d" % 1,
                GITHUB_ACTOR="test", GH_TOKEN="fake-token", COMPOSE_BASE_YAML="", COMPOSE_DEV_YAML="", COMPOSE_LOCAL_YAML="",
                WORLDSTUDIO_CD_MIGRATION_ENABLED=enabled, CONTENT_FRESH_SCHEMA_APPROVED="true", DEVELOP_INTERNAL_DB_APPROVED="true",
                WORLDSTUDIO_EXPECTED_DATABASE_URL="jdbc:postgresql://postgres:5432/storyfork",
                WORLDSTUDIO_EXPECTED_DATABASE_USER="qa", WORLDSTUDIO_BACKUP_RESTORE_REFERENCE="qa-restored",
                TEST_COMMANDS=str(path / "commands"), TEST_MIGRATION_EXIT=str(migration_exit),
                TEST_CONSUMED_STDIN=str(path / "migration-stdin"))
            env.update(overrides or {})
            # Git Bash translates native Windows paths before the deployment's physical-path check.
            if os.name == "nt":
                env["CD_DIRECTORY"] = "/" + env["CD_DIRECTORY"][0].lower() + env["CD_DIRECTORY"][2:]
            result = subprocess.run([bash, "-se"], input='export PATH="$TEST_BIN:$PATH"\n' + script,
                env=dict(env, TEST_BIN=env["CD_DIRECTORY"]), capture_output=True, text=True)
            commands = (path / "commands").read_text() if (path / "commands").exists() else ""
            return result.returncode, commands, result.stderr

    def test_unapproved_content_cutover_never_stops_or_starts_services(self):
        code, commands, _ = self.deploy("false", overrides={"CONTENT_FRESH_SCHEMA_APPROVED": ""})
        self.assertNotEqual(0, code)
        self.assertNotIn("stop web core-api content-service", commands)
        self.assertNotIn("up -d --no-build --pull never --wait --wait-timeout 180\n", commands)

    def test_unapproved_internal_database_never_starts_new_resources(self):
        code, commands, _ = self.deploy("false", overrides={"DEVELOP_INTERNAL_DB_APPROVED": ""})
        self.assertNotEqual(0, code)
        self.assertEqual('', commands)

    def test_old_writer_and_public_ingress_stop_before_any_migration_or_new_writer(self):
        code, commands, error = self.deploy("true")
        self.assertEqual(0, code, error)
        self.assertLess(commands.index("stop web core-api content-service"), commands.index("run --rm --no-deps worldstudio-migrate"))
        self.assertLess(commands.index("stop web core-api content-service"), commands.index("postgres mailpit"))
        self.assertLess(commands.index("postgres mailpit"), commands.index("run --rm --no-deps worldstudio-migrate"))

    def test_disabled_preserves_deployment_without_migration(self):
        code, commands, error = self.deploy("false")
        self.assertEqual(0, code, error)
        self.assertIn("up -d --no-build --pull never --wait --wait-timeout 180\n", commands)
        self.assertNotIn("run --rm", commands)

    def test_migration_success_precedes_new_core(self):
        code, commands, error = self.deploy("true")
        self.assertEqual(0, code, error)
        self.assertIn("migration stdin empty", commands)
        self.assertIn("up -d --no-build --pull never --wait --wait-timeout 180\n", commands)
        self.assertLess(commands.index("run --rm --no-deps worldstudio-migrate"), commands.index("up -d --no-build --pull never --wait --wait-timeout 180\n"))

    def test_migration_failure_stops_new_core(self):
        code, commands, _ = self.deploy("true", 23)
        self.assertEqual(23, code)
        self.assertNotIn("up -d --no-build --pull never --wait --wait-timeout 180\n", commands)

    def test_unknown_flag_fails_closed(self):
        code, commands, _ = self.deploy("treu")
        self.assertNotEqual(0, code)
        self.assertNotIn("stop web core-api content-service", commands)
        self.assertNotIn("up -d --no-build --pull never --wait --wait-timeout 180\n", commands)

    def test_inherited_profile_cannot_bypass_github_activation(self):
        code, commands, error = self.deploy("false", overrides={"COMPOSE_PROFILES": "worldstudio-migration"})
        self.assertEqual(0, code, error)
        self.assertIn("up -d --no-build --pull never --wait --wait-timeout 180\n", commands)
        self.assertNotIn("run --rm", commands)

    def test_missing_target_or_restore_proof_stops_before_migration(self):
        for key in ("WORLDSTUDIO_EXPECTED_DATABASE_URL", "WORLDSTUDIO_EXPECTED_DATABASE_USER",
                    "WORLDSTUDIO_BACKUP_RESTORE_REFERENCE"):
            code, commands, _ = self.deploy("true", overrides={key: ""})
            self.assertNotEqual(0, code)
            self.assertNotIn("stop web core-api content-service", commands)
            self.assertNotIn("run --rm", commands)
            self.assertNotIn("up -d --no-build --pull never --wait --wait-timeout 180\n", commands)

    def test_image_revision_other_than_run_target_stops_before_ingress(self):
        code, commands, _ = self.deploy("false", overrides={"TARGET_SHA": "%040d" % 2})
        self.assertNotEqual(0, code)
        self.assertNotIn("stop web core-api content-service", commands)

    def test_publish_requires_target_to_be_current_develop_head(self):
        workflow = (ROOT / ".github/workflows/publish-images.yml").read_text(encoding="utf-8")
        publish = workflow.split("  publish:", 1)[1].split("\n  deploy:", 1)[0]
        check = publish.index('gh api "repos/$GITHUB_REPOSITORY/commits/develop" --jq .sha')
        self.assertIn('[[ "$head" == "$TARGET_SHA" ]]', publish)
        self.assertLess(check, publish.index("docker build"))
