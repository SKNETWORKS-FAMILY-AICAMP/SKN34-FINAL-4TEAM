"""Validate optional content Compose without Docker engine or real secrets."""
import json
import os
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[2]
env={k:v for k,v in os.environ.items() if k in ('PATH','SystemRoot','SYSTEMROOT','HOME','USERPROFILE','DOCKER_CONFIG')}
env.update(CONTENT_DATABASE_PASSWORD='synthetic-db',INTERNAL_TOKEN='synthetic-internal',OPENAI_API_KEY='synthetic-openai')
for base in ('compose.yaml','compose.prod.yaml'):
    result=subprocess.run(['docker','compose','--env-file',str(root/'.env.example'),'-f',str(root/'infrastructure'/base),'-f',str(root/'infrastructure/compose.content.yaml'),'config','--format','json'],env=env,capture_output=True,text=True,check=True)
    services=json.loads(result.stdout)['services']
    assert set(services)=={'web','core-api','ai-service','postgres'}
    assert services['core-api']['environment']['CONTENT_ENABLED']=='true'
    assert services['core-api']['environment']['CONTENT_DATABASE_URL']=='jdbc:postgresql://postgres:5432/storyfork'
    assert not services['postgres'].get('ports')
    assert not services['ai-service'].get('ports')
    for name,service in services.items():
        settings=service.get('environment',{})
        assert ('OPENAI_API_KEY' in settings)==(name=='ai-service')
        assert ('INTERNAL_TOKEN' in settings)==(name in ('core-api','ai-service'))
        assert 'CONTENT_DEV_OWNER' not in settings
        assert not service.get('env_file')
        assert 'synthetic' not in json.dumps(service.get('build',{}))
    print(base+': content configuration and secret isolation passed')
