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

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('deploy', ROOT / 'infrastructure/scripts/deploy-develop.py')
cd = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cd)
SHA = 'a' * 40
TOKEN = 'synthetic-token-not-a-credential'
CONTEXT = {'repository': 'SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM', 'event': 'push',
           'ref': 'refs/heads/develop', 'sha': SHA, 'run_id': 123, 'attempt': 2}
NAMES = ['Required CI', 'Publish web image', 'Publish core-api image', 'Publish ai-service image']


def evidence():
    return [
        {'event': 'push', 'head_branch': 'develop', 'head_sha': SHA, 'id': 123,
         'run_attempt': 2, 'path': '.github/workflows/ci.yml',
         'repository': {'full_name': CONTEXT['repository']},
         'head_repository': {'full_name': CONTEXT['repository']}},
        {'total_count': 4, 'jobs': [
            {'name': name, 'status': 'completed', 'conclusion': 'success',
             'head_sha': SHA, 'run_id': 123} for name in NAMES]},
        {'object': {'sha': SHA}},
    ]


class DeployTests(unittest.TestCase):
    def test_exact_push_attempt_and_all_publish_evidence(self):
        with patch.object(cd, 'api', side_effect=evidence()) as api:
            cd.verify(CONTEXT, TOKEN)
            self.assertIn('/attempts/2/jobs', api.call_args_list[1].args[0])
        for key, value in [('event', 'pull_request'), ('event', 'workflow_dispatch'),
                           ('ref', 'refs/heads/main'), ('sha', 'bad'),
                           ('repository', 'attacker/fork')]:
            with self.subTest(key=key, value=value), patch.object(cd, 'api') as api:
                with self.assertRaises(ValueError):
                    cd.verify({**CONTEXT, key: value}, TOKEN)
                api.assert_not_called()
        cases = []
        for index in range(4):
            for result in ('failure', 'cancelled', 'skipped', None):
                data = evidence()
                data[1]['jobs'][index]['conclusion'] = result
                cases.append(data)
        for key, value in [('event', 'workflow_run'), ('head_sha', 'b' * 40),
                           ('run_attempt', 1), ('head_branch', 'main'),
                           ('head_repository', {'full_name': 'attacker/fork'})]:
            data = evidence()
            data[0][key] = value
            cases.append(data)
        for mutation in ('missing', 'duplicate', 'truncated', 'wrong-job-sha', 'wrong-run', 'stale-head'):
            data = evidence()
            if mutation == 'missing': data[1]['jobs'].pop()
            if mutation == 'duplicate': data[1]['jobs'].append(data[1]['jobs'][0])
            if mutation == 'truncated': data[1]['total_count'] = 101
            if mutation == 'wrong-job-sha': data[1]['jobs'][1]['head_sha'] = 'b' * 40
            if mutation == 'wrong-run': data[1]['jobs'][1]['run_id'] = 124
            if mutation == 'stale-head': data[2]['object']['sha'] = 'b' * 40
            cases.append(data)
        for data in cases:
            with self.subTest(data=data), patch.object(cd, 'api', side_effect=data):
                with self.assertRaises(ValueError):
                    cd.verify(CONTEXT, TOKEN)
        with patch.object(cd, 'api', side_effect=OSError('offline')):
            with self.assertRaises(OSError): cd.verify(CONTEXT, TOKEN)

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
                if args[0] == 'ssh-keygen': return 'verified test fixture'
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
            self.assertIn('tgv99536@100.105.27.82', ssh)
            self.assertNotIn(TOKEN, ' '.join(ssh))
            self.assertFalse(Path(ssh[ssh.index('-i') + 1]).exists())

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
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        deploy = workflow.split('\n  deploy:', 1)[1]
        self.assertIn('needs: [required, publish]', deploy)
        for text in ["github.event_name == 'push'", "github.ref == 'refs/heads/develop'",
                     "needs.publish.result == 'success'", "vars.DEVELOP_CD_ENABLED == 'true'",
                     'packages: read', 'actions: read', 'id-token: write', 'environment: develop-cd',
                     'tailscale/github-action@064b10558093f38325e838ddea35486bdc6b1d5c',
                     'oauth-client-id:', 'audience:', 'tags: tag:storyfork-cd']:
            self.assertIn(text, deploy)
        self.assertNotIn('workflow_run:', workflow)
        self.assertIn("cancel-in-progress: ${{ github.ref != 'refs/heads/develop' }}", workflow)
        self.assertIn('test-deploy-develop.py', workflow.split('\n  required:', 1)[0])


if __name__ == '__main__':
    unittest.main()
