"""Validate optional content Compose without Docker engine or real secrets."""
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
env = {k: v for k, v in os.environ.items() if k in ('PATH', 'SystemRoot', 'SYSTEMROOT', 'HOME', 'USERPROFILE', 'DOCKER_CONFIG')}
env.update(CORE_DATABASE_USER='synthetic-user', CORE_DATABASE_PASSWORD='synthetic-db',
           AUTH_PUBLIC_ORIGIN='http://127.0.0.1:5173', AUTH_MAIL_FROM='dev@example.invalid',
           AUTH_JWT_SECRET='synthetic-jwt', INTERNAL_TOKEN='synthetic-internal', OPENAI_API_KEY='synthetic-openai')


def config(base, overlay):
    command = ['docker', 'compose', '--env-file', str(root / '.env.example'), '-f', str(root / 'infrastructure' / base)]
    if overlay:
        command += ['-f', str(root / 'infrastructure/compose.content.yaml')]
    result = subprocess.run(command + ['config', '--format', 'json'], env=env, capture_output=True, text=True)
    assert result.returncode == 0, 'Content overlay must use the existing Auth database settings'
    return json.loads(result.stdout)


for base in ('compose.yaml', 'compose.prod.yaml'):
    original, combined = config(base, False), config(base, True)
    services = combined['services']
    dev = base == 'compose.yaml'
    assert set(services) == {'web', 'core-api', 'ai-service', 'postgres', 'mailpit'} | ({'nginx'} if dev else set())
    # Enabling content must not replace an existing database, credentials, volume or port.
    assert services['postgres'] == original['services']['postgres']
    assert combined['volumes'] == original['volumes']
    for name in set(services) - {'core-api', 'ai-service'}:
        assert services[name] == original['services'][name]
    assert services['core-api']['environment'] == {
        **original['services']['core-api']['environment'],
        'CONTENT_ENABLED': 'true',
        'CONTENT_DATABASE_URL': original['services']['core-api']['environment']['CORE_DATABASE_URL'],
        'CONTENT_DATABASE_USER': 'synthetic-user',
        'CONTENT_DATABASE_PASSWORD': 'synthetic-db',
        'INTERNAL_TOKEN': 'synthetic-internal',
    }
    assert services['ai-service']['environment'] == {
        **original['services']['ai-service']['environment'], 'INTERNAL_TOKEN': 'synthetic-internal',
    }
    assert not services['ai-service'].get('ports')
    assert not services['web'].get('ports') if dev else not services['core-api'].get('ports')
    entry = services['nginx'] if dev else services['web']
    assert entry['ports'][0]['host_ip'] == '127.0.0.1'
    assert str(entry['ports'][0]['published']) == ('5173' if dev else '8088')
    for name, service in services.items():
        settings = service.get('environment', {})
        assert ('OPENAI_API_KEY' in settings) == (name == 'ai-service')
        assert ('OPENAI_MODEL' in settings) == (name == 'ai-service')
        assert ('AUTH_JWT_SECRET' in settings) == (name == 'core-api')
        assert ('INTERNAL_TOKEN' in settings) == (name in ('core-api', 'ai-service'))
        assert ('CONTENT_DATABASE_PASSWORD' in settings) == (name == 'core-api')
        assert 'CONTENT_DEV_OWNER' not in settings
        assert not service.get('env_file')
        assert 'synthetic' not in json.dumps(service.get('build', {}))
        assert all(port['host_ip'] == '127.0.0.1' for port in service.get('ports', []))
    print(base + ': shared Auth/content database, exact services and secret isolation passed')
