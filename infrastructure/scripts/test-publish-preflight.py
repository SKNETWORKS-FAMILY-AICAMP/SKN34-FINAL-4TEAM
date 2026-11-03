"""Exercise Images trust gates and GHCR preflight with local HTTP servers only."""
import copy
import http.server
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import textwrap
import threading
import urllib.parse

root = Path(__file__).resolve().parents[2]
ci = (root / '.github/workflows/ci.yml').read_text()
images_path = root / '.github/workflows/publish-images.yml'
assert images_path.exists(), 'Images workflow missing; publication still lives in CI'
workflow = images_path.read_text()
assert '  publish:' not in ci and 'docker push' not in ci
for service, output in [('web', 'web'), ('core-api', 'core'), ('ai-service', 'ai'), ('infrastructure', 'infra')]:
    assert f"if: ${{{{ github.event_name == 'workflow_dispatch' || needs.changes.outputs.{output} == 'true' }}}}" in ci, service
assert ci.count("'.github/workflows/publish-images.yml'") == 4
assert 'python3 -I infrastructure/scripts/test-publish-preflight.py' in ci
assert 'name: CI\n' in ci and 'name: Required CI\n' in ci
assert 'name: Images\n' in workflow
assert 'workflows: [CI]' in workflow and 'branches: [develop, main]' in workflow
assert 'types: [completed]' in workflow and '  workflow_dispatch:' in workflow
assert 'group: images-${{ github.event.workflow_run.head_branch || github.ref_name }}' in workflow
assert 'cancel-in-progress: false' in workflow
assert 'actions: read' in workflow and workflow.count('packages: write') == 1
assert 'ref: ${{ github.event.repository.default_branch }}' in workflow
assert workflow.index('ref: ${{ github.event.repository.default_branch }}') < workflow.index('python3 -I infrastructure/scripts/check-publish-ci.py')
assert 'needs: gate' in workflow and 'ref: ${{ needs.gate.outputs.sha }}' in workflow
assert 'TARGET_SHA: ${{ needs.gate.outputs.sha }}' in workflow
assert 'TARGET_BRANCH: ${{ needs.gate.outputs.branch }}' in workflow
publication = workflow.split('  publish:\n', 1)[1]
assert 'GITHUB_SHA' not in publication and 'GITHUB_REF' not in publication
assert 'download-artifact' not in workflow and 'actions/cache' not in workflow
assert '--platform linux/amd64' in workflow
assert workflow.count('persist-credentials: false') == workflow.count('uses: actions/checkout@')
for action in re.findall(r'uses: (\S+)', ci + workflow):
    assert re.fullmatch(r'[^@]+@[0-9a-f]{40}', action), action
print('CI/Images separation, manual validation and trusted checkout wiring passed')

script = textwrap.dedent(workflow.split('          # preflight-start\n', 1)[1].split('          # preflight-end\n', 1)[0])

class Handler(http.server.BaseHTTPRequestHandler):
    status, body = 403, b'{"errors":[{"code":"DENIED"}]}'
    routes = None
    requests = []

    def do_GET(self):
        if self.routes is None:
            status, body = self.status, self.body
        else:
            self.requests.append(self.path)
            assert self.headers.get('Authorization') == 'Bearer test-secret'
            path = urllib.parse.urlsplit(self.path).path
            status, body = self.routes.get(self.path, self.routes.get(path, (404, {})))
            if not isinstance(body, bytes):
                body = json.dumps(body).encode()
        self.send_response(status)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
api_url = f'http://127.0.0.1:{server.server_port}'
try:
    script = script.replace('https://ghcr.io/token', api_url + '/token')
    for status, body, expected in [(200, b'{"token":"secret"}', 1), (401, b'{"errors":[{"code":"UNAUTHORIZED","message":"authentication required"}]}', 0), (403, b'{"errors":[{"code":"DENIED"}]}', 0), (401, b'{"errors":[{"code":"DENIED"}]}', 1), (403, b'{"errors":[{"code":"UNAUTHORIZED"}]}', 1), (401, b'{"errors":[{"code":"UNAUTHORIZED"},{"code":"DENIED"}]}', 1), (403, b'{"errors":[{"code":"DENIED"},{"code":"DENIED"}]}', 1), (403, b'{"errors":[]}', 1), (403, b'bad json', 1), (403, b'{"errors":[{"code":"OTHER"}]}', 1), (401, b'{}', 1), (429, b'{}', 1), (500, b'{}', 1)]:
        Handler.status, Handler.body = status, body
        result = subprocess.run([sys.executable, '-I', '-c', script], env={**os.environ, 'IMAGE': 'ghcr.io/sknetworks-family-aicamp/storyfork-web'}, capture_output=True, text=True)
        assert (result.returncode == 0) == (expected == 0), (status, result.stderr)
        assert 'secret' not in result.stdout + result.stderr
    print('GHCR preflight cases passed')

    # workflow_run's default-branch SHA/ref must never replace the validated target.
    head_script = textwrap.dedent(workflow.split('          # branch-head-start\n', 1)[1].split('          # branch-head-end\n', 1)[0])
    head_script = head_script.replace('https://api.github.com', api_url)
    head_env = {**os.environ, 'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_REF_NAME': 'main', 'GITHUB_SHA': 'default-sha', 'TARGET_BRANCH': 'develop', 'TARGET_SHA': 'abc', 'GH_TOKEN': 'test-secret'}
    for status, body, expected in [(200, b'{"object":{"sha":"abc"}}', 0), (200, b'{"object":{"sha":"old"}}', 1), (200, b'{}', 1), (403, b'{}', 1), (500, b'{}', 1), (200, b'bad json', 1)]:
        Handler.status, Handler.body = status, body
        result = subprocess.run([sys.executable, '-I', '-c', head_script], env=head_env, capture_output=True, text=True)
        assert (result.returncode == 0) == (expected == 0), (status, body, result.stderr)
        assert 'test-secret' not in result.stdout + result.stderr
    assert 'docker push --all-tags' not in workflow
    assert 'docker push "$IMAGE:$TARGET_BRANCH"' in workflow
    assert 'docker push "$IMAGE:sha-$TARGET_SHA"' in workflow
    assert '--label "org.opencontainers.image.revision=$TARGET_SHA"' in workflow
    assert '--tag "$IMAGE:$TARGET_BRANCH" --tag "$IMAGE:sha-$TARGET_SHA"' in workflow
    assert workflow.index('# branch-head-end') < workflow.index('docker push "$IMAGE:sha-$TARGET_SHA"')
    print('Branch HEAD and explicit validated-SHA tag cases passed')

    sha = '1' * 40
    prefix = '/repos/owner/repo'
    workflow_route = prefix + '/actions/workflows/ci.yml'
    run_route = prefix + '/actions/runs/42'
    jobs_route = run_route + '/attempts/2/jobs'
    head_route = prefix + '/git/ref/heads/develop'
    runs_route = workflow_route + '/runs'
    run = {
        'id': 42, 'run_attempt': 2, 'name': 'CI', 'workflow_id': 7,
        'path': '.github/workflows/ci.yml', 'event': 'push',
        'head_branch': 'develop', 'head_sha': sha,
        'head_repository': {'full_name': 'owner/repo'},
        'repository': {'full_name': 'owner/repo'},
        'status': 'completed', 'conclusion': 'success',
    }
    job = {'name': 'Required CI', 'run_id': 42, 'run_attempt': 2, 'head_sha': sha, 'status': 'completed', 'conclusion': 'success'}
    fixtures = {
        workflow_route: (200, {'id': 7, 'name': 'CI', 'path': '.github/workflows/ci.yml', 'state': 'active'}),
        run_route: (200, run),
        jobs_route: (200, {'total_count': 1, 'jobs': [job]}),
        head_route: (200, {'ref': 'refs/heads/develop', 'object': {'sha': sha}}),
        runs_route: (200, {'total_count': 1, 'workflow_runs': [run]}),
    }
    gate_cases = 0

    def check_gate(label, *, event_run=None, overrides=None, responses=None, manual=False, passed=False):
        global gate_cases
        gate_cases += 1
        Handler.routes = copy.deepcopy(fixtures if responses is None else responses)
        Handler.requests = []
        event = {'repository': {'default_branch': 'main'}, 'workflow_run': run if event_run is None else event_run}
        with tempfile.TemporaryDirectory() as directory:
            event_path = Path(directory) / 'event.json'
            output_path = Path(directory) / 'output'
            event_path.write_text(json.dumps(event))
            output_path.touch()
            env = {**os.environ, 'GITHUB_API_URL': api_url, 'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_EVENT_PATH': str(event_path), 'GITHUB_OUTPUT': str(output_path), 'GH_TOKEN': 'test-secret', 'GITHUB_EVENT_NAME': 'workflow_dispatch' if manual else 'workflow_run', 'GITHUB_SHA': sha if manual else 'd' * 40, 'GITHUB_REF': 'refs/heads/develop' if manual else 'refs/heads/main', **(overrides or {})}
            result = subprocess.run([sys.executable, '-I', str(root / 'infrastructure/scripts/check-publish-ci.py')], env=env, capture_output=True, text=True)
            output = output_path.read_text()
        assert (result.returncode == 0) == passed, (label, result.stdout, result.stderr)
        assert 'test-secret' not in result.stdout + result.stderr + output, label
        if passed:
            target_branch = env['GITHUB_REF'].removeprefix('refs/heads/') if manual else event['workflow_run']['head_branch']
            assert output == f'sha={sha}\nbranch={target_branch}\n', (label, output)
            assert any(urllib.parse.urlsplit(path).path == jobs_route for path in Handler.requests), label
        else:
            assert not output, (label, output)
        return list(Handler.requests)

    check_gate('automatic target differs from default branch context', passed=True)
    for key, value in [
        ('event', 'pull_request'), ('head_repository', {'full_name': 'fork/repo'}),
        ('repository', {'full_name': 'other/repo'}), ('status', 'in_progress'),
        ('conclusion', 'failure'), ('conclusion', 'cancelled'), ('conclusion', None),
        ('head_sha', '2' * 40), ('head_sha', 'bad-sha'), ('head_branch', 'feature/x'),
        ('path', '.github/workflows/other.yml'), ('name', 'Other'), ('workflow_id', 8),
        ('run_attempt', 1),
    ]:
        changed_run = {**run, key: value}
        check_gate('untrusted trigger ' + key + '=' + str(value), event_run=changed_run)
    for key, value in [
        ('event', 'pull_request'), ('head_repository', {'full_name': 'fork/repo'}),
        ('status', 'in_progress'), ('conclusion', 'failure'), ('conclusion', 'cancelled'),
        ('head_sha', '2' * 40), ('head_branch', 'main'), ('path', '.github/workflows/other.yml'),
        ('workflow_id', 8), ('run_attempt', 3), ('id', 99),
    ]:
        changed = copy.deepcopy(fixtures)
        changed[run_route] = (200, {**run, key: value})
        check_gate('API run mismatch ' + key, responses=changed)
    for jobs in [[], [{**job, 'name': 'Other'}], [job, job]] + [
        [{**job, key: value}] for key, value in [
            ('status', 'in_progress'), ('conclusion', 'skipped'), ('conclusion', 'failure'),
            ('conclusion', 'cancelled'), ('head_sha', '2' * 40), ('run_id', 99), ('run_attempt', 1),
        ]
    ]:
        changed = copy.deepcopy(fixtures)
        changed[jobs_route] = (200, {'total_count': len(jobs), 'jobs': jobs})
        check_gate('Required CI evidence ' + str(jobs), responses=changed)
    for route in [workflow_route, run_route, head_route, jobs_route]:
        for status, body in [(403, {}), (500, {}), (200, b'bad json'), (200, [])]:
            changed = copy.deepcopy(fixtures)
            changed[route] = (status, body)
            check_gate('API failure/malformed ' + route, responses=changed)
    changed = copy.deepcopy(fixtures)
    changed[workflow_route] = (200, {'id': 8, 'name': 'CI', 'path': '.github/workflows/other.yml', 'state': 'active'})
    check_gate('workflow identity mismatch', responses=changed)

    requests = check_gate('manual selected develop HEAD', manual=True, passed=True)
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(next(path for path in requests if urllib.parse.urlsplit(path).path == runs_route)).query)
    assert query['branch'] == ['develop'] and query['head_sha'] == [sha] and query['status'] == ['success']
    changed = copy.deepcopy(fixtures)
    main_run = {**run, 'head_branch': 'main', 'event': 'workflow_dispatch'}
    changed[run_route] = (200, main_run)
    changed[runs_route] = (200, {'total_count': 1, 'workflow_runs': [main_run]})
    changed[prefix + '/git/ref/heads/main'] = (200, {'ref': 'refs/heads/main', 'object': {'sha': sha}})
    check_gate('manual selected main HEAD with manual CI evidence', manual=True, overrides={'GITHUB_REF': 'refs/heads/main'}, responses=changed, passed=True)
    check_gate('manual arbitrary branch', manual=True, overrides={'GITHUB_REF': 'refs/heads/feature/x'})
    check_gate('manual tag', manual=True, overrides={'GITHUB_REF': 'refs/tags/develop'})
    check_gate('manual selected ref SHA differs', manual=True, overrides={'GITHUB_SHA': '2' * 40})
    for candidates in [[], [{**run, 'event': 'pull_request'}], [{**run, 'head_repository': {'full_name': 'fork/repo'}}], [{**run, 'head_sha': '2' * 40}], [{**run, 'conclusion': 'failure'}]]:
        changed = copy.deepcopy(fixtures)
        changed[runs_route] = (200, {'total_count': len(candidates), 'workflow_runs': candidates})
        check_gate('manual missing/untrusted CI', manual=True, responses=changed)
    changed = copy.deepcopy(fixtures)
    changed[runs_route] = (500, {})
    check_gate('manual CI lookup failed', manual=True, responses=changed)
    changed = copy.deepcopy(fixtures)
    changed[runs_route] = (200, {'total_count': 2, 'workflow_runs': [run]})
    check_gate('manual malformed CI page must not yield evidence', manual=True, responses=changed)
    changed = copy.deepcopy(fixtures)
    changed[jobs_route + '?per_page=100&page=1'] = (200, {'total_count': 101, 'jobs': [{'name': 'Other'}] * 100})
    changed[jobs_route + '?per_page=100&page=2'] = (200, {'total_count': 101, 'jobs': [job]})
    check_gate('Required CI on next API page', responses=changed, passed=True)
    changed = copy.deepcopy(fixtures)
    changed[runs_route + '?branch=develop&head_sha=' + sha + '&status=success&per_page=100&page=1'] = (200, {'total_count': 101, 'workflow_runs': [{**run, 'event': 'pull_request'}] * 100})
    changed[runs_route + '?branch=develop&head_sha=' + sha + '&status=success&per_page=100&page=2'] = (200, {'total_count': 101, 'workflow_runs': [run]})
    check_gate('manual trusted CI on next API page', manual=True, responses=changed, passed=True)
    changed = copy.deepcopy(fixtures)
    changed[jobs_route] = (200, {'total_count': 1, 'jobs': [{key: value for key, value in job.items() if key != 'run_attempt'}]})
    check_gate('attempt endpoint binds optional job run_attempt', responses=changed, passed=True)
    changed = copy.deepcopy(fixtures)
    changed[head_route] = (200, {'object': {'sha': '2' * 40}})
    check_gate('branch moved before automatic gate', responses=changed)
    check_gate('unsupported trigger', overrides={'GITHUB_EVENT_NAME': 'pull_request'})
    print(f'Exact-SHA Required CI API gate cases passed ({gate_cases})')
finally:
    server.shutdown()
    server.server_close()

# Connection failures must prevent preflight, HEAD validation and CI gating.
for local_script, env in [(script, {**os.environ, 'IMAGE': 'ghcr.io/sknetworks-family-aicamp/storyfork-web'}), (head_script, head_env)]:
    result = subprocess.run([sys.executable, '-I', '-c', local_script], env=env, capture_output=True, text=True)
    assert result.returncode != 0 and 'test-secret' not in result.stdout + result.stderr
check_gate('CI API connection failed')
print('Preflight, branch lookup and CI API connection failure cases passed')
