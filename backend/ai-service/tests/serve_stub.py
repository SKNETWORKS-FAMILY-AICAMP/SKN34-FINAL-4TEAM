"""Local E2E fixture only. Never calls OpenAI; never use for deployment."""
from app.main import create_app
from app.generation import router as generation


def create_stub_app():
    generation.generate = lambda context, prompt: {
        'text': '수아는 편지를 접었다. 마법 대신 기차 시간표와 전보를 확인하며 다음 여정을 준비했다.',
        'model': 'test-stub-not-openai',
        'providerResponseId': 'local-e2e-stub',
        'usage': None,
    }
    return create_app()
