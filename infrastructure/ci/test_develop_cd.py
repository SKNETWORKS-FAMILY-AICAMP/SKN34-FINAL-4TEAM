"""배포 원격 명령을 fake Docker로 실행하는 순수 단위 회귀. DB/SSH는 사용하지 않는다."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]


class DevelopDeploymentTest(unittest.TestCase):
    def deploy(self, overrides=None):
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
                '   [[ "$3 $4 $5 $6 $7" == "$CD_WEB_IMAGE $CD_CORE_API_IMAGE $CD_CONTENT_SERVICE_IMAGE $CD_AI_SERVICE_IMAGE $CD_OPERATIONS_SERVICE_IMAGE" ]] || exit 26\n'
                '   printf "%040d\\n" 1 ;;\n'
                'esac\n', encoding="utf-8")
            docker.chmod(0o755)
            env = dict(os.environ, CD_DIRECTORY=directory.replace("\\", "/"), CD_WEB_PORT="8088", TARGET_SHA="%040d" % 1,
                GITHUB_ACTOR="test", GH_TOKEN="fake-token", COMPOSE_BASE_YAML="", COMPOSE_DEV_YAML="", COMPOSE_LOCAL_YAML="",
                TEST_COMMANDS=str(path / "commands"))
            env.update(overrides or {})
            # Git Bash translates native Windows paths before the deployment's physical-path check.
            if os.name == "nt":
                env["CD_DIRECTORY"] = "/" + env["CD_DIRECTORY"][0].lower() + env["CD_DIRECTORY"][2:]
            result = subprocess.run([bash, "-se"], input='export PATH="$TEST_BIN:$PATH"\n' + script,
                env=dict(env, TEST_BIN=env["CD_DIRECTORY"]), capture_output=True, text=True)
            commands = (path / "commands").read_text() if (path / "commands").exists() else ""
            return result.returncode, commands, result.stderr

    def test_old_writer_and_public_ingress_stop_before_the_full_stack_starts(self):
        code, commands, error = self.deploy()
        self.assertEqual(0, code, error)
        self.assertLess(commands.index("stop web core-api content-service"), commands.index("postgres mailpit"))
        self.assertLess(commands.index("postgres mailpit"), commands.index("up -d --no-build --pull never --wait --wait-timeout 180\n"))
        self.assertNotIn("run --rm", commands)

    def test_superseded_images_are_pruned_only_after_the_new_stack_is_healthy(self):
        code, commands, error = self.deploy()
        self.assertEqual(0, code, error)
        self.assertLess(commands.index("up -d --no-build --pull never --wait --wait-timeout 180\n"),
            commands.index("image prune --force\n"))

    def test_failed_revision_check_keeps_previous_images(self):
        _, commands, _ = self.deploy(overrides={"TARGET_SHA": "%040d" % 2})
        self.assertNotIn("image prune", commands)

    def test_inherited_profile_cannot_change_the_deployed_stack(self):
        code, commands, error = self.deploy(overrides={"COMPOSE_PROFILES": "anything"})
        self.assertEqual(0, code, error)
        self.assertIn("up -d --no-build --pull never --wait --wait-timeout 180\n", commands)
        self.assertNotIn("run --rm", commands)

    def test_image_revision_other_than_run_target_stops_before_ingress(self):
        code, commands, _ = self.deploy(overrides={"TARGET_SHA": "%040d" % 2})
        self.assertNotEqual(0, code)
        self.assertNotIn("stop web core-api content-service", commands)

    def test_publish_requires_target_to_be_current_develop_head(self):
        workflow = (ROOT / ".github/workflows/publish-images.yml").read_text(encoding="utf-8")
        publish = workflow.split("  publish:", 1)[1].split("\n  deploy:", 1)[0]
        check = publish.index('gh api "repos/$GITHUB_REPOSITORY/commits/develop" --jq .sha')
        self.assertIn('[[ "$head" == "$TARGET_SHA" ]]', publish)
        self.assertLess(check, publish.index("docker build"))
