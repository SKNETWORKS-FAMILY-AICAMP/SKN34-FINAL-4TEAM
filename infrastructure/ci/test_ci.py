"""CI 선택·실행 계약의 stdlib 회귀 테스트. 서비스/DB/컨테이너를 실행하지 않는다."""
import ast
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("ci", Path(__file__).with_name("ci.py"))
ci = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ci)


class SelectionTest(unittest.TestCase):
    def test_docs_only_has_no_runtime_jobs(self):
        plan = ci.select(["README.md", "frontend/AGENTS.md", "docs/design/design.md"])
        self.assertEqual([], plan["unit"])
        self.assertEqual([], plan["integration"])
        self.assertEqual([], plan["system"])

    def test_auth_change_selects_content_and_web_consumers(self):
        plan = ci.select(["backend/core-api/src/main/kotlin/ai/storyfork/core/auth/service/SessionService.kt"])
        self.assertEqual({"web", "core"}, {row["service"] for row in plan["integration"]})
        core = next(row for row in plan["unit"] if row["service"] == "core")
        self.assertEqual("auth,content", core["scope"])
        self.assertIn("content", plan["system"])

    def test_ai_contract_selects_core_web_and_system(self):
        plan = ci.select(["backend/ai-service/app/generation/router.py"])
        self.assertEqual({"web", "core", "ai"}, {r["service"] for r in plan["unit"]})
        self.assertIn("ai", plan["system"])

    def test_core_ai_contract_selects_provider_regressions(self):
        for path in [
            'backend/core-api/src/main/kotlin/ai/storyfork/core/_common/ai_config/AiServiceClientConfig.kt',
            'backend/core-api/src/main/kotlin/ai/storyfork/core/_health_ai_service/client/AiServiceHealthClient.kt',
        ]:
            with self.subTest(path=path):
                self.assertIn({'service': 'ai', 'scope': 'all'}, ci.select([path])['integration'])

    def test_service_tests_do_not_launch_system(self):
        plan = ci.select(["backend/core-api/src/test/kotlin/ai/storyfork/core/content/ContentPostgresTest.kt"])
        self.assertEqual([{"service": "core", "scope": "content"}], plan["integration"])
        self.assertEqual([], plan["system"])

    def test_shared_unknown_and_dependency_changes_fail_safe(self):
        for path in ["backend/core-api/build.gradle", "backend/core-api/src/main/kotlin/new/Feature.kt",
                     "backend/core-api/src/main/kotlin/ai/storyfork/core/auth/config/AuthSecurityConfig.kt",
                     "backend/core-api/src/main/kotlin/ai/storyfork/core/content/config/ContentConfig.kt"]:
            with self.subTest(path=path):
                plan = ci.select([path])
                self.assertIn({"service": "core", "scope": "all"}, plan["unit"])
                self.assertTrue(plan["system"])
        for path in ["infrastructure/ci/ci.py", ".github/workflows/ci.yml", "new-runtime-config.toml"]:
            with self.subTest(path=path):
                self.assertEqual({"web", "core", "ai"}, {r["service"] for r in ci.select([path])["unit"]})

    def test_manual_and_missing_push_base_run_full_safely(self):
        self.assertEqual(3, len(ci.select([], full=True)["unit"]))
        self.assertIsNone(ci.comparison_base("workflow_dispatch", {}))
        self.assertIsNone(ci.comparison_base("push", {"before": "0" * 40}))

    def test_pr_uses_merge_base_and_push_uses_before(self):
        sha = "a" * 40
        with patch.object(ci, "git", return_value="b" * 40) as git:
            self.assertEqual("b" * 40, ci.comparison_base("pull_request", {"pull_request": {"base": {"sha": sha}}}))
            git.assert_called_with("merge-base", sha, "HEAD")
        with patch.object(ci, "git", return_value=sha):
            self.assertEqual(sha, ci.comparison_base("push", {"before": sha}))

    def test_deleted_and_renamed_paths_remain_in_selection(self):
        # --no-renames yields both deleted old and added new paths, not just the new name.
        with patch.object(ci, "git", return_value="backend/core-api/src/main/kotlin/ai/storyfork/core/auth/Old.kt\0frontend/src/New.ts\0") as git:
            paths = ci.changed_paths("a" * 40)
            self.assertIn("--no-renames", git.call_args.args)
            plan = ci.select(paths)
            self.assertIn("content", plan["system"])
            self.assertIn({"service": "web", "scope": "all"}, plan["unit"])

    def test_workflow_calls_standard_frameworks_without_a_runner_layer(self):
        workflow = (ci.ROOT / '.github/workflows/ci.yml').read_text()
        for command in ['pnpm exec vitest run src/domain src/data src/index-html.test.js',
                        'pnpm exec vitest run --exclude', './gradlew unitTest',
                        './gradlew integrationTest', "pytest -m 'not integration'",
                        'pytest -m integration', 'pytest infrastructure/system']:
            with self.subTest(command=command):
                self.assertIn(command, workflow)
        self.assertNotIn('ci.py run', workflow)
        self.assertNotIn('--passWithNoTests', workflow)
        self.assertFalse(hasattr(ci, 'command'))
        self.assertIn('CONFIGURATION_NEEDED:', workflow)

    def test_required_rejects_cancelled_and_unexpected_skips(self):
        ci.check_results({"unit": "skipped", "integration": "skipped", "system": "skipped"}, set())
        for result in ["failure", "cancelled", "skipped"]:
            with self.subTest(result=result), self.assertRaises(SystemExit):
                ci.check_results({"unit": result}, {"unit"})
        with self.assertRaises(SystemExit):
            ci.check_results({}, {"unit"})


class SystemContractTest(unittest.TestCase):
    def test_system_is_pytest_with_existing_http_client_and_ci_owned_lifecycle(self):
        source = (ci.ROOT / 'infrastructure/system/test_http.py').read_text()
        module = ast.parse(source)
        names = {node.name for node in module.body if isinstance(node, ast.FunctionDef)}
        self.assertTrue({'test_health', 'test_auth', 'test_content', 'test_ai_failure'} <= names)
        self.assertIn('import httpx2', source)
        self.assertIn('@pytest.fixture', source)
        self.assertIn('GITHUB_ACTIONS', source)
        self.assertIn('storyfork-ci-', source)
        self.assertNotIn('def main(', source)
        self.assertNotIn('class Client', source)
        self.assertFalse((ci.ROOT / 'infrastructure/ci/system_http.py').exists())
        workflow = (ci.ROOT / '.github/workflows/ci.yml').read_text()
        self.assertIn('up --build -d --wait', workflow)
        self.assertIn('curl --retry', workflow)
        self.assertIn('down --volumes --remove-orphans', workflow)

    def test_system_mutations_refresh_csrf_per_request(self):
        source = (ci.ROOT / 'infrastructure/system/test_http.py').read_text()
        mutations = 0
        for function in ast.parse(source).body:
            if not isinstance(function, ast.FunctionDef):
                continue
            for index, statement in enumerate(function.body):
                for call in ast.walk(statement):
                    if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                            and call.func.attr in {'post', 'put'} and isinstance(call.func.value, ast.Name)
                            and call.func.value.id in {'client', 'web'}):
                        with self.subTest(function=function.name, line=call.lineno):
                            self.assertGreater(index, 0)
                            self.assertEqual(f'refresh_csrf({call.func.value.id})', ast.unparse(function.body[index - 1]))
                        mutations += 1
        self.assertEqual(8, mutations)  # Anonymous missing-CSRF rejection stays intentionally unrefreshed.


class ConfigurationTest(unittest.TestCase):
    def test_core_context_http_and_db_tests_are_not_unit_tests(self):
        import fnmatch
        import re
        build = (ci.ROOT / "backend/core-api/build.gradle").read_text()
        block = build.split("def integrationTestClasses = [", 1)[1].split("]", 1)[0]
        patterns = re.findall(r"'([^']+)'", block)
        boundary = re.compile(r"SpringBootTest|WebMvcTest|ApplicationContextRunner|MockMvc|HttpClient|HttpServer|MockRestServiceServer|DriverManagerDataSource")
        for source in (ci.ROOT / "backend/core-api/src/test/kotlin").rglob("*Test.kt"):
            if boundary.search(source.read_text()):
                with self.subTest(test=source.name):
                    self.assertTrue(any(fnmatch.fnmatch("classes/" + source.stem + ".class", p) for p in patterns))
        self.assertIn("exclude integrationTestClasses", build)
        self.assertIn("include integrationTestClasses", build)

    def test_redaction_does_not_keep_tokens_or_addresses(self):
        text = ci.redact('Bearer abc.def.ghi test@example.invalid #token=opaque-token ' + 'a' * 64)
        for secret in ['abc.def.ghi', 'test@example.invalid', 'opaque-token', 'a' * 64]:
            self.assertNotIn(secret, text)

    def test_cd_publish_and_deploy_checkout_same_exact_source_sha(self):
        source = (ci.ROOT / '.github/workflows/publish-images.yml').read_text()
        for job in ['publish', 'deploy']:
            with self.subTest(job=job):
                checkout = source.split(f'\n  {job}:\n', 1)[1].split('uses: actions/checkout@', 1)[1].split('\n      - ', 1)[0]
                self.assertIn('ref: ${{ github.event.workflow_run.head_sha || github.sha }}', checkout)
                self.assertIn('persist-credentials: false', checkout)

    def test_cd_ssh_directory_uses_step_runner_temp(self):
        source = (ci.ROOT / '.github/workflows/publish-images.yml').read_text()
        deploy = source.split('\n  deploy:\n', 1)[1]
        job_env = deploy.split('\n    env:\n', 1)[1].split('\n    steps:\n', 1)[0]
        self.assertNotIn('${{ runner.', job_env)
        prepare = deploy.split('      - name: Prepare SSH\n', 1)[1].split('\n      - name:', 1)[0]
        self.assertIn('SSH_DIR="$RUNNER_TEMP/storyfork-ssh"', prepare)
        self.assertIn('printf \'SSH_DIR=%s\\n\' "$SSH_DIR" >> "$GITHUB_ENV"', prepare)

    def test_cd_is_one_trusted_publish_then_deploy_workflow(self):
        source = (ci.ROOT / '.github/workflows/publish-images.yml').read_text()
        self.assertIn('name: CD', source)
        self.assertIn('needs: publish', source)
        self.assertIn('head_repository.full_name == github.repository', source)
        self.assertIn("github.ref == 'refs/heads/develop'", source)
        self.assertIn("github.event.workflow_run.event == 'push'", source)
        self.assertIn('environment: develop-cd', source)
        self.assertIn('StrictHostKeyChecking=yes', source)
        self.assertFalse((ci.ROOT / '.github/workflows/deploy-develop.yml').exists())


if __name__ == "__main__":
    unittest.main()
