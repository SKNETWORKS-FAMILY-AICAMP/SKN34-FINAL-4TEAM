import base64
import json
import pytest
from types import SimpleNamespace
from app.images import agent
from app.images.models import ImageInput
from app.images.prompt import build_prompt

@pytest.mark.parametrize('purpose,version,fixed_settings', [('world_cover','v1',''),('world_cover','cover-v2','황동 천문탑'),('work_cover','cover-v2','남청색 항해사 외투')])
def test_fixed_model_quality_size_and_no_retry(monkeypatch, spans, purpose, version, fixed_settings):
    data=ImageInput(purpose=purpose,prompt='scene',templateVersion=version,visualSettings=fixed_settings)
    settings={}
    request={}
    class Client:
        def __init__(self,**kwargs): settings.update(kwargs);self.images=self
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def generate(self,**kwargs):
            request.update(kwargs)
            return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(b"png").decode())],usage=SimpleNamespace(input_tokens=10,output_tokens=20))
    monkeypatch.setenv("OPENAI_API_KEY","test-only")
    monkeypatch.setattr(agent,"OpenAI",Client)
    assert agent.generate(data)==b"png"
    assert settings["max_retries"]==0
    assert settings["timeout"]==180
    assert request==dict(model="gpt-image-2.6-flare",quality="high",size="1152x1536",prompt=build_prompt(data),n=1,output_format="png")
    generation,=spans()
    assert generation.attributes['langfuse.observation.model.name']=='gpt-image-2.6-flare'
    assert json.loads(generation.attributes['langfuse.observation.usage_details'])=={'input':10,'output':20}
    assert 'langfuse.observation.input' not in generation.attributes
    assert 'langfuse.observation.output' not in generation.attributes


def test_provider_failure_trace_contains_only_safe_error_type(monkeypatch, spans):
    class Client:
        def __init__(self,**kwargs): self.images=self
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def generate(self,**kwargs): raise RuntimeError('private provider response')
    monkeypatch.setenv('OPENAI_API_KEY','private-test-key')
    monkeypatch.setattr(agent,'OpenAI',Client)
    with pytest.raises(RuntimeError):
        agent.generate(ImageInput(purpose='work_cover',prompt='private prompt',visualSettings='private fixed settings',templateVersion='cover-v2'))
    generation,=spans()
    assert generation.attributes['langfuse.observation.level']=='ERROR'
    assert generation.attributes['langfuse.observation.status_message']=='RuntimeError'
    assert 'private' not in str(generation.attributes)
    assert not generation.events
