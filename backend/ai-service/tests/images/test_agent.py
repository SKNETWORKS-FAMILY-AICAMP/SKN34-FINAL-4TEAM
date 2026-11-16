import base64
from types import SimpleNamespace
from app.images import agent
from app.images.models import ImageInput

def test_fixed_model_quality_size_and_no_retry(monkeypatch):
    settings={}
    request={}
    class Client:
        def __init__(self,**kwargs): settings.update(kwargs);self.images=self
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def generate(self,**kwargs):
            request.update(kwargs)
            return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(b"png").decode())])
    monkeypatch.setenv("OPENAI_API_KEY","test-only")
    monkeypatch.setattr(agent,"OpenAI",Client)
    assert agent.generate(ImageInput(purpose="world_cover",prompt="scene"))==b"png"
    assert settings["max_retries"]==0
    assert settings["timeout"]==180
    assert request==dict(model="gpt-image-2.6-flare",quality="high",size="1152x1536",prompt="scene",n=1,output_format="png")
