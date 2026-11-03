#!/usr/bin/env python3
"""Offline CD regressions; stdlib, scratch and Compose config only, no server/daemon."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('deploy', ROOT / 'infrastructure/scripts/deploy-develop.py')
cd = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cd)
SHA = 'a' * 40
TOKEN = 'synthetic-token-not-a-credential'
REPOSITORY = 'SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM'
DEFAULT_SHA = 'b' * 40
CONTEXT = {'repository': REPOSITORY, 'branch': 'develop', 'sha': SHA,
           'ci_run_id': 123, 'ci_run_attempt': 2, 'images_run_id': 456, 'images_run_attempt': 3}
NAMES = ['Verify successful CI', 'Publish web image', 'Publish core-api image', 'Publish ai-service image']


def evidence():
    common = {'repository': {'full_name': REPOSITORY}, 'head_repository': {'full_name': REPOSITORY},
              'status': 'completed', 'conclusion': 'success'}
    ci_run = {**common, 'event': 'push', 'head_branch': 'develop', 'head_sha': SHA, 'id': 123,
              'run_attempt': 2, 'path': '.github/workflows/ci.yml', 'name': 'CI', 'workflow_id': 7}
    images = {**common, 'event': 'workflow_run', 'head_branch': 'main', 'head_sha': DEFAULT_SHA,
              'id': 456, 'run_attempt': 3, 'path': '.github/workflows/publish-images.yml',
              'name': 'Images', 'workflow_id': 8}
    return {
        '/actions/workflows/ci.yml': {'id': 7, 'name': 'CI', 'path': ci_run['path'], 'state': 'active'},
        '/actions/workflows/publish-images.yml': {'id': 8, 'name': 'Images', 'path': images['path'], 'state': 'active'},
        '/actions/runs/123': ci_run,
        '/actions/runs/123/attempts/2/jobs': {'total_count': 1, 'jobs': [
            {'name': 'Required CI', 'status': 'completed', 'conclusion': 'success',
             'head_sha': SHA, 'run_id': 123, 'run_attempt': 2}]},
        '/actions/runs/456': images,
        '/actions/runs/456/attempts/3': copy.deepcopy(images),
        '/actions/runs/456/attempts/3/jobs': {'total_count': 4, 'jobs': [
            {'name': name, 'status': 'completed', 'conclusion': 'success',
             'head_sha': DEFAULT_SHA, 'run_id': 456, 'run_attempt': 3} for name in NAMES]},
        '/git/ref/heads/develop': {'ref': 'refs/heads/develop', 'object': {'sha': SHA}},
        '/actions/runs/456/artifacts': {'total_count': 1, 'artifacts': [
            {'id': 777, 'name': 'publication-source-456-3', 'expired': False, 'size_in_bytes': 512,
             'workflow_run': {'id': 456, 'head_sha': DEFAULT_SHA}}]},
    }


def archive(entries=None):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as output:
        for name, body in (entries or [('publication-source.json', json.dumps(CONTEXT))]):
            output.writestr(name, body)
    return stream.getvalue()


def respond(data):
    return lambda path, token: copy.deepcopy(data[path.split('?', 1)[0]])


class DeployTests(unittest.TestCase):
    def test_resolve_auto_default_main_context_and_explicit_manual_reuse(self):
        data = evidence()
        event = {'repository': {'full_name': REPOSITORY, 'default_branch': 'main'},
                 'workflow_run': data['/actions/runs/456']}
        with patch.object(cd, 'api', side_effect=respond(data)), \
                patch.object(cd, 'download_artifact', return_value=archive()) as download:
            auto = cd.resolve('workflow_run', event, 'refs/heads/main', '', TOKEN)
            manual = cd.resolve('workflow_dispatch', event, 'refs/heads/main', '456', TOKEN)
            self.assertEqual(auto, CONTEXT)
            self.assertEqual(manual, auto)
            cd.verify(auto, TOKEN)
            self.assertTrue(all(call.args == (777, TOKEN) for call in download.call_args_list))
        # An independent manual Images run carries its own develop ref/SHA, unlike workflow_run.
        for route in ('/actions/runs/456', '/actions/runs/456/attempts/3'):
            data[route].update(event='workflow_dispatch', head_branch='develop', head_sha=SHA)
        for job in data['/actions/runs/456/attempts/3/jobs']['jobs']: job['head_sha'] = SHA
        with patch.object(cd, 'api', side_effect=respond(data)):
            cd.verify(CONTEXT, TOKEN)

    def test_exact_ci_and_images_attempt_and_all_publish_evidence(self):
        data = evidence()
        with patch.object(cd, 'api', side_effect=respond(data)) as api:
            cd.verify(CONTEXT, TOKEN)
            paths = [call.args[0] for call in api.call_args_list]
            self.assertTrue(any('/456/attempts/3/jobs' in path for path in paths))
            self.assertTrue(any('/123/attempts/2/jobs' in path for path in paths))
        for key, value in [('branch', 'main'), ('sha', 'bad'), ('repository', 'attacker/fork'),
                           ('ci_run_id', True), ('images_run_attempt', 0), ('extra', 'unexpected')]:
            with self.subTest(key=key, value=value), patch.object(cd, 'api') as api:
                with self.assertRaises(ValueError): cd.verify({**CONTEXT, key: value}, TOKEN)
                api.assert_not_called()
        cases = []
        for route in ('/actions/runs/123/attempts/2/jobs', '/actions/runs/456/attempts/3/jobs'):
            for index in range(len(data[route]['jobs'])):
                for key, value in [('conclusion', 'failure'), ('conclusion', 'cancelled'),
                                   ('conclusion', 'skipped'), ('conclusion', None), ('status', 'in_progress'),
                                   ('run_attempt', 1), ('head_sha', 'c' * 40), ('run_id', 999)]:
                    changed = evidence()
                    changed[route]['jobs'][index][key] = value
                    cases.append(changed)
            for mutation in ('missing', 'duplicate', 'truncated'):
                changed = evidence()
                if mutation == 'missing': changed[route]['jobs'].pop()
                if mutation == 'duplicate': changed[route]['jobs'].append(changed[route]['jobs'][0])
                if mutation == 'truncated': changed[route]['total_count'] = 101
                cases.append(changed)
        for route in ('/actions/runs/123', '/actions/runs/456', '/actions/runs/456/attempts/3'):
            for key, value in [('event', 'pull_request'), ('head_sha', 'bad'), ('id', 999),
                               ('run_attempt', 1), ('path', '.github/workflows/other.yml'),
                               ('name', 'Other'), ('workflow_id', 99), ('conclusion', 'failure'),
                               ('conclusion', 'cancelled'), ('status', 'in_progress'),
                               ('head_repository', {'full_name': 'attacker/fork'}),
                               ('repository', {'full_name': 'attacker/fork'})]:
                changed = evidence()
                changed[route][key] = value
                cases.append(changed)
        changed = evidence()
        changed['/git/ref/heads/develop']['object']['sha'] = 'c' * 40
        cases.append(changed)
        for route in ('/actions/workflows/ci.yml', '/actions/workflows/publish-images.yml'):
            changed = evidence()
            changed[route]['state'] = 'disabled_manually'
            cases.append(changed)
        for changed in cases:
            with self.subTest(data=changed), patch.object(cd, 'api', side_effect=respond(changed)):
                with self.assertRaises(ValueError): cd.verify(CONTEXT, TOKEN)
        # Partial service CI is fine: Required CI succeeded, publishers are in an independent run.
        data = evidence()
        data['/actions/runs/123/attempts/2/jobs']['jobs'].append({'name': 'Web', 'conclusion': 'skipped'})
        data['/actions/runs/123/attempts/2/jobs']['total_count'] += 1
        with patch.object(cd, 'api', side_effect=respond(data)): cd.verify(CONTEXT, TOKEN)
        # An optional job run_attempt may be absent; the exact-attempt API still binds it.
        data = evidence()
        for job in data['/actions/runs/456/attempts/3/jobs']['jobs']: del job['run_attempt']
        with patch.object(cd, 'api', side_effect=respond(data)): cd.verify(CONTEXT, TOKEN)
        with patch.object(cd, 'api', side_effect=OSError('offline')):
            with self.assertRaises(OSError): cd.verify(CONTEXT, TOKEN)

    def test_untrusted_triggers_and_source_handoff_fail_closed(self):
        data = evidence()
        event = {'repository': {'full_name': REPOSITORY, 'default_branch': 'main'},
                 'workflow_run': data['/actions/runs/456']}
        cases = [('pull_request', event, 'refs/heads/main', ''),
                 ('workflow_dispatch', event, 'refs/heads/develop', '456')]
        for run_id in ('', '0', '-1', 'true', '456/attempts/1', '4\n56'):
            cases.append(('workflow_dispatch', event, 'refs/heads/main', run_id))
        for key, value in [('event', 'pull_request'), ('conclusion', 'failure'),
                           ('conclusion', 'cancelled'), ('run_attempt', 1), ('head_sha', SHA),
                           ('head_repository', {'full_name': 'attacker/fork'})]:
            changed = copy.deepcopy(event)
            changed['workflow_run'][key] = value
            cases.append(('workflow_run', changed, 'refs/heads/main', ''))
        for args in cases:
            with self.subTest(args=args), patch.object(cd, 'api', side_effect=respond(data)), \
                    patch.object(cd, 'download_artifact', return_value=archive()):
                with self.assertRaises(ValueError): cd.resolve(*args, TOKEN)
        archives = [b'not a zip', archive([('../publication-source.json', '{}')]),
                    archive([('publication-source.json', '{}'), ('other', 'untrusted')]),
                    archive([('publication-source.json', 'x' * 4097)]),
                    archive([('publication-source.json', 'bad json')]),
                    archive([('publication-source.json', '[]')]),
                    archive([('publication-source.json', json.dumps(CONTEXT)[:-1] + ',"sha":"' + SHA + '"}')]),
                    b'x' * 16385]
        for key, value in [('repository', 'attacker/fork'), ('branch', 'main'), ('sha', 'bad'),
                           ('ci_run_id', True), ('ci_run_attempt', 1), ('images_run_id', 789),
                           ('images_run_attempt', 1), ('extra', 'untrusted')]:
            archives.append(archive([('publication-source.json', json.dumps({**CONTEXT, key: value}))]))
        for body in archives:
            with self.subTest(body=body[:60]), patch.object(cd, 'api', side_effect=respond(data)), \
                    patch.object(cd, 'download_artifact', return_value=body):
                with self.assertRaises((ValueError, zipfile.BadZipFile)):
                    source = cd.resolve('workflow_run', event, 'refs/heads/main', '', TOKEN)
                    cd.verify(source, TOKEN)
        for mutation in ('missing', 'duplicate', 'expired', 'oversized', 'wrong-run', 'wrong-sha', 'old-attempt'):
            changed = evidence()
            listing = changed['/actions/runs/456/artifacts']
            artifact = listing['artifacts'][0]
            if mutation == 'missing': listing.update(total_count=0, artifacts=[])
            if mutation == 'duplicate': listing.update(total_count=2, artifacts=[artifact, artifact])
            if mutation == 'expired': artifact['expired'] = True
            if mutation == 'oversized': artifact['size_in_bytes'] = 16385
            if mutation == 'wrong-run': artifact['workflow_run']['id'] = 999
            if mutation == 'wrong-sha': artifact['workflow_run']['head_sha'] = SHA
            if mutation == 'old-attempt': artifact['name'] = 'publication-source-456-2'
            with self.subTest(mutation=mutation), patch.object(cd, 'api', side_effect=respond(changed)), \
                    patch.object(cd, 'download_artifact', return_value=archive()):
                with self.assertRaises(ValueError): cd.resolve('workflow_run', event, 'refs/heads/main', '', TOKEN)
        for route in evidence():
            with self.subTest(route=route):
                def fail(path, token):
                    if path.split('?', 1)[0] == route: raise OSError('API failed')
                    return respond(data)(path, token)
                with patch.object(cd, 'api', side_effect=fail), patch.object(cd, 'download_artifact', return_value=archive()):
                    with self.assertRaises(OSError):
                        source = cd.resolve('workflow_run', event, 'refs/heads/main', '', TOKEN)
                        cd.verify(source, TOKEN)

    def test_artifact_download_is_bounded_and_redirects_drop_auth(self):
        response = io.BytesIO(b'x' * 16385)
        response.status = 200
        with patch.object(cd.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = response
            with self.assertRaises(ValueError): cd.download_artifact(777, TOKEN)
        request = cd.urllib.request.Request('https://api.github.com/artifact', headers={'Authorization': 'Bearer ' + TOKEN})
        redirect = cd.ArtifactRedirect().redirect_request(request, None, 302, 'Found', {}, 'https://blob.example/signed')
        self.assertNotIn('Authorization', redirect.headers)
        with self.assertRaises(ValueError):
            cd.ArtifactRedirect().redirect_request(request, None, 302, 'Found', {}, 'http://blob.example/signed')

    def provision(self, directory):
        root = Path(directory).resolve()
        root.chmod(0o700)
        (root / '.env').write_text('OPENAI_API_KEY=server-only-synthetic-value\n')
        (root / '.storyfork-cd.json').write_text(json.dumps({
            'repository': CONTEXT['repository'], 'project': 'storyfork-develop-cd',
            'web_port': 28088}))
        (root / '.storyfork-cd.lock').touch()
        for p in root.iterdir(): p.chmod(0o600)
        return {'context': CONTEXT, 'token': TOKEN, 'actor': 'ci-user',
                'directory': str(root), 'port': 28088,
                'compose': (ROOT / 'infrastructure/compose.cd.yaml').read_text()}

    def test_remote_pull_gate_health_and_isolation(self):
        with tempfile.TemporaryDirectory(prefix='storyfork-cd-test-') as directory:
            payload = self.provision(directory)
            original = {p.name: p.read_bytes() for p in Path(directory).iterdir()}
            for failure in ('none', 'pull-web', 'pull-core-api', 'pull-ai-service', 'image-sha', 'foreign-project', 'stale', 'up', 'health'):
                calls = []
                docker_configs = []
                def run(args, **kwargs):
                    calls.append(args)
                    self.assertNotIn(TOKEN, ' '.join(args))
                    self.assertNotIn('server-only-synthetic-value', ' '.join(args))
                    if args[0] == 'docker':
                        docker_configs.append(Path(args[2]))
                        self.assertEqual(json.loads((Path(args[2]) / 'config.json').read_text())['auths'].keys(), {'ghcr.io'})
                    if 'ls' in args:
                        return 'foreign' if failure == 'foreign-project' else ''
                    if 'inspect' in args:
                        if 'image' not in args: return '[{"Config": {"Labels": {}}, "Labels": {}}]'
                        ref = args[-1]
                        return json.dumps([{'Id': 'sha256:' + 'c' * 64,
                            'RepoDigests': [ref.split(':sha-')[0] + '@sha256:' + 'd' * 64],
                            'Config': {'Labels': {'org.opencontainers.image.revision': 'wrong' if failure == 'image-sha' else SHA,
                                'org.opencontainers.image.source': 'https://github.com/' + CONTEXT['repository']}}}])
                    if 'pull' in args and failure.startswith('pull-') and args[-1] == cd.IMAGES[failure[5:]] + ':sha-' + SHA:
                        raise subprocess.CalledProcessError(1, args, stderr=TOKEN)
                    if 'up' in args:
                        self.assertEqual(sum('pull' in c for c in calls), 3)
                        self.assertIn('--no-build', args)
                        self.assertIn('--pull', args)
                        self.assertEqual(args[args.index('--pull') + 1], 'never')
                        self.assertNotIn('--remove-orphans', args)
                        if failure == 'up': raise subprocess.CalledProcessError(1, args)
                    return ''
                def verify(*args):
                    self.assertEqual(sum('pull' in c for c in calls), 3)
                    self.assertFalse(any('up' in c for c in calls))
                    if failure == 'stale': raise ValueError('stale')
                with self.subTest(failure=failure), patch.object(cd, 'run', side_effect=run), \
                        patch.object(cd, 'verify', side_effect=verify), \
                        patch.object(cd, 'wait_healthy', side_effect=ValueError('health') if failure == 'health' else None), \
                        patch('sys.stdout', new_callable=io.StringIO) as output:
                    if failure == 'none':
                        cd.remote(payload)
                        report = json.loads(output.getvalue())
                        self.assertEqual(report['sha'], SHA)
                        self.assertEqual(len(report['images']), 3)
                    else:
                        with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                            cd.remote(payload)
                        self.assertEqual(output.getvalue(), '')
                    if failure.startswith('pull-') or failure in ('image-sha', 'foreign-project', 'stale'):
                        self.assertFalse(any('up' in c for c in calls))
                    self.assertTrue(all(not p.exists() for p in docker_configs))
                    self.assertFalse(any('down' in c or 'rm' in c or '--volumes' in c for c in calls))
            self.assertEqual(original, {p.name: p.read_bytes() for p in Path(directory).iterdir()})
            (Path(directory) / '.storyfork-cd.json').unlink()
            with patch.object(cd, 'run') as run:
                with self.assertRaises((ValueError, OSError)): cd.remote(payload)
                run.assert_not_called()

    def test_health_requires_three_running_images_and_real_http(self):
        images = {name: {'id': 'sha256:' + 'c' * 64} for name in cd.SERVICES}
        containers = [{'Image': image['id'], 'State': {'Status': 'running'},
                       'Config': {'Labels': {'com.docker.compose.service': name,
                                            'io.storyfork.cd.sha': SHA}}}
                      for name, image in images.items()]
        for failure in ('none', 'missing', 'wrong-image', 'exited', 'stale-label', 'bad-http'):
            state = copy.deepcopy(containers)
            if failure == 'missing': state.pop()
            if failure == 'wrong-image': state[0]['Image'] = 'wrong'
            if failure == 'exited': state[0]['State']['Status'] = 'exited'
            if failure == 'stale-label': state[0]['Config']['Labels']['io.storyfork.cd.sha'] = 'old'
            with self.subTest(failure=failure), patch.object(cd, 'run', side_effect=['id1 id2 id3', json.dumps(state)]), \
                    patch.object(cd, 'http_health', return_value=failure != 'bad-http'), \
                    patch.object(cd.time, 'monotonic', side_effect=[0, 1, 181]), patch.object(cd.time, 'sleep'):
                if failure == 'none': cd.wait_healthy(['docker'], ['compose'], {}, images, SHA, 28088)
                else:
                    with self.assertRaises(ValueError):
                        cd.wait_healthy(['docker'], ['compose'], {}, images, SHA, 28088)

    def test_ssh_failure_is_fail_closed_and_strict(self):
        with tempfile.TemporaryDirectory(prefix='storyfork-ssh-test-') as directory:
            fake = Path(directory) / 'ssh'
            fake.write_text('#!/bin/sh\nexit 19\n')
            fake.chmod(0o700)
            env = {'PATH': directory + os.pathsep + os.environ['PATH'],
                   'CD_DEPLOY_DIR': '/operator/provisioned', 'CD_WEB_PORT': '28088',
                   'CD_SSH_PRIVATE_KEY': 'synthetic-key', 'CD_SSH_KNOWN_HOSTS': 'synthetic-host-key',
                   'GITHUB_ACTOR': 'ci-user'}
            actual_run = cd.run
            calls = []
            def record(args, **kwargs):
                calls.append(args)
                if args[0] == 'ssh-keygen':
                    self.assertEqual(args[1:3], ['-F', '[100.90.8.124]:5798'])
                    return 'verified test fixture'
                return actual_run(args, **kwargs)
            with patch.dict(os.environ, env, clear=True), patch.object(cd, 'run', side_effect=record), \
                    patch.object(cd.subprocess, 'run', wraps=subprocess.run) as child, \
                    patch('sys.stdout', new_callable=io.StringIO) as output:
                with self.assertRaises(subprocess.CalledProcessError): cd.connect(CONTEXT, TOKEN)
                self.assertEqual(output.getvalue(), '')
            # SSH must allow three individual 300-second pulls and the 180-second health check.
            self.assertGreaterEqual(child.call_args.kwargs['timeout'], 3 * 300 + 180)
            ssh = calls[-1]
            self.assertIn('StrictHostKeyChecking=yes', ssh)
            self.assertIn('GlobalKnownHostsFile=/dev/null', ssh)
            self.assertIn('BatchMode=yes', ssh)
            self.assertIn('PasswordAuthentication=no', ssh)
            self.assertIn('5798', ssh)
            self.assertIn('tgv99536@100.90.8.124', ssh)
            self.assertNotIn(TOKEN, ' '.join(ssh))
            self.assertFalse(Path(ssh[ssh.index('-i') + 1]).exists())
            # The remote command carries the trusted shared gate, not a server-side file dependency.
            command = cd.shlex.split(ssh[-1])
            self.assertEqual(command[:3], ['python3', '-I', '-c'])
            namespace = {'__name__': 'trusted_remote'}
            exec(compile(command[3], '<trusted-ssh-script>', 'exec'), namespace)
            namespace['api'] = respond(evidence())
            namespace['verify'](CONTEXT, TOKEN)

    def test_http_health_contract(self):
        bodies = [b'<div id="root">', b'{"status":"up","service":"storyfork-core-api"}',
                  b'{"status":"up","service":"storyfork-ai-service"}']
        for index, replacement in [(None, None), (0, b'not our app'), (1, b'bad json'),
                                   (1, b'{"status":"down","service":"storyfork-core-api"}'),
                                   (2, b'{"status":"up","service":"wrong-service"}')]:
            responses = []
            for i, body in enumerate(bodies):
                response = io.BytesIO(replacement if i == index else body)
                response.status = 200
                responses.append(response)
            with self.subTest(index=index, replacement=replacement), \
                    patch.object(cd.urllib.request, 'build_opener') as opener:
                opener.return_value.open.side_effect = responses
                self.assertEqual(cd.http_health(28088), index is None)

    def test_image_only_compose_config(self):
        env = {key: value for key, value in os.environ.items() if key in ('PATH', 'HOME', 'DOCKER_CONFIG')}
        env.update(CD_SOURCE_SHA=SHA, CD_DIRECTORY='/operator/provisioned', CD_WEB_PORT='28088',
                   OPENAI_API_KEY='configuration-only-synthetic-value')
        for name, image in cd.IMAGES.items():
            env['CD_' + name.upper().replace('-', '_') + '_IMAGE'] = image + '@sha256:' + 'd' * 64
        args = ['docker', 'compose', '--env-file', '/dev/null', '--file',
                str(ROOT / 'infrastructure/compose.cd.yaml'), 'config', '--format', 'json']
        result = subprocess.run(args, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, 'CD Compose must render without a daemon or build')
        model = json.loads(result.stdout)
        self.assertEqual(model['name'], cd.PROJECT)
        self.assertEqual(set(model['services']), set(cd.SERVICES))
        for name, service in model['services'].items():
            self.assertEqual(service['image'], cd.IMAGES[name] + '@sha256:' + 'd' * 64)
            self.assertFalse(any(service.get(key) for key in ('build', 'volumes', 'env_file', 'container_name')))
            self.assertEqual(service['labels']['io.storyfork.cd.sha'], SHA)
            self.assertEqual('OPENAI_API_KEY' in service.get('environment', {}), name == 'ai-service')
            if name == 'web':
                self.assertEqual(service['ports'][0]['host_ip'], '127.0.0.1')
                self.assertEqual(str(service['ports'][0]['published']), '28088')
            else: self.assertFalse(service.get('ports'))
        del env['CD_WEB_PORT']
        self.assertNotEqual(subprocess.run(args, env=env, capture_output=True).returncode, 0)

    def test_workflow_gate_and_pinning(self):
        ci = (ROOT / '.github/workflows/ci.yml').read_text()
        workflow = (ROOT / '.github/workflows/deploy-develop.yml').read_text()
        for text in ['name: Deploy', 'workflows: [Images]', 'types: [completed]',
                     'workflow_dispatch:', 'images_run_id:', 'required: true',
                     "vars.DEVELOP_CD_ENABLED == 'true'", "github.event.workflow_run.conclusion == 'success'",
                     'github.event.workflow_run.head_repository.full_name == github.repository',
                     'packages: read', 'actions: read', 'id-token: write', 'environment: develop-cd',
                     'tailscale/github-action@064b10558093f38325e838ddea35486bdc6b1d5c',
                     'oauth-client-id:', 'audience:', 'tags: tag:storyfork-cd',
                     'group: storyfork-develop-cd', 'cancel-in-progress: false',
                     'ref: ${{ github.event.repository.default_branch }}',
                     'IMAGES_RUN_ID: ${{ inputs.images_run_id }}']:
            self.assertIn(text, workflow)
        self.assertNotIn('branches:', workflow)
        self.assertNotIn('packages: write', workflow)
        self.assertNotIn('needs:', workflow)
        self.assertNotIn('  deploy:', ci)
        self.assertNotIn('  publish:', ci)
        self.assertIn('test-deploy-develop.py', ci.split('\n  required:', 1)[0])
        self.assertLess(workflow.index('deploy-develop.py check'), workflow.index('tailscale/github-action@'))
        self.assertLess(workflow.index('tailscale/github-action@'), workflow.index('deploy-develop.py deploy'))
        for action in cd.re.findall(r'uses: (\S+)', workflow):
            self.assertRegex(action, r'^[^@]+@[0-9a-f]{40}$')


if __name__ == '__main__':
    unittest.main()
