"""배포 원격 명령과 publish 이미지 단계를 fake Docker로 실행하는 순수 단위 회귀. DB/SSH/레지스트리는 사용하지 않는다."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]
APP = "ghcr.io/sknetworks-family-aicamp/storyfork-"
SERVICES = ("web", "core-api", "content-service", "ai-service", "operations-service")
TREES = {service: "%040d" % number for number, service in enumerate(SERVICES, 1)}  # 이번 run의 서비스별 빌드 tree(publish가 계산)
STALE = "%040d" % 99  # 다른 커밋에서 빌드한 이미지의 tree
PULL = "pull " + APP  # fake Docker가 기록한 첫 앱 이미지 pull 줄의 시작(앞뒤로 나눠 보는 기준)
FULL_UP = "up -d --no-build --pull missing --wait --wait-timeout 600\n"


class DevelopDeploymentTest(unittest.TestCase):
    def deploy(self, overrides=None, server=None, registry=None):
        """server: 서버 앱 이미지의 build-tree 라벨(빠진 서비스는 이미지 없음, 기본은 ai-service만 옛 이미지).
        registry: docker pull이 서버 이미지에 놓는 라벨(기본은 이번 run의 tree)."""
        bash = shutil.which("bash")
        if os.name == "nt":
            bash = "C:/Program Files/Git/bin/bash.exe"
        workflow = (ROOT / ".github/workflows/publish-images.yml").read_text(encoding="utf-8")
        script = textwrap.dedent(workflow.split("cat <<'REMOTE'", 1)[1].split("\n          REMOTE", 1)[0])
        with tempfile.TemporaryDirectory(dir=ROOT if os.name == "nt" else None) as directory:
            path = Path(directory).resolve()
            directory = str(path)
            (path / ".env").touch()
            for name, labels in (("server", {**TREES, "ai-service": STALE} if server is None else server),
                                 ("registry", TREES if registry is None else registry)):
                (path / name).mkdir()
                for service, tree in labels.items():
                    (path / name / service).write_text(tree)
            docker = path / "docker"
            docker.write_text('#!/bin/bash\n'
                '[[ -z "${COMPOSE_PROFILES:-}" ]] || exit 24\n'
                'echo "$*" >> "$TEST_COMMANDS"\n'
                'case "$*" in\n'
                ' "image inspect"*)\n'
                '   [[ "${CD_LOCAL_COMPOSE_FILE:-}" == "$DOCKER_CONFIG/docker-compose.local.yaml" && -f "${CD_LOCAL_COMPOSE_FILE:-}" ]] || exit 25\n'
                '   [[ "${CD_LANGFUSE_COMPOSE_FILE:-}" == "$DOCKER_CONFIG/docker-compose.langfuse.yaml" && -f "${CD_LANGFUSE_COMPOSE_FILE:-}" ]] || exit 27\n'
                # 서버 이미지의 build-tree 라벨을 돌려준다(서버에 없는 이미지는 inspect가 실패한다).
                '   name=${5##*storyfork-}; cat "$TEST_SERVER/${name%%:*}" ;;\n'
                # pull은 서버 이미지를 레지스트리의 이미지로 바꾼다.
                ' "pull "*) name=${2##*storyfork-}; cp "$TEST_REGISTRY/${name%%:*}" "$TEST_SERVER/${name%%:*}" ;;\n'
                # 실제 compose exec는 stdin을 컨테이너로 넘겨 끝까지 읽는다(스크립트가 stdin으로 읽히면 남은 줄을 먹는다).
                ' *" exec "*) cat >/dev/null ;;\n'
                'esac\n', encoding="utf-8")
            docker.chmod(0o755)
            env = dict(os.environ, CD_DIRECTORY=directory.replace("\\", "/"), CD_WEB_PORT="8088",
                CD_TREES=" ".join(f"{service}={tree}" for service, tree in TREES.items()),
                GITHUB_ACTOR="test", GH_TOKEN="fake-token", COMPOSE_BASE_YAML="", COMPOSE_DEV_YAML="", COMPOSE_LOCAL_YAML="", COMPOSE_LANGFUSE_YAML="",
                TEST_COMMANDS=str(path / "commands"), TEST_SERVER=str(path / "server"), TEST_REGISTRY=str(path / "registry"))
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
        # 전체 스택 대기는 첫 배포에서 Langfuse 저장소·Elasticsearch·앱이 함께 처음 뜨는 시간을 담아 600초다(postgres·mailpit만 먼저 올릴 때는 180초).
        self.assertLess(commands.index("postgres mailpit"), commands.index(FULL_UP))
        self.assertNotIn("run --rm", commands)

    def test_superseded_images_are_pruned_only_after_the_new_stack_is_healthy(self):
        code, commands, error = self.deploy()
        self.assertEqual(0, code, error)
        # pull이 옛 :develop 이미지를 dangling으로 만든 뒤의 정리만 본다(pull 앞의 공간 확보는 아래 별도 시험).
        after_pull = commands.split(PULL, 1)[1]
        self.assertLess(after_pull.index(FULL_UP), after_pull.index("image prune --force\n"))

    def test_disk_is_freed_before_pull_by_pruning_only_dangling_images_and_build_cache(self):
        code, commands, error = self.deploy()
        self.assertEqual(0, code, error)
        # 디스크가 찬 서버는 pull 중 no space left on device로 실패하므로(#770) 받기 전에 먼저 비운다.
        before_pull = commands.split(PULL, 1)[0]
        self.assertIn("image prune --force\n", before_pull)
        self.assertIn("builder prune --force\n", before_pull)
        # 정리 명령은 이 둘뿐이다: 공유 DB 볼륨·태그 있는 이미지를 지우는 -a·--all·--volumes·volume prune 등은 없다.
        self.assertEqual({"image prune --force", "builder prune --force"},
            {line for line in commands.splitlines() if "prune" in line})
        self.assertNotIn("--volumes", commands)

    def test_only_app_images_that_differ_from_this_runs_trees_are_pulled(self):
        # web·core-api·content-service는 서버에 이미 같은 tree가 있고, ai-service는 옛 tree, operations-service는 서버에 없다.
        server = {**{service: TREES[service] for service in ("web", "core-api", "content-service")}, "ai-service": STALE}
        code, commands, error = self.deploy(server=server)
        self.assertEqual(0, code, error)
        pulls = [line for line in commands.splitlines() if line.startswith("pull ")]
        self.assertCountEqual([f"pull {APP}ai-service:develop", f"pull {APP}operations-service:develop"], pulls)

    def test_compose_pull_is_gone_and_up_only_pulls_images_the_server_lacks(self):
        code, commands, error = self.deploy()
        self.assertEqual(0, code, error)
        self.assertNotIn("--env-file .env pull", commands)  # 모든 이미지를 받는 compose pull은 없다
        self.assertIn("up -d --no-build --pull missing --wait --wait-timeout 180 postgres mailpit\n", commands)

    def test_inherited_profile_cannot_change_the_deployed_stack(self):
        code, commands, error = self.deploy(overrides={"COMPOSE_PROFILES": "anything"})
        self.assertEqual(0, code, error)
        self.assertIn(FULL_UP, commands)
        self.assertNotIn("run --rm", commands)

    def test_app_image_without_this_runs_tree_stops_before_ingress_and_keeps_previous_images(self):
        # 레지스트리의 develop이 이 run의 tree가 아니면(더 새 커밋 등) 받은 뒤에도 앱을 멈추거나 정리하지 않고 중단한다. 다섯 이미지 모두 검사 대상이다.
        for service in SERVICES:
            with self.subTest(service=service):
                code, commands, _ = self.deploy(server={name: STALE for name in SERVICES}, registry={**TREES, service: STALE})
                self.assertNotEqual(0, code)
                self.assertNotIn("stop web core-api content-service", commands)
                self.assertNotIn("prune", commands.split(PULL, 1)[1])

    def test_missing_or_malformed_service_trees_stop_before_ingress(self):
        # 배선이 끊겨 CD_TREES가 비거나 tree가 비면, 검사할 이미지가 없거나 라벨 없는 옛 이미지('')와 같아져 통과하는 일이 없어야 한다.
        legacy = {service: "" for service in SERVICES}
        for trees in ("", "web=" + TREES["web"], " ".join(f"{service}=" for service in SERVICES)):
            with self.subTest(trees=trees):
                code, commands, _ = self.deploy(overrides={"CD_TREES": trees}, server=legacy)
                self.assertNotEqual(0, code)
                self.assertNotIn("stop web core-api content-service", commands)

    def test_embedding_model_is_smoke_tested_in_the_new_stack_before_prune(self):
        code, commands, error = self.deploy()
        self.assertEqual(0, code, error)
        after_pull = commands.split(PULL, 1)[1]
        smoke = after_pull.index("exec -T ai-service python -c")
        self.assertLess(after_pull.index(FULL_UP), smoke)
        self.assertLess(smoke, after_pull.index("image prune --force\n"))

    def test_exec_that_reads_stdin_does_not_swallow_the_final_prune(self):
        # 스크립트는 ssh의 `bash -se` stdin으로 읽히므로, stdin을 읽는 exec(위 fake docker)가 남은 줄을 먹으면 마지막 prune이 조용히 건너뛰어진다(#770).
        code, commands, error = self.deploy()
        self.assertEqual(0, code, error)
        self.assertIn("image prune --force\n", commands.split("exec -T ai-service", 1)[1])

    def test_develop_stack_runs_official_elasticsearch_for_content_on_a_kept_volume(self):
        dev = (ROOT / "infrastructure/docker-compose.dev.yaml").read_text(encoding="utf-8")
        service = dev.split("\n  elasticsearch:\n", 1)[1].split("\n\n", 1)[0]
        self.assertIn("image: docker.elastic.co/elasticsearch/elasticsearch:9.5.6", service)
        self.assertIn("manuscript-index:/usr/share/elasticsearch/data", service)
        self.assertNotIn("ports:", service)
        self.assertIn("\n  manuscript-index:\n    labels: *cd-labels", dev)
        content = dev.split("\n  content-service:\n", 1)[1].split("\n\n", 1)[0]
        self.assertIn("elasticsearch:\n        condition: service_healthy", content)
        self.assertNotIn("MANUSCRIPT_INDEX_ENABLED", dev)  # 원고 색인은 끄는 플래그 없이 항상 켠다(2026-11-22).
        self.assertIn("MANUSCRIPT_INDEX_URL: http://elasticsearch:9200", content)

    def test_langfuse_compose_is_staged_like_the_other_files_for_the_dev_include(self):
        # dev가 include하는 Langfuse 정의도 SSH stdin으로 보내 임시 위치에 두고, 절대 경로를 CD_LANGFUSE_COMPOSE_FILE로 준다
        # (받는 쪽은 위 fake docker의 image inspect 검사가 확인한다).
        workflow = (ROOT / ".github/workflows/publish-images.yml").read_text(encoding="utf-8")
        self.assertIn('COMPOSE_LANGFUSE_YAML "$(< infrastructure/docker-compose.langfuse.yaml)"', workflow)

    def test_publish_requires_target_to_be_current_develop_head(self):
        workflow = (ROOT / ".github/workflows/publish-images.yml").read_text(encoding="utf-8")
        publish = workflow.split("  publish:", 1)[1].split("\n  deploy:", 1)[0]
        check = publish.index('gh api "repos/$GITHUB_REPOSITORY/commits/develop" --jq .sha')
        self.assertIn('[[ "$head" == "$TARGET_SHA" ]]', publish)
        self.assertLess(check, publish.index("docker build"))

    def test_publish_builds_only_services_whose_build_context_tree_is_not_published(self):
        # publish의 이미지 단계를 실제 git tree와 fake Docker로 실행한다. 앞의 세 서비스는 tree 태그가 레지스트리에 이미 있다.
        workflow = (ROOT / ".github/workflows/publish-images.yml").read_text(encoding="utf-8")
        script = textwrap.dedent(workflow.split("        id: images\n        run: |\n", 1)[1].split("\n\n  deploy:", 1)[0])
        contexts = ["frontend" if service == "web" else "backend/" + service for service in SERVICES]
        sha, *tree_list = subprocess.run(["git", "rev-parse", "HEAD", *["HEAD:" + context for context in contexts]],
            cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
        trees = dict(zip(SERVICES, tree_list))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "published").write_text("".join(f"{APP}{service}:tree-{trees[service]}\n" for service in ("core-api", "content-service", "operations-service")))
            docker = path / "docker"
            docker.write_text('#!/bin/bash\n'
                'echo "$*" >> "$TEST_COMMANDS"\n'
                '[[ "$1" != login ]] || cat >/dev/null\n'
                # MinIO는 이미 게시돼 있고, 앱 이미지는 published에 적힌 tree 태그만 레지스트리에 있다.
                '[[ "$1 $2" != "manifest inspect" ]] || [[ "$3" == *storyfork-minio:* ]] || grep -qxF "$3" "$TEST_PUBLISHED"\n', encoding="utf-8")
            docker.chmod(0o755)
            env = dict(os.environ, TARGET_SHA=sha, GH_TOKEN="fake-token", GITHUB_ACTOR="test", GITHUB_SERVER_URL="https://github.com", GITHUB_REPOSITORY="owner/repo",
                GITHUB_OUTPUT=str(path / "output"), TEST_COMMANDS=str(path / "commands"), TEST_PUBLISHED=str(path / "published"), TEST_BIN=str(path))
            result = subprocess.run([shutil.which("bash"), "-se"], input='export PATH="$TEST_BIN:$PATH"\n' + script, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(0, result.returncode, result.stderr)
            commands = (path / "commands").read_text().splitlines()
            output = (path / "output").read_text()
        built = {line.split()[-1]: line for line in commands if line.startswith("buildx build ")}
        self.assertEqual({"frontend", "backend/ai-service"}, set(built))
        for service, context in (("web", "frontend"), ("ai-service", "backend/ai-service")):
            for expected in (f"--label io.storyfork.build-tree={trees[service]}", f"--label org.opencontainers.image.revision={sha}",
                             f"--tag {APP}{service}:tree-{trees[service]}", f"--tag {APP}{service}:sha-{sha}",
                             # CI system job(compose.test.yaml)이 쓰는 같은 scope의 레이어 캐시를 읽고, 이어지는 docker push를 위해 이미지를 데몬에 올린다.
                             f"--cache-from type=gha,scope={service}", "--load"):
                self.assertIn(expected, built[context])
        pushes = [line for line in commands if line.startswith("push ")]
        self.assertCountEqual([f"push {APP}{service}:{tag}" for service in ("web", "ai-service") for tag in (f"tree-{trees[service]}", f"sha-{sha}")], pushes)
        # develop은 모든 tree 이미지를 게시한 뒤에만, 새로 빌드하지 않은 서비스까지 각자의 tree 이미지로 맞춘다
        # (이미 게시된 tree로 되돌린 커밋이면 develop이 다른 tree를 가리키고 있다).
        aliases = [line for line in commands if line.startswith("buildx imagetools create")]
        self.assertCountEqual([f"buildx imagetools create --tag {APP}{service}:develop {APP}{service}:tree-{trees[service]}" for service in SERVICES], aliases)
        self.assertLess(max(commands.index(line) for line in pushes), min(commands.index(line) for line in aliases))
        self.assertEqual(trees, dict(pair.split("=") for pair in output.split("trees=", 1)[1].split()))
