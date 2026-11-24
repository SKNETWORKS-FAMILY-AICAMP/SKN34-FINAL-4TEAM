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

LANGFUSE_COMPOSE = 'infrastructure/docker-compose.langfuse.yaml'


def read(path):
    return (ci.ROOT / path).read_text()


def service_block(text, name):
    """compose 문자열에서 서비스 하나의 블록(다음 서비스 시작 전까지)을 잘라 낸다."""
    return re.split(r'\n  [a-z][\w-]*:\n', text.split(f'\n  {name}:\n', 1)[1], maxsplit=1)[0]


def nginx_upstream(text, route):
    """nginx location 선택(정확 일치 > 가장 긴 접두)을 흉내 내 route가 가는 proxy_pass 대상을 돌려준다."""
    locations = re.findall(r'location (\^~ |= |)(/\S*) \{([^}]*)\}', text)
    path = route.split('?')[0]
    exact = [body for modifier, prefix, body in locations if modifier == '= ' and path == prefix]
    prefixed = [(prefix, body) for modifier, prefix, body in locations if modifier != '= ' and path.startswith(prefix)]
    body = exact[0] if exact else max(prefixed, key=lambda item: len(item[0]))[1]
    return re.search(r'proxy_pass (\S+);', body)[1]


def workflow_jobs(text):
    """워크플로 문자열의 jobs 아래를 {job id: 본문}으로 자른다(2칸 들여쓴 키만 job이다)."""
    parts = re.split(r'(?m)^  ([a-z][\w-]*):\n', text.split('\njobs:\n', 1)[1])
    return dict(zip(parts[1::2], parts[2::2]))


def workflow_steps(job):
    """job 본문의 steps를 순서대로 돌려준다(항목은 '- ' 뒤의 텍스트, 단계 사이 주석은 앞 단계에 붙는다)."""
    return ('\n' + job.split('\n    steps:\n', 1)[1]).split('\n      - ')[1:]


# 서비스 job의 서비스별 (빌드, 단위, 통합) 단계 명령. 한 러너에서 이 순서로 실행한다.
SERVICE_PHASES = {
    'web': ('lint && pnpm --dir frontend build', 'vitest run src/domain src/data', "vitest run --exclude 'src/domain/**'"),
    'core': ('./gradlew bootJar', './gradlew unitTest', './gradlew integrationTest'),
    'content': ('./gradlew bootJar', './gradlew unitTest', './gradlew integrationTest'),
    'operations': ('./gradlew bootJar', './gradlew unitTest', './gradlew integrationTest'),
    'ai': ('uv lock --check', "pytest -m 'not integration'", 'pytest -m integration'),
}


class SelectionTest(unittest.TestCase):
    def test_expanded_data_paths_select_configuration_without_unrelated_services(self):
        paths = [
            'infrastructure/sample-data/genre-templates/expanded_generate.py',
            'infrastructure/sample-data/genre-templates/expanded_test.py',
            'infrastructure/sample-data/genre-templates/build_traditions.py',
            'infrastructure/sample-data/genre-templates/review/README.md',
            'infrastructure/sample-data/genre-templates/review/full-history/usa/cards-001.json',
            'infrastructure/sample-data/genre-templates/expanded-relations/merge.py',
            'infrastructure/sample-data/genre-templates/expanded-relations/worlds/usa--batch.json',
        ]
        for path in paths:
            with self.subTest(path=path):
                plan = ci.select([path])
                self.assertEqual(([], [], [], True), (plan['unit'], plan['integration'], plan['system'], plan['infra']))

    def test_expanded_runtime_data_preserves_content_selection_and_adds_configuration(self):
        for path in ['backend/content-service/src/main/resources/genre-templates.json',
                     'backend/content-service/src/main/resources/sample-worlds-expanded/manifest.json',
                     'backend/content-service/src/main/resources/sample-worlds-expanded/world-001.json']:
            with self.subTest(path=path):
                baseline = ci.select(['backend/content-service/src/main/resources/application.yaml'])
                baseline['infra'] = True
                self.assertEqual(baseline, ci.select([path]))

    def test_expanded_paths_union_with_other_changes_and_unknown_fallback(self):
        sample = 'infrastructure/sample-data/genre-templates/review/full-myth/a/cards-001.json'
        frontend = 'frontend/src/example.test.ts'
        expected = ci.select([frontend])
        expected['infra'] = True
        self.assertEqual(expected, ci.select([sample, frontend]))
        unknown = 'unregistered-runtime/config.toml'
        self.assertEqual(ci.select([unknown]), ci.select([sample, unknown]))
        self.assertEqual(set(ci.SERVICES), {row['service'] for row in ci.select([sample, unknown])['unit']})
        unknown_sample = 'infrastructure/sample-data/genre-templates/expanded_unregistered.py'
        self.assertEqual(set(ci.SERVICES), {row['service'] for row in ci.select([unknown_sample])['unit']})

    def test_configuration_runs_expanded_data_and_relation_unit_tests(self):
        workflow = (ci.ROOT / '.github/workflows/ci.yml').read_text()
        block = workflow_jobs(workflow)['configuration']
        self.assertIn('python3 -I -m unittest discover -s infrastructure/sample-data/genre-templates -p expanded_test.py -v', block)
        self.assertIn('python3 -I -m unittest discover -s infrastructure/sample-data/genre-templates/expanded-relations -p test_merge.py -v', block)
        # 하이픈 디렉터리는 상위 discover가 찾지 못하므로 시연 세계관 검사를 따로 실행한다.
        self.assertIn("python3 -I -m unittest discover -s infrastructure/sample-data/simulation-demo -p 'test_*.py' -v", block)

    def test_docs_only_has_no_runtime_jobs(self):
        plan = ci.select(["README.md", "frontend/AGENTS.md", "docs/design/design.md"])
        self.assertEqual([], plan["unit"])
        self.assertEqual([], plan["integration"])
        self.assertEqual([], plan["system"])

    def test_agent_tooling_has_no_runtime_jobs(self):
        plan = ci.select([".agent-hooks/guard.py", ".agents/skills/ponytail/SKILL.md",
                          ".claude/settings.json", ".claude/skills", ".codex/hooks.json"])
        self.assertEqual(([], [], [], False), (plan["unit"], plan["integration"], plan["system"], plan["infra"]))

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

    def test_operations_changes_select_only_its_unit_and_integration_tests(self):
        for suffix in ("build.gradle", "src/main/resources/application.properties",
                       "src/main/kotlin/ai/storyfork/operations/security/OperationsSecurityConfig.kt",
                       "src/main/kotlin/ai/storyfork/operations/notice/service/NoticeService.kt",
                       "src/main/kotlin/ai/storyfork/operations/event/service/EventService.kt",
                       "src/main/kotlin/ai/storyfork/operations/inquiry/service/InquiryService.kt",
                       "src/test/kotlin/ai/storyfork/operations/security/OperationsSecurityIntegrationTest.kt",
                       "src/main/resources/db/migration/operations/V3__inquiries.sql",
                       "gradlew", "gradle/wrapper/gradle-wrapper.jar"):
            with self.subTest(path=suffix):
                plan = ci.select([f"backend/operations-service/{suffix}"])
                self.assertEqual([{"service": "operations", "scope": "all"}], plan["unit"])
                self.assertEqual(plan["unit"], plan["integration"])
                self.assertEqual([], plan["system"])
                self.assertFalse(plan["infra"])

    def test_operations_ci_runs_native_gradle_and_isolated_postgres(self):
        job = workflow_jobs((ci.ROOT / ".github/workflows/ci.yml").read_text())["service"]
        java_condition = "matrix.service == 'core' || matrix.service == 'content' || matrix.service == 'operations'"
        self.assertIn(java_condition, job)
        operations = [step for step in workflow_steps(job) if "if: ${{ matrix.service == 'operations' }}" in step]
        for task in ("bootJar", "unitTest", "integrationTest"):
            with self.subTest(task=task):
                step = next(step for step in operations if f"run: ./gradlew {task} --no-daemon" in step)
                self.assertIn("working-directory: backend/operations-service", step)
        self.assertIn(f"({java_condition}) && 'postgres:17-alpine'", job)
        self.assertIn("TEST_OPERATIONS_DATABASE_URL: jdbc:postgresql://127.0.0.1:5432/storyfork_test", job)
        self.assertIn("TEST_OPERATIONS_DATABASE_USER: content_test", job)
        self.assertIn('TEST_OPERATIONS_DATABASE_PASSWORD: ""', job)
        self.assertIn("backend/operations-service/build/test-results", job)
        for tier in ("unit", "integration"):
            self.assertEqual(set(ci.SERVICES), {row["service"] for row in ci.select([], full=True)[tier]})

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
        configuration = workflow_jobs(workflow)['configuration']
        self.assertIn('python3 -I -m unittest discover -s infrastructure/tests -p test_attachment_environment.py -v', configuration)
        self.assertIn("python3 -I -m unittest discover -s infrastructure/sample-data -p 'test_*.py' -v", configuration)
        self.assertIn('python3 -I -m unittest discover -s infrastructure/sample-data/genre-templates -p test_traditions.py -v', configuration)

    def test_service_job_builds_then_runs_unit_then_integration_on_one_runner(self):
        jobs = workflow_jobs((ci.ROOT / '.github/workflows/ci.yml').read_text())
        self.assertFalse({'unit', 'integration'} & set(jobs))  # 두 matrix job은 서비스별 한 job으로 합쳤다
        job = jobs['service']
        self.assertIn('\n    needs: changes\n', job)  # 서비스끼리는 서로 기다리지 않고 병렬이다
        self.assertIn("if: ${{ needs.changes.outputs.service_needed == 'true' }}", job)
        self.assertIn('matrix: ${{ fromJSON(needs.changes.outputs.service) }}', job)
        self.assertIn('fail-fast: false', job)
        steps = workflow_steps(job)
        for service, commands in SERVICE_PHASES.items():
            mine = [step for step in steps if f"matrix.service == '{service}'" in step]
            with self.subTest(service=service):
                for command in commands:
                    self.assertTrue(any(command in step for step in mine), command)
                positions = [next(index for index, step in enumerate(mine) if command in step) for command in commands]
                self.assertEqual(sorted(set(positions)), positions)  # 빌드 → 단위 → 통합, 서로 다른 단계

    def test_integration_steps_do_not_run_after_a_failed_unit_step(self):
        job = workflow_jobs((ci.ROOT / '.github/workflows/ci.yml').read_text())['service']
        self.assertNotIn('continue-on-error', job)
        for service, phases in SERVICE_PHASES.items():
            for step in workflow_steps(job):
                if phases[2] in step and f"matrix.service == '{service}'" in step:
                    with self.subTest(service=service, step=step.split('\n', 1)[0]):
                        condition = re.search(r'(?m)^\s*if: (.*)$', step)[1]
                        self.assertNotRegex(condition, r'always\(\)|failure\(\)|cancelled\(\)')

    def test_system_waits_for_service_jobs_and_required_aggregates_every_job(self):
        jobs = workflow_jobs((ci.ROOT / '.github/workflows/ci.yml').read_text())
        system = jobs['system']
        self.assertIn('needs: [changes, service, configuration]', system)
        for prerequisite in ['changes', 'service']:
            self.assertIn(f"needs.{prerequisite}.result == 'success'", system)
        required = jobs['required']
        self.assertIn('if: ${{ always() }}', required)
        # 게시·배포를 뺀 모든 job을 집계한다(새 job을 더하고 빠뜨리면 이 시험이 실패한다).
        self.assertEqual(set(jobs) - {'required', 'publish', 'deploy'}, set(re.search(r'needs: \[(.*)\]', required)[1].split(', ')))
        for tier, output in (('SERVICE', 'service_needed'), ('SYSTEM', 'system_needed'), ('CONFIGURATION', 'infra')):
            self.assertIn(f'{tier}_NEEDED: ${{{{ needs.changes.outputs.{output} }}}}', required)

    def test_publish_and_deploy_run_only_for_a_develop_push_after_required_ci(self):
        workflow = (ci.ROOT / '.github/workflows/ci.yml').read_text()
        jobs = workflow_jobs(workflow)
        publish, deploy = jobs['publish'], jobs['deploy']
        self.assertIn('\n    needs: required\n', publish)
        condition = re.search(r'(?m)^    if: (.*)$', publish)[1]
        for expected in ("needs.required.result == 'success'", "github.ref == 'refs/heads/develop'",
                         "github.event_name == 'push'", "github.event_name == 'workflow_dispatch'",
                         "github.repository == 'SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM'"):
            self.assertIn(expected, condition)
        self.assertNotIn('pull_request', condition)  # PR·fork·main에는 게시 권한이 없다
        self.assertIn('\n    needs: publish\n', deploy)
        self.assertIn("if: ${{ needs.publish.result == 'success' }}", deploy)
        self.assertIn('\n    environment: develop-cd\n', deploy)
        self.assertIn('StrictHostKeyChecking=yes', deploy)
        # 진행 중인 배포는 새 push가 끊지 않는다: 워크플로 수준은 develop에서 취소를 끄고, 게시·배포는 한 그룹으로 직렬화한다.
        self.assertIn("\nconcurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: ${{ github.ref != 'refs/heads/develop' }}\n", workflow)
        for job in (publish, deploy):
            self.assertIn('\n    concurrency:\n      group: develop-cd\n      cancel-in-progress: false\n', job)
        self.assertEqual({'publish'}, {name for name, body in jobs.items() if 'packages: write' in body})
        self.assertEqual({'deploy'}, {name for name, body in jobs.items() if 'id-token: write' in body})

    def test_cd_is_part_of_ci_and_no_separate_workflow_remains(self):
        triggers = (ci.ROOT / '.github/workflows/ci.yml').read_text().split('\non:\n', 1)[1].split('\npermissions:\n', 1)[0]
        self.assertNotIn('workflow_run', triggers)
        for events in ('push:\n    branches: [develop, main]', '  pull_request:', '  workflow_dispatch:'):
            self.assertIn(events, triggers)
        for removed in ('publish-images.yml', 'deploy-develop.yml'):
            self.assertFalse((ci.ROOT / '.github/workflows' / removed).exists(), removed)

    def test_gradle_cache_is_keyed_per_service(self):
        # setup-java 기본 키는 전 서비스의 *.gradle*을 한데 해시해 core·content·operations가 한 캐시를 나눠 쓴다.
        # 먼저 저장한 서비스 것만 남아 나머지는 복원에 성공하고도 Maven Central에서 다시 받다 429로 실패한다.
        steps = [step for step in read('.github/workflows/ci.yml').split('\n      - ')
                 if 'uses: actions/setup-java@' in step and 'cache: gradle' in step]
        self.assertTrue(steps, 'Gradle 캐시를 쓰는 setup-java 단계를 찾지 못했다')
        directories = {'core': 'core-api', 'content': 'content-service', 'operations': 'operations-service'}
        for step in steps:
            block = re.search(r'cache-dependency-path: \|\n((?: {12}.*\n?)+)', step)
            patterns = [line.strip() for line in block[1].splitlines()] if block else []
            for service, directory in directories.items():
                with self.subTest(service=service):
                    owners = {file.relative_to(ci.ROOT).parts[:2] for pattern in patterns
                              for file in ci.ROOT.glob(pattern.replace('${{ matrix.service }}', service))}
                    self.assertEqual({('backend', directory)}, owners)

    def test_required_rejects_cancelled_and_unexpected_skips(self):
        ci.check_results({"service": "skipped", "system": "skipped"}, set())
        for job in ["changes", "configuration", "service", "system"]:
            ci.check_results({job: "success"}, {job})
            for result in ["failure", "cancelled", "skipped", "unknown"]:
                with self.subTest(job=job, result=result), self.assertRaises(SystemExit):
                    ci.check_results({job: result}, {job})
            with self.subTest(job=job), self.assertRaises(SystemExit):
                ci.check_results({}, {job})

    def test_required_action_expects_the_service_job_the_plan_selected(self):
        def required(service_result, **needed):
            needs = {"changes": {"result": "success"}, "service": {"result": service_result}}
            env = {**os.environ, "NEEDS": json.dumps(needs), "SERVICE_NEEDED": "false", "SYSTEM_NEEDED": "false",
                   "CONFIGURATION_NEEDED": "false", **needed}
            return subprocess.run([sys.executable, "-I", ci.__file__, "required"], env=env, capture_output=True).returncode
        self.assertEqual(0, required("success", SERVICE_NEEDED="true"))
        self.assertNotEqual(0, required("skipped", SERVICE_NEEDED="true"))  # 선택된 서비스가 안 돌았으면 거부
        self.assertNotEqual(0, required("failure", SERVICE_NEEDED="true"))
        self.assertEqual(0, required("skipped"))  # 선택 안 된 서비스의 의도적 skip은 허용


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
                self.assertEqual(set(ci.SERVICES), {row['service'] for row in plan['integration']})
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

    def test_plan_outputs_one_service_matrix_for_the_service_job(self):
        def outputs():
            return dict(line.split('=', 1) for line in (self.repo / 'output').read_text().splitlines())
        base = self.commit('clean.txt', 'clean\n')
        self.commit('README.md', 'docs only\n')
        result = self.plan('push', {'before': base})
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(('false', {'include': []}), (outputs()['service_needed'], json.loads(outputs()['service'])))
        (self.repo / 'output').unlink()
        result = self.plan('workflow_dispatch', {})
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual({'include': json.loads(result.stdout)['unit']}, json.loads(outputs()['service']))
        self.assertEqual('true', outputs()['service_needed'])
        self.assertEqual(','.join(ci.SCENARIOS), outputs()['system'])
        # 단위·통합 행렬은 서비스 job 하나로 합쳤으므로 따로 내보내지 않는다.
        self.assertTrue(set(outputs()).isdisjoint({'unit', 'unit_needed', 'integration', 'integration_needed'}))


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
        for port in ('${WEB_PORT:-5173}:80', '${CORE_API_PORT:-8080}:8080',
                     '${CONTENT_SERVICE_PORT:-8081}:8081', '${DATABASE_PORT:-5432}:5432',
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
        for forbidden in ('build:', 'volumes:', '  postgres:', '  mailpit:', 'env_file:', ':develop', 'PROD_'):
            self.assertNotIn(forbidden, source)
        # Same variable names as local/dev; the server's own .env supplies values and blanks fail config.
        for variable in ('DATABASE_URL', 'DATABASE_USER', 'DATABASE_PASSWORD',
                         'CORE_SMTP_HOST', 'CORE_SMTP_PORT', 'AUTH_PUBLIC_ORIGIN', 'AUTH_MAIL_FROM',
                         'AUTH_JWT_SECRET', 'CONTENT_CORE_AUTH_TOKEN', 'INTERNAL_TOKEN', 'OPERATIONS_SERVICE_TOKEN',
                         'WEB_PORT'):
            self.assertIn('${' + variable + ':?', source)
        self.assertIn('AUTH_COOKIE_SECURE: "true"', source)
        self.assertIn('127.0.0.1:${WEB_PORT:?', source)
        # Base interpolation must not demand local secrets before prod overrides can apply.
        base = (ci.ROOT / 'infrastructure/docker-compose.yaml').read_text()
        self.assertNotIn(':?', base)
        dev = (ci.ROOT / 'infrastructure/docker-compose.dev.yaml').read_text()
        for service in ('web', 'core-api', 'content-service', 'ai-service'):
            self.assertIn(f'image: ghcr.io/sknetworks-family-aicamp/storyfork-{service}:develop', dev)
        for variable in ('DATABASE_USER', 'DATABASE_PASSWORD', 'AUTH_JWT_SECRET'):
            self.assertIn('${' + variable + ':?', dev)
        self.assertNotIn('build:', dev)
        self.assertIn('  postgres:', dev)
        self.assertIn('  mailpit:', dev)
        self.assertEqual(4, dev.count('file: ${CD_LOCAL_COMPOSE_FILE:-docker-compose.local.yaml}'))
        for service in ('  neo4j:', '  rabbitmq:'):
            self.assertIn(service, dev)
        self.assertEqual(3, dev.count('ports: !reset []'))
        self.assertIn('DATABASE_URL: jdbc:postgresql://postgres:5432/storyfork', dev)
        self.assertIn('CORE_SMTP_HOST: mailpit', dev)
        self.assertNotIn('${DATABASE_URL', dev)
        self.assertIn('  core-postgres:', dev)
        self.assertNotIn('external:', dev)
        workflow = workflow_jobs((ci.ROOT / '.github/workflows/ci.yml').read_text())['deploy']
        self.assertIn('COMPOSE_LOCAL_YAML', workflow)
        self.assertIn("if: ${{ needs.publish.result == 'success' }}", workflow)

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
        overlay = (ci.ROOT / 'infrastructure/ci/compose.test.yaml').read_text()
        for service in ('postgres', 'core-api', 'content-service'):
            block = re.split(r'\n  [a-z][\w-]*:\n', overlay.split('  ' + service + ':\n', 1)[1], maxsplit=1)[0]
            self.assertIn('ports: !reset []', block)

    def test_langfuse_is_one_file_that_dev_and_prod_include(self):
        langfuse = read(LANGFUSE_COMPOSE)
        services = re.findall(r'(?m)^  ([a-z][\w-]*):$', langfuse.split('\nservices:\n', 1)[1].split('\nvolumes:\n', 1)[0])
        # 2026-11-23 사용자 결정: PostgreSQL·MinIO는 앱 스택의 것을 쓰고 Langfuse 전용 컨테이너를 띄우지 않는다.
        # ClickHouse·Redis는 앱 스택에 같은 저장소가 없고 Langfuse 필수라 남긴다.
        self.assertEqual({'langfuse-web', 'langfuse-worker', 'langfuse-clickhouse', 'langfuse-redis'}, set(services))
        self.assertIn('DATABASE_URL: ${LANGFUSE_DATABASE_URL:-postgresql://${DATABASE_USER:?Set DATABASE_USER}:'
                      '${DATABASE_PASSWORD:?Set DATABASE_PASSWORD}@postgres:5432/langfuse}\n', langfuse)
        for kind in ('EVENT', 'MEDIA'):
            self.assertIn(f'LANGFUSE_S3_{kind}_UPLOAD_ENDPOINT: ${{LANGFUSE_S3_ENDPOINT:-http://minio:9000}}\n', langfuse)
            self.assertIn(f'LANGFUSE_S3_{kind}_UPLOAD_BUCKET: ${{ATTACHMENT_S3_BUCKET:-storyfork-setting-attachments}}\n', langfuse)
            self.assertIn(f'LANGFUSE_S3_{kind}_UPLOAD_ACCESS_KEY_ID: ${{AWS_ACCESS_KEY_ID', langfuse)
        self.assertNotIn('LANGFUSE_DB_PASSWORD', langfuse)
        self.assertNotIn('LANGFUSE_MINIO_PASSWORD', langfuse)
        dev, prod = read('infrastructure/docker-compose.dev.yaml'), read('infrastructure/docker-compose.prod.yaml')
        # 원격 CD는 --project-directory 때문에 상대 경로가 어긋나므로 dev만 임시로 둔 절대 경로를 받는다.
        self.assertIn('\ninclude:\n  - path: ${CD_LANGFUSE_COMPOSE_FILE:-docker-compose.langfuse.yaml}\n', dev)
        self.assertIn('\ninclude:\n  - path: docker-compose.langfuse.yaml\n', prod)
        for source in (dev, prod):
            self.assertNotIn('\n  langfuse-web:\n', source)  # 정의를 복제하지 않는다.
        # 로컬 기본 진입점(루트 compose.yaml)도 별도 include 항목으로 같은 프로젝트에 항상 켠다. base·local 파일은 Langfuse를 모른다.
        self.assertIn('\n  - path: ./infrastructure/docker-compose.langfuse.yaml\n', read('compose.yaml'))
        for path in ('infrastructure/docker-compose.yaml', 'infrastructure/docker-compose.local.yaml'):
            self.assertNotIn('langfuse.yaml', read(path), path)

    def test_langfuse_web_has_no_host_port_or_login_user(self):
        # 2026-11-23 사용자 결정: Langfuse 웹 화면을 쓰지 않는다. 컨테이너는 AI·운영이 부르는 API 서버라 남기되
        # 호스트 포트와 로그인용 초기 관리자를 두지 않고 가입도 막는다. 프로젝트·API 키만 헤드리스로 만든다.
        langfuse = read(LANGFUSE_COMPOSE)
        web = service_block(langfuse, 'langfuse-web')
        self.assertNotIn('ports:', web)
        self.assertNotIn('LANGFUSE_WEB_PORT', langfuse)
        self.assertEqual({'AUTH_DISABLE_SIGNUP'}, set(re.findall(r'(?m)^      (AUTH_\w+):', web)))
        self.assertIn('AUTH_DISABLE_SIGNUP: "true"\n', web)
        self.assertEqual({'LANGFUSE_INIT_ORG_ID', 'LANGFUSE_INIT_ORG_NAME', 'LANGFUSE_INIT_PROJECT_ID', 'LANGFUSE_INIT_PROJECT_NAME',
                          'LANGFUSE_INIT_PROJECT_PUBLIC_KEY', 'LANGFUSE_INIT_PROJECT_SECRET_KEY'},
                         set(re.findall(r'(?m)^      (LANGFUSE_\w+):', web)))
        # 공개 진입점(nginx·Vite)은 Langfuse 웹으로 가는 길을 두지 않는다.
        for path in ('frontend/nginx.conf', 'infrastructure/nginx.dev.conf', 'frontend/vite.config.ts'):
            self.assertNotIn('langfuse-web', read(path), path)

    def test_langfuse_keys_and_internal_addresses_reach_ai_and_operations(self):
        base = read('infrastructure/docker-compose.yaml')
        ai, operations = service_block(base, 'ai-service'), service_block(base, 'operations-service')
        for line in ('LANGFUSE_PUBLIC_KEY: ${LANGFUSE_PUBLIC_KEY:-}', 'LANGFUSE_SECRET_KEY: ${LANGFUSE_SECRET_KEY:-}'):
            self.assertIn(line, ai)
            self.assertIn(line, operations)
        # Langfuse 서버의 초기 프로젝트 키도 같은 변수에서 읽어 세 곳의 값이 항상 같다.
        langfuse = read(LANGFUSE_COMPOSE)
        self.assertIn('LANGFUSE_INIT_PROJECT_PUBLIC_KEY: ${LANGFUSE_PUBLIC_KEY:?', langfuse)
        self.assertIn('LANGFUSE_INIT_PROJECT_SECRET_KEY: ${LANGFUSE_SECRET_KEY:?', langfuse)
        # 컨테이너에서는 Langfuse를 내부 주소로 부른다(루트 .env의 localhost 값은 네이티브 실행용).
        self.assertIn('LANGFUSE_BASE_URL: http://langfuse-web:3000', ai)
        for line in ('OPERATIONS_LANGFUSE_BASE_URL: http://langfuse-web:3000',
                     'OPERATIONS_AI_BASE_URL: http://ai-service:8000', 'INTERNAL_TOKEN: ${INTERNAL_TOKEN:-}',
                     'OPERATIONS_RABBITMQ_HOST: ${CORE_RABBITMQ_HOST:-rabbitmq}', 'OPERATIONS_RABBITMQ_PORT: ${CORE_RABBITMQ_PORT:-5672}',
                     'OPERATIONS_RABBITMQ_USERNAME: ${CORE_RABBITMQ_USER:-storyfork}',
                     'OPERATIONS_RABBITMQ_PASSWORD: ${CORE_RABBITMQ_PASSWORD:-}'):
            self.assertIn(line, operations)

    def test_operations_waits_for_the_broker_it_publishes_alerts_to(self):
        for name in ('local', 'dev'):
            with self.subTest(file=name):
                operations = service_block(read(f'infrastructure/docker-compose.{name}.yaml'), 'operations-service')
                self.assertIn('rabbitmq:\n        condition: service_healthy', operations)

    def test_configuration_job_supplies_every_required_dev_and_prod_value(self):
        # .env.example는 비밀값을 비워 두므로 dev·prod·Langfuse가 :? 로 요구하는 값은 job의 합성 값이 채워야 config가 통과한다.
        job = read('.github/workflows/ci.yml').split('\n  configuration:\n', 1)[1].split('\n    steps:\n', 1)[0]
        example = dict(line.split('=', 1) for line in read('.env.example').splitlines() if line and not line.startswith('#'))
        provided = set(re.findall(r'(?m)^ {6}([A-Z][A-Z0-9_]*):', job)) | {key for key, value in example.items() if value}
        for name in ('docker-compose.dev.yaml', 'docker-compose.prod.yaml', 'docker-compose.langfuse.yaml'):
            with self.subTest(file=name):
                required = set(re.findall(r'\$\{([A-Z][A-Z0-9_]*):\?', read('infrastructure/' + name)))
                self.assertEqual(set(), required - provided)

    def test_example_lists_the_native_operations_settings_blank(self):
        example = dict(line.split('=', 1) for line in read('.env.example').splitlines() if line and not line.startswith('#'))
        for key in ('OPERATIONS_LANGFUSE_BASE_URL', 'OPERATIONS_AI_BASE_URL', 'OPERATIONS_RABBITMQ_HOST', 'OPERATIONS_RABBITMQ_PORT',
                    'OPERATIONS_RABBITMQ_USERNAME', 'OPERATIONS_RABBITMQ_PASSWORD'):
            with self.subTest(key=key):
                self.assertEqual('', example[key])

    def test_example_does_not_activate_deployment_or_supply_signing_keys(self):
        source = (ci.ROOT / '.env.example').read_text()
        active = dict(line.split('=', 1) for line in source.splitlines() if line and not line.startswith('#'))
        self.assertFalse(any(key.startswith(('PROD_', 'CD_')) for key in active))
        for key in ('AUTH_JWT_SECRET', 'DATABASE_USER', 'DATABASE_PASSWORD', 'CONTENT_CORE_AUTH_TOKEN', 'INTERNAL_TOKEN'):
            self.assertEqual('', active[key])
        self.assertEqual('false', active['AUTH_COOKIE_SECURE'])
        self.assertEqual('5173', active['WEB_PORT'])
        self.assertNotIn('PROD_', source)
        self.assertNotIn('GETSTREAM_API_KEY', source)
        self.assertIn('CD_DIRECTORY', source)


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
        self.assertEqual(30, mutations)  # Anonymous missing-CSRF rejection stays intentionally unrefreshed.


class ConfigurationTest(unittest.TestCase):
    def test_spring_context_http_and_db_tests_are_not_unit_tests(self):
        import fnmatch
        import re
        boundary = re.compile(r"SpringBootTest|WebMvcTest|ApplicationContextRunner|AnnotationConfigApplicationContext|SpringApplicationBuilder|MockMvc|\bHttpClient\b|\bHttpServer\b|MockRestServiceServer|DriverManagerDataSource|Flyway\.configure")
        for service in ("core-api", "content-service", "operations-service"):
            root = ci.ROOT / "backend" / service
            build = (root / "build.gradle").read_text()
            block = build.split("def integrationTestClasses = [", 1)[1].split("]", 1)[0]
            patterns = re.findall(r"'([^']+)'", block)
            for source in (root / "src/test").rglob("*Test.*"):
                if source.suffix not in {".kt", ".java"}:
                    continue
                # 설명의 'MockMvc 없이' 같은 문구는 실행 의존성이 아니다.
                code = re.sub(r"/\*.*?\*/|(?m:^\s*//[^\n]*)", "", source.read_text(), flags=re.DOTALL)
                if boundary.search(code):
                    with self.subTest(service=service, test=source.name):
                        self.assertTrue(any(fnmatch.fnmatch("classes/" + source.stem + ".class", p) for p in patterns))
            self.assertIn("exclude integrationTestClasses", build)
            self.assertIn("include integrationTestClasses", build)

    def test_graph_credentials_are_redacted_and_only_content_integration_owns_neo4j(self):
        with patch.dict(os.environ, {'NEO4J_PASSWORD': 'short-graph-secret', 'TEST_WORLDSTUDIO_DATABASE_PASSWORD': 'short-db-secret'}):
            self.assertEqual('[redacted] [redacted]', ci.redact('short-graph-secret short-db-secret'))
        workflow = (ci.ROOT / '.github/workflows/ci.yml').read_text()
        integration = workflow_jobs(workflow)['service']
        self.assertIn("matrix.service == 'content' && 'neo4j:5.26.0-community'", integration)
        self.assertIn('NEO4J_URI: bolt://127.0.0.1:7687', integration)
        self.assertIn('NEO4J_PASSWORD:', integration)
        self.assertIn('"$RUNNER_TEMP/neo4j.log"', integration)
        configuration = workflow_jobs(workflow)['configuration']
        self.assertIn('NEO4J_PASSWORD: synthetic-config-only', configuration)
        self.assertNotIn('--profile', configuration)

    def test_nginx_proxy_waits_beyond_the_75s_generation_deadline(self):
        # Content의 AI 생성 대기(75초)보다 길어야 nginx가 먼저 끊지 않는다. 첫 일치가 서버 수준 값이다.
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            with self.subTest(proxy=path):
                timeout = re.search(r'^\s*proxy_read_timeout\s+(\d+)s;', read(path), re.M)
                self.assertTrue(timeout and int(timeout.group(1)) > 75, 'proxy must wait beyond the 75s generation deadline')

    def test_world_studio_graph_public_routes_stay_content_owned(self):
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            text = (ci.ROOT / path).read_text()
            for location in ['location = /api/v1/world-studios {', 'location ^~ /api/v1/world-studios/ {']:
                self.assertIn(location + '\n        proxy_pass http://content-service:8081;', text)
        text = (ci.ROOT / 'frontend/vite.config.ts').read_text()
        self.assertIn('world-studios', text)

    def test_world_studio_proxy_accepts_card_attachment_uploads(self):
        # 설정 카드 첨부(#735)는 파일당 10 MiB(multipart 11 MiB)까지다. 세계관 프록시의 본문 한도가 그보다 작으면 nginx가 먼저 413으로 끊는다.
        route = '/api/v1/world-studios/world-id/cards/card-id/attachments/attachment-id/content'
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            text = (ci.ROOT / path).read_text()
            with self.subTest(proxy=path):
                self.assertEqual('http://content-service:8081', nginx_upstream(text, route))
                body = re.search(r'location \^~ /api/v1/world-studios/ \{([^}]*)\}', text)[1]
                self.assertGreaterEqual(int(re.search(r'client_max_body_size (\d+)m;', body)[1]), 11)

    def test_public_world_studio_routes_go_to_content(self):
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            text = (ci.ROOT / path).read_text()
            for location in ['location = /api/v1/public/world-studios {', 'location ^~ /api/v1/public/world-studios/ {']:
                self.assertIn(location + '\n        proxy_pass http://content-service:8081;', text)
        vite = (ci.ROOT / 'frontend/vite.config.ts').read_text()
        pattern = re.search(r"'([^']*world-studios[^']*)':\s*\{", vite)[1].replace('\\\\', '\\')
        for path in ['/api/v1/world-studios', '/api/v1/world-studios/id', '/api/v1/public/world-studios',
                     '/api/v1/public/world-studios?genre=sf&page=0&size=24', '/api/v1/public/world-studios/id']:
            self.assertRegex(path, pattern)
        for path in ['/api/v1/world-studios-extra', '/api/v1/public/world-studios-extra', '/api/v1/public/auth', '/api/v1/auth/csrf']:
            self.assertNotRegex(path, pattern)

    def test_work_world_link_and_reader_wiki_routes_go_to_content(self):
        # DEC-46: 연결 PUT /api/v1/works/{id}/world-studio와 독자 설정 위키 GET /api/v1/public/works/{id}/world-cards는
        # 새 location 없이 기존 works 접두로 Content에 간다(더 긴 접두나 정규식 location이 가로채지 않는다).
        routes = ['/api/v1/works/work-id/world-studio', '/api/v1/works/work-id/inherited-world', '/api/v1/public/works/work-id/world-cards']
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            text = (ci.ROOT / path).read_text()
            self.assertNotRegex(text, r'location\s+~')
            locations = re.findall(r'location (\^~ |= |)(/\S*) \{([^}]*)\}', text)
            for route in routes:
                with self.subTest(proxy=path, route=route):
                    _, prefix, body = max((l for l in locations if l[0] != '= ' and route.startswith(l[1])), key=lambda l: len(l[1]))
                    self.assertIn(prefix, ['/api/v1/works/', '/api/v1/public/works/'])
                    self.assertIn('proxy_pass http://content-service:8081;', body)
        vite = (ci.ROOT / 'frontend/vite.config.ts').read_text()
        pattern = re.search(r"'([^']*works[^']*)':\s*\{", vite)[1].replace('\\\\', '\\')
        for route in routes + ['/api/v1/public/works/work-id/world-cards?upto=3']:
            self.assertRegex(route, pattern)

    def test_operations_support_public_routes_expose_only_the_support_prefix(self):
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            text = (ci.ROOT / path).read_text()
            for location in ['location = /api/v1/operations/support {', 'location ^~ /api/v1/operations/support/ {']:
                self.assertIn(location + '\n        proxy_pass http://operations-service:8082;', text)
            # 서비스 토큰 CRUD(inquiries·notices·events)는 공개 진입점에 열지 않는다.
            for private in ['/api/v1/operations/inquiries', '/api/v1/operations/notices', '/api/v1/operations/events']:
                self.assertNotIn(private, text)
        text = (ci.ROOT / 'frontend/vite.config.ts').read_text()
        self.assertIn('(?:reports|members|admins|support|works|comments|admin/notices|public/notices|admin/events|public/events|admin/activities|dashboard|llmops|alerts|jobs|genres|credits|world-studios|card-categories|feedback-reports)', text)

    def test_operations_works_public_routes_go_to_operations(self):
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            text = (ci.ROOT / path).read_text()
            for location in ['location = /api/v1/operations/works {', 'location ^~ /api/v1/operations/works/ {']:
                self.assertIn(location + '\n        proxy_pass http://operations-service:8082;', text)

    def test_operations_comments_public_routes_go_to_operations(self):
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            text = (ci.ROOT / path).read_text()
            for location in ['location = /api/v1/operations/comments {', 'location ^~ /api/v1/operations/comments/ {']:
                self.assertIn(location + '\n        proxy_pass http://operations-service:8082;', text)

    def test_operations_admin_activities_public_route_goes_to_operations(self):
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            text = (ci.ROOT / path).read_text()
            for location in ['location = /api/v1/operations/admin/activities {', 'location ^~ /api/v1/operations/admin/activities/ {']:
                self.assertIn(location + '\n        proxy_pass http://operations-service:8082;', text)

    def test_operations_dashboard_llmops_alerts_and_jobs_routes_go_to_operations(self):
        # DEC-55: 운영 대시보드·LLMOps·경고·작업 감시 API는 네 접두와 하위 경로를 Operations로 보낸다(일반 /api보다 구체적).
        routes = ['/api/v1/operations/dashboard', '/api/v1/operations/llmops/traces?from=2026-11-19',
                  '/api/v1/operations/llmops/prompts/p/production', '/api/v1/operations/alerts',
                  '/api/v1/operations/alerts/rules/ai_failure_rate', '/api/v1/operations/jobs/runs/id/retry',
                  '/api/v1/operations/jobs/schedules']
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            for route in routes:
                with self.subTest(proxy=path, route=route):
                    self.assertEqual('http://operations-service:8082', nginx_upstream(read(path), route))
        pattern = re.search(r"'(\^/api/v1/operations/[^']*)':\s*\{", read('frontend/vite.config.ts'))[1].replace('\\\\', '\\')
        for route in routes:
            with self.subTest(vite=route):
                self.assertRegex(route, pattern)
        for route in ['/api/v1/operations/dashboards', '/api/v1/operations/jobs-extra',
                      '/api/v1/operations/inquiries', '/api/v1/operations/notices']:
            with self.subTest(vite=route):
                self.assertNotRegex(route, pattern)

    def test_genre_routes_go_to_content_and_operations(self):
        # DEC-56: 공개 장르 목록은 Content, 운영 장르 관리(목록·추가와 {code} 수정·order 순서)는 Operations로 간다(일반 /api(Core)보다 구체적).
        content = ['/api/v1/public/genres', '/api/v1/public/genres?x=1']
        operations = ['/api/v1/operations/genres', '/api/v1/operations/genres/genre-31', '/api/v1/operations/genres/order']
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            for route in content:
                with self.subTest(proxy=path, route=route):
                    self.assertEqual('http://content-service:8081', nginx_upstream(read(path), route))
            for route in operations:
                with self.subTest(proxy=path, route=route):
                    self.assertEqual('http://operations-service:8082', nginx_upstream(read(path), route))
        vite = read('frontend/vite.config.ts')
        content_pattern = re.search(r"'(\^/api/v1/\(\?:[^']*world-studios[^']*)':\s*\{", vite)[1].replace('\\\\', '\\')
        operations_pattern = re.search(r"'(\^/api/v1/operations/[^']*)':\s*\{", vite)[1].replace('\\\\', '\\')
        for route in content:
            with self.subTest(vite=route):
                self.assertRegex(route, content_pattern)
        for route in operations:
            with self.subTest(vite=route):
                self.assertRegex(route, operations_pattern)
        for route in ['/api/v1/public/genres-extra', '/api/v1/public/genre']:
            with self.subTest(vite=route):
                self.assertNotRegex(route, content_pattern)
        for route in ['/api/v1/operations/genres-extra', '/api/v1/operations/genre']:
            with self.subTest(vite=route):
                self.assertNotRegex(route, operations_pattern)

    def test_card_category_and_world_studio_routes_go_to_content_and_operations(self):
        # 운영자 콘텐츠 관리: 공개 카드 카테고리 목록은 Content, 운영 카드 카테고리·세계관 제한·회차 제한·묶음 잔액은 Operations로 간다(일반 /api(Core)보다 구체적).
        content = ['/api/v1/public/card-categories', '/api/v1/public/card-categories?x=1']
        operations = ['/api/v1/operations/card-categories', '/api/v1/operations/card-categories/location', '/api/v1/operations/card-categories/order',
                      '/api/v1/operations/world-studios', '/api/v1/operations/world-studios/7c9e/restriction',
                      '/api/v1/operations/works/w1/episodes', '/api/v1/operations/works/w1/episodes/3/restriction',
                      '/api/v1/operations/credits/balances', '/api/v1/operations/reports/r1/restriction']
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            for route in content:
                with self.subTest(proxy=path, route=route):
                    self.assertEqual('http://content-service:8081', nginx_upstream(read(path), route))
            for route in operations:
                with self.subTest(proxy=path, route=route):
                    self.assertEqual('http://operations-service:8082', nginx_upstream(read(path), route))
        vite = read('frontend/vite.config.ts')
        content_pattern = re.search(r"'(\^/api/v1/\(\?:[^']*world-studios[^']*)':\s*\{", vite)[1].replace('\\\\', '\\')
        operations_pattern = re.search(r"'(\^/api/v1/operations/[^']*)':\s*\{", vite)[1].replace('\\\\', '\\')
        for route in content:
            with self.subTest(vite=route):
                self.assertRegex(route, content_pattern)
        for route in operations:
            with self.subTest(vite=route):
                self.assertRegex(route, operations_pattern)
        for route in ['/api/v1/public/card-categories-extra', '/api/v1/public/card-category']:
            with self.subTest(vite=route):
                self.assertNotRegex(route, content_pattern)
        for route in ['/api/v1/operations/card-categories-extra', '/api/v1/operations/world-studios-extra', '/api/v1/operations/card-category']:
            with self.subTest(vite=route):
                self.assertNotRegex(route, operations_pattern)

    def test_operations_credits_routes_go_to_operations(self):
        # DEC-57: 운영 크레딧(회원별 잔액·내역, 수동 지급·회수)은 접두와 하위 경로를 Operations로 보낸다(일반 /api(Core)보다 구체적).
        routes = ['/api/v1/operations/credits', '/api/v1/operations/credits/members/7c9e',
                  '/api/v1/operations/credits/members/7c9e/grants', '/api/v1/operations/credits/members/7c9e/revocations']
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            for route in routes:
                with self.subTest(proxy=path, route=route):
                    self.assertEqual('http://operations-service:8082', nginx_upstream(read(path), route))
        pattern = re.search(r"'(\^/api/v1/operations/[^']*)':\s*\{", read('frontend/vite.config.ts'))[1].replace('\\\\', '\\')
        for route in routes:
            with self.subTest(vite=route):
                self.assertRegex(route, pattern)
        for route in ['/api/v1/operations/credits-extra', '/api/v1/operations/credit']:
            with self.subTest(vite=route):
                self.assertNotRegex(route, pattern)

    def test_operations_feedback_reports_route_goes_to_operations(self):
        # #750: 운영자가 독자 제보를 읽는(읽기 전용) API는 접두와 하위 경로를 Operations로 보낸다(일반 /api(Core)보다 구체적).
        routes = ['/api/v1/operations/feedback-reports', '/api/v1/operations/feedback-reports?status=unchecked&page=1&size=20',
                  '/api/v1/operations/feedback-reports/r1']
        for path in ['frontend/nginx.conf', 'infrastructure/nginx.dev.conf']:
            for route in routes:
                with self.subTest(proxy=path, route=route):
                    self.assertEqual('http://operations-service:8082', nginx_upstream(read(path), route))
        pattern = re.search(r"'(\^/api/v1/operations/[^']*)':\s*\{", read('frontend/vite.config.ts'))[1].replace('\\\\', '\\')
        for route in routes:
            with self.subTest(vite=route):
                self.assertRegex(route, pattern)
        for route in ['/api/v1/operations/feedback-reports-extra', '/api/v1/operations/feedback-report']:
            with self.subTest(vite=route):
                self.assertNotRegex(route, pattern)

    def test_redaction_does_not_keep_tokens_or_addresses(self):
        text = ci.redact('Bearer abc.def.ghi test@example.invalid #token=opaque-token ' + 'a' * 64)
        for secret in ['abc.def.ghi', 'test@example.invalid', 'opaque-token', 'a' * 64]:
            self.assertNotIn(secret, text)

    def test_operations_credentials_are_removed_from_failure_reports(self):
        secrets = {"OPERATIONS_SERVICE_TOKEN": "short-test-token", "DATABASE_PASSWORD": "test-password"}
        with patch.dict(os.environ, secrets):
            self.assertEqual("[redacted] [redacted]", ci.redact("short-test-token test-password"))

    def test_cd_publish_and_deploy_checkout_same_exact_source_sha(self):
        jobs = workflow_jobs((ci.ROOT / '.github/workflows/ci.yml').read_text())
        self.assertIn('TARGET_SHA: ${{ github.sha }}', jobs['publish'])
        for job in ['publish', 'deploy']:
            with self.subTest(job=job):
                checkout = jobs[job].split('uses: actions/checkout@', 1)[1].split('\n      - ', 1)[0]
                self.assertIn('ref: ${{ github.sha }}', checkout)
                self.assertIn('persist-credentials: false', checkout)

    def test_cd_deploy_gets_the_build_trees_publish_computed(self):
        jobs = workflow_jobs((ci.ROOT / '.github/workflows/ci.yml').read_text())
        publish, deploy = jobs['publish'], jobs['deploy']
        self.assertIn('trees: ${{ steps.images.outputs.trees }}', publish)
        self.assertIn('CD_TREES: ${{ needs.publish.outputs.trees }}', deploy)
        self.assertIn('CD_TREES "$CD_TREES"', deploy)

    def test_cd_ssh_directory_uses_step_runner_temp(self):
        deploy = workflow_jobs((ci.ROOT / '.github/workflows/ci.yml').read_text())['deploy']
        job_env = deploy.split('\n    env:\n', 1)[1].split('\n    steps:\n', 1)[0]
        self.assertNotIn('${{ runner.', job_env)
        prepare = deploy.split('      - name: Prepare SSH\n', 1)[1].split('\n      - name:', 1)[0]
        self.assertIn('SSH_DIR="$RUNNER_TEMP/storyfork-ssh"', prepare)
        self.assertIn('printf \'SSH_DIR=%s\\n\' "$SSH_DIR" >> "$GITHUB_ENV"', prepare)


if __name__ == "__main__":
    unittest.main()
