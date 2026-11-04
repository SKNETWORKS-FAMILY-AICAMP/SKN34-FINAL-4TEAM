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
    def deploy(self, enabled, migration_exit=0, overrides=None):
        bash = shutil.which("bash")
        if os.name == "nt":
            bash = "C:/Program Files/Git/bin/bash.exe"
        workflow = (ROOT / ".github/workflows/publish-images.yml").read_text(encoding="utf-8")
        script = textwrap.dedent(workflow.split("cat <<'REMOTE'", 1)[1].split("\n          REMOTE", 1)[0])
        with tempfile.TemporaryDirectory(dir=ROOT if os.name == "nt" else None) as directory:
            path = Path(directory)
            (path / ".env").touch()
            docker = path / "docker"
            docker.write_text('#!/bin/bash\n'
                'echo "$*" >> "$TEST_COMMANDS"\n'
                'case "$*" in\n'
                ' *"config --images"*) echo fake-core ;;\n'
                ' "image inspect"*) printf "%040d\\n" 1 ;;\n'
                ' *"run --rm --no-deps worldstudio-migrate"*) exit "$TEST_MIGRATION_EXIT" ;;\n'
                'esac\n', encoding="utf-8")
            docker.chmod(0o755)
            env = dict(os.environ, CD_DIRECTORY=directory.replace("\\", "/"), CD_WEB_PORT="8088",
                GITHUB_ACTOR="test", GH_TOKEN="fake-token", COMPOSE_BASE_YAML="", COMPOSE_DEV_YAML="",
                WORLDSTUDIO_CD_MIGRATION_ENABLED=enabled,
                WORLDSTUDIO_EXPECTED_DATABASE_URL="jdbc:postgresql://qa:5432/qa",
                WORLDSTUDIO_EXPECTED_DATABASE_USER="qa", WORLDSTUDIO_BACKUP_RESTORE_REFERENCE="qa-restored",
                TEST_COMMANDS=str(path / "commands"), TEST_MIGRATION_EXIT=str(migration_exit))
            env.update(overrides or {})
            # Git Bash translates native Windows paths before the deployment's physical-path check.
            if os.name == "nt":
                env["CD_DIRECTORY"] = "/" + env["CD_DIRECTORY"][0].lower() + env["CD_DIRECTORY"][2:]
            result = subprocess.run([bash, "-c", 'export PATH="$TEST_BIN:$PATH"\n' + script],
                env=dict(env, TEST_BIN=env["CD_DIRECTORY"]), capture_output=True, text=True)
            commands = (path / "commands").read_text() if (path / "commands").exists() else ""
            return result.returncode, commands, result.stderr

    def test_disabled_preserves_deployment_without_migration(self):
        code, commands, error = self.deploy("false")
        self.assertEqual(0, code, error)
        self.assertIn("up -d", commands)
        self.assertNotIn("run --rm", commands)

    def test_migration_success_precedes_new_core(self):
        code, commands, error = self.deploy("true")
        self.assertEqual(0, code, error)
        self.assertLess(commands.index("run --rm --no-deps worldstudio-migrate"), commands.index("up -d"))

    def test_migration_failure_stops_new_core(self):
        code, commands, _ = self.deploy("true", 23)
        self.assertNotEqual(0, code)
        self.assertNotIn("up -d", commands)

    def test_unknown_flag_fails_closed(self):
        code, commands, _ = self.deploy("treu")
        self.assertNotEqual(0, code)
        self.assertNotIn("up -d", commands)

    def test_missing_target_or_restore_proof_stops_before_migration(self):
        for key in ("WORLDSTUDIO_EXPECTED_DATABASE_URL", "WORLDSTUDIO_EXPECTED_DATABASE_USER",
                    "WORLDSTUDIO_BACKUP_RESTORE_REFERENCE"):
            code, commands, _ = self.deploy("true", overrides={key: ""})
            self.assertNotEqual(0, code)
            self.assertNotIn("run --rm", commands)
            self.assertNotIn("up -d", commands)
