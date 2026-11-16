import base64
import json
import pytest
from types import SimpleNamespace
from app.images import agent
from app.images.models import ImageInput

def test_fixed_model_quality_size_and_no_retry(monkeypatch, spans):
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
    assert agent.generate(ImageInput(purpose="world_cover",prompt="scene"))==b"png"
    assert settings["max_retries"]==0
    assert settings["timeout"]==180
    assert request==dict(model="gpt-image-2.6-flare",quality="high",size="1152x1536",prompt="scene",n=1,output_format="png")
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
        agent.generate(ImageInput(purpose='work_cover',prompt='private prompt'))
    generation,=spans()
    assert generation.attributes['langfuse.observation.level']=='ERROR'
    assert generation.attributes['langfuse.observation.status_message']=='RuntimeError'
    assert 'private' not in str(generation.attributes)
    assert not generation.events
