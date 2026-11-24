import base64
import json
import pytest
from types import SimpleNamespace
from unittest.mock import Mock
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
    prompt = Mock(side_effect=lambda name, default: agent.tracing.Prompt(default))
    monkeypatch.setattr(agent.tracing, "prompt", prompt)
    assert agent.generate(data)==b"png"
    assert settings["max_retries"]==0
    assert settings["timeout"]==180
    assert request==dict(model="gpt-image-2.6-flare",quality="high",size="1152x1536",prompt=build_prompt(data),n=1,output_format="png")
    generation,=spans()
    assert generation.attributes['langfuse.observation.model.name']=='gpt-image-2.6-flare'
    assert json.loads(generation.attributes['langfuse.observation.usage_details'])=={'input':10,'output':20}
    assert 'langfuse.observation.input' not in generation.attributes
    assert 'langfuse.observation.output' not in generation.attributes
    if version == 'v1':
        prompt.assert_not_called()
    else:
        prompt.assert_called_once()
        assert prompt.call_args.args[0] == f'images.{purpose}.{version}'
        assert fixed_settings not in prompt.call_args.args[1]


def test_provider_failure_trace_contains_only_safe_error_type(monkeypatch, spans):
    class Client:
        def __init__(self,**kwargs): self.images=self
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def generate(self,**kwargs): raise RuntimeError('private provider response')
    monkeypatch.setenv('OPENAI_API_KEY','private-test-key')
    monkeypatch.setattr(agent,'OpenAI',Client)
    monkeypatch.setattr(agent.tracing, 'prompt', lambda name, default: agent.tracing.Prompt(default))
    with pytest.raises(RuntimeError):
        agent.generate(ImageInput(purpose='work_cover',prompt='private prompt',visualSettings='private fixed settings',templateVersion='cover-v2'))
    generation,=spans()
    assert generation.attributes['langfuse.observation.level']=='ERROR'
    assert generation.attributes['langfuse.observation.status_message']=='RuntimeError'
    assert 'private' not in str(generation.attributes)
    assert not generation.events


def test_unavailable_managed_prompt_stops_before_the_paid_call(monkeypatch):
    client = Mock()
    monkeypatch.setattr(agent, 'OpenAI', client)
    monkeypatch.setattr(agent.tracing, 'prompt', Mock(side_effect=agent.tracing.PromptUnavailable))
    data = ImageInput(purpose='world_cover', prompt='장면', templateVersion='cover-v2')
    with pytest.raises(agent.tracing.PromptUnavailable):
        agent.generate(data)
    client.assert_not_called()


@pytest.mark.parametrize(('role', 'guidance'), [('style', '색감'), ('subject', '외형')])
def test_cover_reference_uses_edit_with_one_image(monkeypatch, spans, role, guidance):
    from PIL import Image
    from io import BytesIO

    image = BytesIO()
    Image.new('RGB', (8, 8)).save(image, 'PNG')
    reference = image.getvalue()
    requests = []

    class Client:
        def __init__(self, **kwargs): self.images = self
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def edit(self, **kwargs):
            requests.append(kwargs)
            return SimpleNamespace(data=[SimpleNamespace(b64_json='cG5n')], usage=None)

    monkeypatch.setenv('OPENAI_API_KEY', 'test-only')
    monkeypatch.setattr(agent, 'OpenAI', Client)
    data = ImageInput(purpose='work_cover', prompt='새벽 항구', templateVersion='cover-v3', referenceRole=role)
    managed = SimpleNamespace(name=f'images.work_cover.cover-v3.{role}', version=7, is_fallback=False)
    prompt = Mock(side_effect=lambda name, default: agent.tracing.Prompt('운영 지시문\n' + default, managed))
    monkeypatch.setattr(agent.tracing, 'prompt', prompt)
    assert agent.generate(data, reference) == b'png'
    request, = requests
    assert request['image'] == ('reference.png', reference, 'image/png')
    assert (request['model'], request['quality'], request['size'], request['output_format'], request['n']) == (
        'gpt-image-2.6-flare', 'high', '1152x1536', 'png', 1)
    assert guidance in request['prompt'] and '새벽 항구' in request['prompt']
    assert request['prompt'].startswith('운영 지시문')
    assert prompt.call_args.args[0] == managed.name and '새벽 항구' not in prompt.call_args.args[1]
    generation, = spans()
    assert generation.attributes['langfuse.observation.prompt.name'] == managed.name
    assert generation.attributes['langfuse.observation.prompt.version'] == managed.version
