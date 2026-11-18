"""이미지 모델을 재시도 없이 한 번 호출한다."""
import base64
import os
from openai import OpenAI
from app import tracing
from app.images.models import ImageInput
from app.images.prompt import build_prompt

def generate(data: ImageInput) -> bytes:
    """키는 실행 시 읽고 모델·규격은 접수 스냅샷을 쓴다."""
    with OpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=180, max_retries=0) as client, \
        tracing.observe("images.generate", as_type="generation", model=data.model,
            model_parameters={"quality":data.quality,"size":data.size},
            metadata={"purpose":data.purpose,"template_version":data.templateVersion}) as generation:
        response = client.images.generate(model=data.model, quality=data.quality,
            size=data.size, prompt=build_prompt(data), n=1, output_format="png")
        usage = getattr(response,"usage",None)
        generation.update(usage_details=usage and {"input":usage.input_tokens,"output":usage.output_tokens})
        if not response.data or not response.data[0].b64_json:
            raise ValueError("IMAGE_EMPTY")
        return base64.b64decode(response.data[0].b64_json, validate=True)
