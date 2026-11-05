"""CI 선택·실행 계약의 stdlib 회귀 테스트. 서비스/DB/컨테이너를 실행하지 않는다."""
import ast
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
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
        self.assertEqual({"web", "core", "content"}, {row["service"] for row in plan["integration"]})
        core = next(row for row in plan["unit"] if row["service"] == "core")
        self.assertEqual("all", core["scope"])  # 첨부 HTTP·설정 테스트도 Auth를 소비한다.
        self.assertIn("content", plan["system"])

    def test_content_change_includes_attachment_consumers(self):
        plan = ci.select(["backend/core-api/src/main/kotlin/ai/storyfork/core/content/service/ContentService.kt"])
        self.assertIn({"service": "core", "scope": "all"}, plan["integration"])
        self.assertEqual({"web", "core", "ai", "content"}, {row["service"] for row in plan["unit"]})
        self.assertIn("content", plan["system"])

    def test_attachment_runtime_and_migration_paths_conservatively_select_all(self):
        # 새 패키지는 미등록 기능의 보수적 전체 선택을 유지하고, 삭제된 이전 경로도 포함한다.
        for path in [
            "backend/core-api/src/main/kotlin/ai/storyfork/core/attachment/service/AttachmentService.kt",
            "backend/core-api/src/main/kotlin/ai/storyfork/core/attachment/AttachmentConfig.kt",
            "backend/core-api/src/main/kotlin/ai/storyfork/core/attachment/AttachmentProperties.kt",
            "backend/core-api/src/main/kotlin/ai/storyfork/core/attachment/repository/ContentImageRepository.kt",
            "backend/core-api/src/main/kotlin/ai/storyfork/core/settingattachment/service/SettingAttachmentService.kt",
            "backend/core-api/src/main/kotlin/ai/storyfork/core/settingattachment/SettingAttachmentConfig.kt",
            "backend/core-api/src/main/kotlin/ai/storyfork/core/contentimage/service/ContentImageService.kt",
            "backend/core-api/src/main/resources/db/migration/settingattachment/V1__setting_attachment.sql",
            "backend/core-api/src/main/resources/db/migration/contentimage/V1__content_image.sql",
        ]:
            with self.subTest(path=path):
                plan = ci.select([path])
                self.assertIn({"service": "core", "scope": "all"}, plan["integration"])
                self.assertEqual({"web", "core", "ai", "content"}, {row["service"] for row in plan["unit"]})
                self.assertEqual(ci.SCENARIOS, plan["system"])

    def test_attachment_test_change_selects_core_without_system(self):
        # 이동된 테스트와 삭제된 이전 테스트 경로 모두 Core 전체, 시스템 미선택이다.
        for path in [
            "backend/core-api/src/test/kotlin/ai/storyfork/core/attachment/AttachmentServiceTest.kt",
            "backend/core-api/src/test/kotlin/ai/storyfork/core/attachment/AttachmentConfigTest.kt",
            "backend/core-api/src/test/kotlin/ai/storyfork/core/attachment/SettingAttachmentHttpTest.kt",
            "backend/core-api/src/test/kotlin/ai/storyfork/core/settingattachment/SettingAttachmentHttpTest.kt",
        ]:
            with self.subTest(path=path):
                plan = ci.select([path])
                self.assertEqual([{"service": "core", "scope": "all"}, {"service": "content", "scope": "all"}], plan["unit"])
                self.assertEqual(plan["unit"], plan["integration"])
                self.assertEqual([], plan["system"])

    def test_independent_spring_skeletons_select_only_their_unit_tests(self):
        for service in ("operations",):
            for suffix in ("build.gradle", "src/main/resources/application.properties",
                           f"src/main/kotlin/ai/storyfork/{service}/Application.kt",
                           f"src/test/kotlin/ai/storyfork/{service}/ApplicationPropertiesTest.kt",
                           "gradlew", "gradle/wrapper/gradle-wrapper.jar"):
                with self.subTest(service=service, path=suffix):
                    plan = ci.select([f"backend/{service}-service/{suffix}"])
                    self.assertEqual([{"service": service, "scope": "all"}], plan["unit"])
                    self.assertEqual([], plan["integration"])
                    self.assertEqual([], plan["system"])
                    self.assertFalse(plan["infra"])

    def test_skeleton_ci_runs_scoped_junit_without_empty_integration_rows(self):
        workflow = (ci.ROOT / ".github/workflows/ci.yml").read_text()
        unit = workflow.split("\n  unit:\n", 1)[1].split("\n  integration:\n", 1)[0]
        self.assertIn("matrix.service == 'core' || matrix.service == 'content' || matrix.service == 'operations'", unit)
        self.assertIn("working-directory: backend/${{ matrix.service }}-service", unit)
        self.assertIn('test --tests "ai.storyfork.${SERVICE}.*" --no-daemon', unit)
        self.assertEqual({"web", "core", "ai", "content", "operations"},
                         {row["service"] for row in ci.select([], full=True)["unit"]})
        self.assertEqual({"web", "core", "ai", "content"},
                         {row["service"] for row in ci.select([], full=True)["integration"]})

    def test_content_runtime_selects_its_integration_and_current_consumers(self):
        plan = ci.select(["backend/content-service/src/main/kotlin/ai/storyfork/content/work/service/WorkService.kt"])
        self.assertEqual({"web", "core", "ai", "content"}, {r["service"] for r in plan["integration"]})
        self.assertIn("content", plan["system"])
        self.assertNotIn("operations", {r["service"] for r in plan["unit"]})

    def test_content_test_only_does_not_launch_system_or_other_services(self):
        plan = ci.select(["backend/content-service/src/test/kotlin/ai/storyfork/content/world/WorldServiceTest.kt"])
        self.assertEqual([{"service": "content", "scope": "all"}], plan["unit"])
        self.assertEqual(plan["unit"], plan["integration"])
        self.assertEqual([], plan["system"])

    def test_ai_contract_selects_core_web_and_system(self):
        plan = ci.select(["backend/ai-service/app/generation/router.py"])
        self.assertEqual({"web", "core", "ai", "content"}, {r["service"] for r in plan["unit"]})
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
        self.assertEqual([{"service": "core", "scope": "all"}, {"service": "content", "scope": "all"}], plan["integration"])
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
                self.assertEqual({"web", "core", "ai", "content", "operations"},
                                 {r["service"] for r in ci.select([path])["unit"]})

    def test_manual_and_missing_push_base_run_full_safely(self):
        self.assertEqual(5, len(ci.select([], full=True)["unit"]))
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
        configuration = workflow.split('\n  configuration:\n', 1)[1].split('\n  unit:\n', 1)[0]
        self.assertIn('python3 -I -m unittest discover -s infrastructure/tests -p test_attachment_environment.py -v', configuration)

    def test_unit_and_integration_run_in_parallel_before_system(self):
        workflow = (ci.ROOT / '.github/workflows/ci.yml').read_text()
        unit = workflow.split('\n  unit:\n', 1)[1].split('\n  integration:\n', 1)[0]
        integration = workflow.split('\n  integration:\n', 1)[1].split('\n  system:\n', 1)[0]
        for job, needed in [(unit, 'unit'), (integration, 'integration')]:
            with self.subTest(tier=needed):
                self.assertIn('\n    needs: changes\n', job)
                self.assertIn(f"if: ${{{{ needs.changes.outputs.{needed}_needed == 'true' }}}}", job)
                self.assertIn('fail-fast: false', job)
        system = workflow.split('\n  system:\n', 1)[1].split('\n  required:\n', 1)[0]
        self.assertIn('needs: [changes, unit, integration, configuration]', system)
        for prerequisite in ['changes', 'unit', 'integration']:
            self.assertIn(f"needs.{prerequisite}.result == 'success'", system)
        required = workflow.split('\n  required:\n', 1)[1]
        self.assertIn('if: ${{ always() }}', required)
        self.assertIn('needs: [changes, configuration, unit, integration, system]', required)
        self.assertIn('pnpm exec vitest run src/domain src/data src/index-html.test.js', unit)
        self.assertIn("--exclude 'src/domain/**' --exclude 'src/data/**' --exclude src/index-html.test.js", integration)

    def test_required_rejects_cancelled_and_unexpected_skips(self):
        ci.check_results({"unit": "skipped", "integration": "skipped", "system": "skipped"}, set())
        for job in ["changes", "configuration", "unit", "integration", "system"]:
            ci.check_results({job: "success"}, {job})
            for result in ["failure", "cancelled", "skipped", "unknown"]:
                with self.subTest(job=job, result=result), self.assertRaises(SystemExit):
                    ci.check_results({job: result}, {job})
            with self.subTest(job=job), self.assertRaises(SystemExit):
                ci.check_results({}, {job})


class PlanGitTest(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='ci-plan-')
        self.addCleanup(scratch.cleanup)
        self.repo = Path(scratch.name)
        self.git('init', '-q')

    def git(self, *args):
        return subprocess.check_output([
            'git', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=CI Test',
            '-c', 'user.email=ci@example.invalid', *args,
        ], cwd=self.repo, text=True).strip()

    def commit(self, name, text):
        (self.repo / name).write_text(text)
        self.git('add', name)
        self.git('commit', '-qm', 'test fixture')
        return self.git('rev-parse', 'HEAD')

    def plan(self, event, payload):
        event_path = self.repo / 'event.json'
        event_path.write_text(json.dumps(payload))
        return subprocess.run([
            sys.executable, '-I', '-c',
            'import runpy, sys; from pathlib import Path; '
            'ns = runpy.run_path(sys.argv[1]); main = ns["main"]; '
            'main.__globals__["ROOT"] = Path(sys.argv[2]); '
            'sys.argv = [sys.argv[1], "plan"]; main()',
            str(Path(ci.__file__).resolve()), str(self.repo),
        ], text=True, capture_output=True, env={**os.environ,
            'GITHUB_EVENT_NAME': event, 'GITHUB_EVENT_PATH': str(event_path),
            'GITHUB_OUTPUT': str(self.repo / 'output'),
        })

    def test_known_baseline_reports_whitespace_location_and_fails(self):
        base = self.commit('clean.txt', 'clean\n')
        self.commit('bad.txt', 'bad \n')
        result = self.plan('push', {'before': base})
        self.assertNotEqual(0, result.returncode)
        self.assertIn('bad.txt:1: trailing whitespace.', result.stdout)

    def test_missing_baseline_checks_parent_but_selects_all_tests(self):
        self.commit('legacy.txt', 'legacy \n')
        self.commit('clean.txt', 'clean\n')
        for event, payload in [
            ('workflow_dispatch', {}), ('push', {'before': '0' * 40}),
            ('push', {'before': 'a' * 40}),
            ('pull_request', {'pull_request': {'base': {'sha': 'a' * 40}}}),
        ]:
            with self.subTest(event=event, payload=payload):
                result = self.plan(event, payload)
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                plan = json.loads(result.stdout)
                self.assertIsNone(plan['base'])
                self.assertEqual(set(ci.SERVICES), {row['service'] for row in plan['unit']})
                self.assertEqual({'web', 'core', 'ai', 'content'}, {row['service'] for row in plan['integration']})
                self.assertEqual(ci.SCENARIOS, plan['system'])
                self.assertTrue(plan['infra'])
        self.commit('new.txt', 'new \n')
        result = self.plan('workflow_dispatch', {})
        self.assertNotEqual(0, result.returncode)
        self.assertIn('new.txt:1: trailing whitespace.', result.stdout)
        self.assertNotIn('legacy.txt:1: trailing whitespace.', result.stdout)

    def test_initial_commit_checks_against_empty_tree(self):
        self.commit('initial.txt', 'initial \n')
        result = self.plan('push', {'before': '0' * 40})
        self.assertNotEqual(0, result.returncode)
        self.assertIn('initial.txt:1: trailing whitespace.', result.stdout)


class ComposeSplitTest(unittest.TestCase):
    def test_root_compose_includes_isolated_local_source_build(self):
        root = ci.ROOT / 'compose.yaml'
        self.assertTrue(root.is_file(), 'Bare docker compose needs a root compose.yaml')
        source = root.read_text()
        self.assertIn('name: storyfork-local', source)
        self.assertIn('include:', source)
        for name in ('docker-compose.yaml', 'docker-compose.local.yaml'):
            self.assertIn('./infrastructure/' + name, source)
        local = (ci.ROOT / 'infrastructure/docker-compose.local.yaml').read_text()
        self.assertIn('name: storyfork-local', local)
        self.assertNotIn('name: storyfork-dev\n', local)
        self.assertNotIn('external:', local)
        self.assertNotIn('env_file:', source + local)
        for context in ('../frontend', '../backend/core-api', '../backend/content-service', '../backend/ai-service'):
            self.assertIn('context: ' + context, local)
            self.assertTrue((ci.ROOT / 'infrastructure' / context / 'Dockerfile').is_file())
        for port in ('${DEV_WEB_PORT:-5173}:80', '${CORE_API_PORT:-8080}:8080',
                     '${CONTENT_SERVICE_PORT:-8081}:8081', '${CORE_DATABASE_PORT:-5432}:5432',
                     '${CORE_MAILPIT_SMTP_PORT:-1025}:1025', '${CORE_MAILPIT_WEB_PORT:-8025}:8025'):
            self.assertIn('127.0.0.1:' + port, local)
        self.assertIn('core-postgres:/var/lib/postgresql/data', local)
        self.assertIn('CORE_SMTP_HOST: mailpit', local)
        self.assertIn('AUTH_COOKIE_SECURE: ${AUTH_COOKIE_SECURE:-false}', local)

    def test_production_uses_main_images_and_explicit_external_settings(self):
        source = (ci.ROOT / 'infrastructure/docker-compose.prod.yaml').read_text()
        self.assertIn('name: storyfork-production', source)
        for service in ('web', 'core-api', 'content-service', 'ai-service'):
            self.assertIn(f'image: ghcr.io/sknetworks-family-aicamp/storyfork-{service}:main', source)
        for forbidden in ('build:', 'volumes:', '  postgres:', '  mailpit:', 'env_file:', ':develop',
                          '${CORE_DATABASE_', '${AUTH_JWT_SECRET', '${OPENAI_API_KEY', '${INTERNAL_TOKEN'):
            self.assertNotIn(forbidden, source)
        for variable in ('PROD_DATABASE_URL', 'PROD_DATABASE_USER', 'PROD_DATABASE_PASSWORD',
                         'PROD_SMTP_HOST', 'PROD_SMTP_PORT', 'PROD_PUBLIC_ORIGIN', 'PROD_MAIL_FROM',
                         'PROD_AUTH_JWT_SECRET', 'PROD_CONTENT_CORE_AUTH_TOKEN', 'PROD_INTERNAL_TOKEN', 'PROD_WEB_PORT'):
            self.assertIn('${' + variable + ':?', source)
        self.assertIn('AUTH_COOKIE_SECURE: "true"', source)
        self.assertIn('CONTENT_ENABLED: ${PROD_CONTENT_ENABLED:-false}', source)
        self.assertIn('OPENAI_API_KEY: ${PROD_OPENAI_API_KEY:-}', source)
        self.assertIn('127.0.0.1:${PROD_WEB_PORT:?', source)
        # Base interpolation must not demand local secrets before prod overrides can apply.
        base = (ci.ROOT / 'infrastructure/docker-compose.yaml').read_text()
        self.assertNotIn(':?', base)
        dev = (ci.ROOT / 'infrastructure/docker-compose.dev.yaml').read_text()
        for service in ('web', 'core-api', 'content-service', 'ai-service'):
            self.assertIn(f'image: ghcr.io/sknetworks-family-aicamp/storyfork-{service}:develop', dev)
        for variable in ('CORE_DATABASE_USER', 'CORE_DATABASE_PASSWORD', 'AUTH_JWT_SECRET'):
            self.assertIn('${' + variable + ':?', dev)
        self.assertNotIn('build:', dev)
        self.assertIn('  postgres:', dev)
        self.assertIn('  mailpit:', dev)
        self.assertEqual(2, dev.count('file: ${CD_LOCAL_COMPOSE_FILE:-docker-compose.local.yaml}'))
        self.assertEqual(2, dev.count('ports: !reset []'))
        self.assertIn('CORE_DATABASE_URL: jdbc:postgresql://postgres:5432/storyfork', dev)
        self.assertIn('CORE_SMTP_HOST: mailpit', dev)
        self.assertIn('CONTENT_DATABASE_URL: jdbc:postgresql://postgres:5432/storyfork', dev)
        self.assertNotIn('${CORE_DATABASE_URL', dev)
        self.assertIn('  core-postgres:', dev)
        self.assertNotIn('external:', dev)
        workflow = (ci.ROOT / '.github/workflows/publish-images.yml').read_text()
        self.assertIn('COMPOSE_LOCAL_YAML', workflow)
        self.assertIn('docker image inspect "$CD_WEB_IMAGE" "$CD_CORE_API_IMAGE" "$CD_CONTENT_SERVICE_IMAGE" "$CD_AI_SERVICE_IMAGE"', workflow)
        self.assertIn("vars.DEVELOP_INTERNAL_DB_APPROVED == 'true'", workflow)

    def test_ci_and_attachment_callers_keep_source_builds(self):
        workflow = (ci.ROOT / '.github/workflows/ci.yml').read_text()
        self.assertIn('for mode in local prod dev; do', workflow)
        self.assertIn('docker compose --env-file .env.example config --quiet', workflow)
        files = 'infrastructure/docker-compose.yaml:infrastructure/docker-compose.local.yaml:infrastructure/ci/compose.test.yaml'
        self.assertIn('COMPOSE_FILE: ' + files, workflow)
        self.assertIn('-f infrastructure/docker-compose.local.yaml -f infrastructure/ci/compose.test.yaml', workflow)
        self.assertNotIn('docker-compose.prod.yaml', workflow)
        attachment = (ci.ROOT / 'infrastructure/tests/test_attachment_environment.py').read_text()
        self.assertIn('infrastructure/docker-compose.local.yaml', attachment)
        self.assertNotIn('infrastructure/docker-compose.prod.yaml', attachment)
        self.assertIn('docker-compose.local.yaml', (ci.ROOT / 'infrastructure/compose.attachments.yaml').read_text())
        overlay = (ci.ROOT / 'infrastructure/ci/compose.test.yaml').read_text()
        for service in ('postgres', 'core-api', 'content-service'):
            block = re.split(r'\n  [a-z][\w-]*:\n', overlay.split('  ' + service + ':\n', 1)[1], maxsplit=1)[0]
            self.assertIn('ports: !reset []', block)

    def test_example_does_not_activate_deployment_or_supply_signing_keys(self):
        source = (ci.ROOT / '.env.example').read_text()
        active = dict(line.split('=', 1) for line in source.splitlines() if line and not line.startswith('#'))
        self.assertFalse(any(key.startswith(('PROD_', 'CD_')) for key in active))
        for key in ('AUTH_JWT_SECRET', 'CORE_DATABASE_USER', 'CORE_DATABASE_PASSWORD', 'CONTENT_CORE_AUTH_TOKEN', 'INTERNAL_TOKEN'):
            self.assertEqual('', active[key])
        self.assertEqual('false', active['AUTH_COOKIE_SECURE'])
        self.assertEqual('5173', active['DEV_WEB_PORT'])
        self.assertIn('# PROD_DATABASE_URL=', source)
        self.assertIn('# PROD_AUTH_JWT_SECRET=', source)
        self.assertIn('# CD_DIRECTORY=', source)


class SystemContractTest(unittest.TestCase):
    def test_compose_rejects_any_non_source_build_file_selection(self):
        from unittest.mock import Mock

        module = ast.parse((ci.ROOT / 'infrastructure/system/test_http.py').read_text())
        function = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == 'compose')
        files = 'infrastructure/docker-compose.yaml:infrastructure/docker-compose.local.yaml:infrastructure/ci/compose.test.yaml'
        namespace = {'os': os, 're': re, 'subprocess': Mock()}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<compose-contract>', 'exec'), namespace)
        for selection in (files, files.replace('.local.yaml', '.prod.yaml'), ''):
            with self.subTest(selection=selection), patch.dict(os.environ, {
                'GITHUB_ACTIONS': 'true', 'COMPOSE_PROJECT_NAME': 'storyfork-ci-1-1', 'COMPOSE_FILE': selection,
            }, clear=True):
                if selection == files:
                    namespace['compose']('version', '--short')
                    namespace['subprocess'].check_output.assert_called_once_with(
                        ['docker', 'compose', '--env-file', '.env.example', 'version', '--short'], text=True)
                    namespace['subprocess'].reset_mock()
                else:
                    with self.assertRaises(AssertionError):
                        namespace['compose']('version', '--short')
                    namespace['subprocess'].check_output.assert_not_called()

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

    def test_core_auth_timeout_fault_preserves_transport_and_strict_error_contract(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, call

        module = ast.parse((ci.ROOT / 'infrastructure/system/test_http.py').read_text())
        function = next(node for node in module.body if isinstance(node, ast.FunctionDef)
                        and node.name.startswith('test_content_core_auth_'))
        # Execute only the scenario with test doubles: no pytest/httpx imports, HTTP or Docker.
        for status, code in [(504, 'CORE_AUTH_TIMEOUT'), (503, 'CORE_AUTH_UNAVAILABLE'),
                             (401, 'UNAUTHORIZED'), (200, ''), (504, 'CORE_AUTH_UNAVAILABLE')]:
            with self.subTest(status=status, code=code):
                compose = Mock()
                client = Mock()
                client.get.side_effect = [SimpleNamespace(status_code=200),
                    SimpleNamespace(status_code=status, json=lambda: {'code': code}),
                    SimpleNamespace(status_code=200), SimpleNamespace(status_code=200)]
                namespace = {'compose': compose, 'time': Mock(monotonic=lambda: 0)}
                exec(compile(ast.Module(body=[function], type_ignores=[]), '<system-scenario>', 'exec'), namespace)
                scenario = lambda: namespace[function.name]({'client': client, 'path': '/api/v1/works/owned'})
                if (status, code) == (504, 'CORE_AUTH_TIMEOUT'):
                    scenario()
                    self.assertEqual([call('/api/v1/works/owned'), call('/api/v1/works/owned'),
                                      call('/api/v1/health'), call('/api/v1/works/owned')], client.get.call_args_list)
                else:
                    with self.assertRaises(AssertionError):
                        scenario()
                self.assertEqual([call('pause', 'core-api'), call('unpause', 'core-api')], compose.call_args_list)

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
    def test_core_and_content_context_http_and_db_tests_are_not_unit_tests(self):
        import fnmatch
        import re
        boundary = re.compile(r"SpringBootTest|WebMvcTest|ApplicationContextRunner|AnnotationConfigApplicationContext|SpringApplicationBuilder|MockMvc|\bHttpClient\b|\bHttpServer\b|MockRestServiceServer|DriverManagerDataSource|Flyway\.configure")
        for service in ("core-api", "content-service"):
            root = ci.ROOT / "backend" / service
            build = (root / "build.gradle").read_text()
            block = build.split("def integrationTestClasses = [", 1)[1].split("]", 1)[0]
            patterns = re.findall(r"'([^']+)'", block)
            for source in (root / "src/test").rglob("*Test.*"):
                if source.suffix in {".kt", ".java"} and boundary.search(source.read_text()):
                    with self.subTest(service=service, test=source.name):
                        self.assertTrue(any(fnmatch.fnmatch("classes/" + source.stem + ".class", p) for p in patterns))
            self.assertIn("exclude integrationTestClasses", build)
            self.assertIn("include integrationTestClasses", build)

    def test_graph_credentials_are_redacted_and_only_content_integration_owns_neo4j(self):
        with patch.dict(os.environ, {'NEO4J_PASSWORD': 'short-graph-secret', 'TEST_WORLDSTUDIO_DATABASE_PASSWORD': 'short-db-secret'}):
            self.assertEqual('[redacted] [redacted]', ci.redact('short-graph-secret short-db-secret'))
        workflow = (ci.ROOT / '.github/workflows/ci.yml').read_text()
        integration = workflow.split('\n  integration:\n', 1)[1].split('\n  system:\n', 1)[0]
        self.assertIn("matrix.service == 'content' && 'neo4j:5.26.0-community'", integration)
        self.assertIn('NEO4J_URI: bolt://127.0.0.1:7687', integration)
        self.assertIn('NEO4J_PASSWORD:', integration)
        self.assertIn('"$RUNNER_TEMP/neo4j.log"', integration)
        configuration = workflow.split('\n  configuration:\n', 1)[1].split('\n  unit:\n', 1)[0]
        self.assertIn('APP_WORLDSTUDIO_ENABLED=true', configuration)
        self.assertIn('--profile worldstudio config --quiet', configuration)

    def test_world_studio_graph_public_routes_stay_content_owned(self):
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            text = (ci.ROOT / path).read_text()
            for location in ['location = /api/v1/world-studios {', 'location ^~ /api/v1/world-studios/ {']:
                self.assertIn(location + '\n        proxy_pass http://content-service:8081;', text)
        text = (ci.ROOT / 'frontend/vite.config.ts').read_text()
        self.assertIn('world-studios', text)

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
