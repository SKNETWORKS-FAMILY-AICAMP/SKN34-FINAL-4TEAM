"""이미지 모델을 재시도 없이 한 번 호출한다."""
import base64
import os
from openai import OpenAI
from app.images.models import ImageInput

def generate(data: ImageInput) -> bytes:
    """키는 실행 시 읽고 모델·규격은 접수 스냅샷을 쓴다."""
    with OpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=180, max_retries=0) as client:
        response = client.images.generate(model=data.model, quality=data.quality,
            size=data.size, prompt=data.prompt, n=1, output_format="png")
        if not response.data or not response.data[0].b64_json:
            raise ValueError("IMAGE_EMPTY")
        return base64.b64decode(response.data[0].b64_json, validate=True)
