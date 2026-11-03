#!/usr/bin/env python3
"""Opt-in develop CD. No remote files are installed or existing configuration changed."""
import base64
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

REPOSITORY = 'SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM'
PROJECT = 'storyfork-develop-cd'
SERVICES = ('web', 'core-api', 'ai-service')
IMAGES = {name: 'ghcr.io/sknetworks-family-aicamp/storyfork-' + name for name in SERVICES}


def run(args, timeout=300, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, check=True,
                          timeout=timeout, **kwargs).stdout


def api(path, token):
    request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + path,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def verify(context, token):
    if (context['repository'] != REPOSITORY or context['event'] != 'push'
            or context['ref'] != 'refs/heads/develop'
            or not re.fullmatch('[0-9a-f]{40}', context['sha'])
            or type(context['run_id']) is not int or context['run_id'] < 1
            or type(context['attempt']) is not int or context['attempt'] < 1 or not token):
        raise ValueError('Not a trusted develop push')
    path = f"/actions/runs/{context['run_id']}/attempts/{context['attempt']}"
    source = api(path, token)
    if (source['id'] != context['run_id'] or source['run_attempt'] != context['attempt']
            or source['head_sha'] != context['sha'] or source['event'] != 'push'
            or source['head_branch'] != 'develop' or source['path'] != '.github/workflows/ci.yml'
            or source['repository']['full_name'] != REPOSITORY
            or source['head_repository']['full_name'] != REPOSITORY):
        raise ValueError('Run provenance mismatch')
    evidence = api(path + '/jobs?per_page=100', token)
    jobs = evidence['jobs']
    if len(jobs) != evidence['total_count'] or len(jobs) > 100:
        raise ValueError('Incomplete job evidence')
    for name in ('Required CI', *(f'Publish {service} image' for service in SERVICES)):
        matches = [job for job in jobs if job['name'] == name]
        if len(matches) != 1 or any(
                job['status'] != 'completed' or job['conclusion'] != 'success'
                or job['head_sha'] != context['sha'] or job['run_id'] != context['run_id']
                for job in matches):
            raise ValueError('Required CI or a publish job did not succeed in this attempt')
    if api('/git/ref/heads/develop', token)['object']['sha'] != context['sha']:
        raise ValueError('Develop HEAD changed')


def secure_file(path, directory=False):
    mode = path.lstat()
    if (path.is_symlink() or mode.st_uid != os.geteuid()
            or mode.st_mode & 0o077 or not (stat.S_ISDIR(mode.st_mode) if directory else stat.S_ISREG(mode.st_mode))):
        raise ValueError('Deployment files must be private, owned, and not symlinks')


def owned_resources(docker, env, directory):
    for kind in ('container', 'network', 'volume'):
        args = [*docker, kind, 'ls', '--quiet', '--filter', 'label=com.docker.compose.project=' + PROJECT]
        if kind == 'container': args.append('--all')
        ids = run(args, env=env).split()
        if not ids: continue
        if kind == 'volume': raise ValueError('Unexpected volumes in CD project')
        for resource in json.loads(run([*docker, kind, 'inspect', *ids], env=env)):
            labels = (resource['Config'] if kind == 'container' else resource).get('Labels') or {}
            if (labels.get('io.storyfork.cd.repository') != REPOSITORY
                    or labels.get('io.storyfork.cd.directory') != directory
                    or (kind == 'container' and labels.get('com.docker.compose.service') not in SERVICES)
                    or (kind == 'network' and labels.get('com.docker.compose.network') != 'default')):
                raise ValueError('Refusing resources not owned by this CD deployment')


def http_health(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        for path, service in (('/', None), ('/api/v1/health', 'storyfork-core-api'),
                              ('/api/v1/health/ai-service', 'storyfork-ai-service')):
            with opener.open(f'http://127.0.0.1:{port}{path}', timeout=5) as response:
                body = response.read(1024 * 1024)
                if response.status != 200: return False
            if service is None:
                if b'<div id="root">' not in body: return False
            else:
                data = json.loads(body)
                if data.get('status') != 'up' or data.get('service') != service: return False
        return True
    except (OSError, ValueError, AttributeError):
        return False


def wait_healthy(docker, compose, env, images, sha, port, manifest=None):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        ids = run([*compose, 'ps', '--all', '--quiet'], env=env, input=manifest).split()
        if len(ids) != len(SERVICES): raise ValueError('Incomplete deployment')
        containers = json.loads(run([*docker, 'container', 'inspect', *ids], env=env))
        seen = set()
        ready = True
        for container in containers:
            labels = container['Config']['Labels']
            service = labels['com.docker.compose.service']
            if (service not in images or service in seen or container['Image'] != images[service]['id']
                    or labels.get('io.storyfork.cd.sha') != sha):
                raise ValueError('Container image/source mismatch')
            seen.add(service)
            status = container['State']['Status']
            if status in ('dead', 'exited'): raise ValueError('Container failed')
            ready = ready and status == 'running'
        if seen == set(SERVICES) and ready and http_health(port): return
        time.sleep(2)
    raise ValueError('Deployment health timed out')


def remote(payload):
    directory = Path(payload['directory'])
    port = payload['port']
    if (not directory.is_absolute() or directory.resolve(strict=True) != directory
            or type(port) is not int or not 1024 <= port <= 65535):
        raise ValueError('Explicit canonical directory and unprivileged port required')
    secure_file(directory, directory=True)
    for name in ('.env', '.storyfork-cd.json', '.storyfork-cd.lock'):
        secure_file(directory / name)
    approval = json.loads((directory / '.storyfork-cd.json').read_text())
    if approval != {'repository': REPOSITORY, 'project': PROJECT, 'web_port': port}:
        raise ValueError('Server provisioning does not match requested deployment')
    with (directory / '.storyfork-cd.lock').open('r+') as lock, \
            tempfile.TemporaryDirectory(prefix='storyfork-cd-') as scratch:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        config = Path(scratch) / 'config.json'
        config.touch(mode=0o600)
        auth = base64.b64encode((payload['actor'] + ':' + payload['token']).encode()).decode()
        config.write_text(json.dumps({'auths': {'ghcr.io': {'auth': auth}}}))
        # No docker login/credential helper or inherited context; credentials die with scratch.
        docker = ['docker', '--config', scratch]
        env = {key: value for key, value in os.environ.items() if key in ('PATH', 'HOME', 'LANG')}
        env.update(DOCKER_HOST='unix:///var/run/docker.sock', CD_SOURCE_SHA=payload['context']['sha'],
                   CD_DIRECTORY=str(directory), CD_WEB_PORT=str(port))
        owned_resources(docker, env, str(directory))
        images = {}
        for service, repository in IMAGES.items():
            ref = repository + ':sha-' + payload['context']['sha']
            run([*docker, 'pull', '--platform', 'linux/amd64', ref], env=env)
            image, = json.loads(run([*docker, 'image', 'inspect', ref], env=env))
            labels = image['Config']['Labels']
            digests = [digest for digest in image['RepoDigests']
                       if re.fullmatch(re.escape(repository) + '@sha256:[0-9a-f]{64}', digest)]
            if (len(digests) != 1 or labels.get('org.opencontainers.image.revision') != payload['context']['sha']
                    or labels.get('org.opencontainers.image.source') != 'https://github.com/' + REPOSITORY):
                raise ValueError('Pulled image provenance mismatch')
            images[service] = {'id': image['Id'], 'digest': digests[0]}
            env['CD_' + service.upper().replace('-', '_') + '_IMAGE'] = digests[0]
        compose = [*docker, 'compose', '--project-name', PROJECT, '--project-directory', str(directory),
                   '--env-file', str(directory / '.env'), '--file', '-']
        manifest = payload['compose']
        run([*compose, 'config', '--quiet'], env=env, input=manifest)
        # Recheck after all pulls, under the server lock, immediately before container mutation.
        verify(payload['context'], payload['token'])
        run([*compose, 'up', '--detach', '--no-build', '--pull', 'never'], env=env, input=manifest)
        wait_healthy(docker, compose, env, images, payload['context']['sha'], port, manifest)
        print(json.dumps({'sha': payload['context']['sha'], 'project': PROJECT,
                          'images': {name: image['digest'] for name, image in images.items()}}))


def settings():
    directory = os.environ['CD_DEPLOY_DIR']
    port = int(os.environ['CD_WEB_PORT'])
    if (not directory.startswith('/') or '\n' in directory or not 1024 <= port <= 65535
            or not os.environ['CD_SSH_PRIVATE_KEY'].strip()
            or not os.environ['CD_SSH_KNOWN_HOSTS'].strip()):
        raise ValueError('Explicit deployment and SSH provisioning required')
    return directory, port


def connect(context, token):
    directory, port = settings()
    with tempfile.TemporaryDirectory(prefix='storyfork-ssh-') as scratch:
        key, hosts = (Path(scratch) / name for name in ('key', 'known_hosts'))
        for file, value in ((key, os.environ['CD_SSH_PRIVATE_KEY']), (hosts, os.environ['CD_SSH_KNOWN_HOSTS'])):
            file.touch(mode=0o600)
            file.write_text(value.rstrip() + '\n')
        if not run(['ssh-keygen', '-F', '[100.105.27.82]:5798', '-f', str(hosts)]).strip():
            raise ValueError('Verified non-default-port host key required')
        script = Path(__file__).read_text()
        payload = {'context': context, 'token': token, 'actor': os.environ['GITHUB_ACTOR'],
                   'directory': directory, 'port': port,
                   'compose': (Path(__file__).resolve().parents[1] / 'compose.cd.yaml').read_text()}
        result = run(['ssh', '-F', '/dev/null', '-T', '-p', '5798', '-i', str(key),
            '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + str(hosts),
            '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'BatchMode=yes',
            '-o', 'IdentitiesOnly=yes', '-o', 'PasswordAuthentication=no',
            '-o', 'KbdInteractiveAuthentication=no', '-o', 'ForwardAgent=no',
            '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=15', '-o', 'LogLevel=ERROR',
            'tgv99536@100.105.27.82', 'python3 -I -c ' + shlex.quote(script) + ' remote'],
            input=json.dumps(payload), timeout=1140)
        report = json.loads(result)
        if (report['sha'] != context['sha'] or report['project'] != PROJECT
                or set(report['images']) != set(SERVICES)
                or any(not re.fullmatch(re.escape(IMAGES[name]) + '@sha256:[0-9a-f]{64}', digest)
                       for name, digest in report['images'].items())):
            raise ValueError('Remote completion provenance mismatch')
        # A push while startup/health runs must not be reported as current success.
        verify(context, token)
        print(json.dumps(report))


def main():
    if sys.argv[1:] == ['remote']:
        remote(json.load(sys.stdin))
        return
    context = {'repository': os.environ['GITHUB_REPOSITORY'], 'event': os.environ['GITHUB_EVENT_NAME'],
               'ref': os.environ['GITHUB_REF'], 'sha': os.environ['GITHUB_SHA'],
               'run_id': int(os.environ['GITHUB_RUN_ID']), 'attempt': int(os.environ['GITHUB_RUN_ATTEMPT'])}
    if sys.argv[1:] not in (['check'], ['deploy']): raise ValueError('Use check or deploy')
    verify(context, os.environ['GH_TOKEN'])
    settings()
    if sys.argv[1:] == ['deploy']: connect(context, os.environ['GH_TOKEN'])


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        # Never dump a subprocess/HTTP response, payload, Compose config, token, or service logs.
        sys.exit('Develop CD failed closed; check provisioning, exact publish evidence and health (raw output suppressed)')
