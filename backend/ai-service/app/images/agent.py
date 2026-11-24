"""이미지 모델을 재시도 없이 한 번 호출한다."""
import base64
import os
from openai import OpenAI
from app import tracing
from app.images.models import ImageInput
from app.images.prompt import build_prompt, cover_instructions
from app.images.service import reference_file

def generate(data: ImageInput, reference: bytes | None = None) -> bytes:
    """키는 실행 시 읽고 모델·규격은 접수 스냅샷을 쓴다."""
    image = reference_file(reference) if reference is not None else None
    operation = "images.edit" if image else "images.generate"
    managed = None
    if data.templateVersion != "v1":
        name = f"images.{data.purpose}.{data.templateVersion}"
        if data.referenceRole is not None:
            name += f".{data.referenceRole}"
        managed = tracing.prompt(name, cover_instructions(data))
    with OpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=180, max_retries=0) as client, \
        tracing.observe(operation, as_type="generation", model=data.model,
            model_parameters={"quality":data.quality,"size":data.size},
            metadata={"purpose":data.purpose,"template_version":data.templateVersion},
            prompt=managed.client if managed is not None else None) as generation:
        options = dict(model=data.model, quality=data.quality, size=data.size,
                       prompt=build_prompt(data, managed.text if managed is not None else None), n=1, output_format="png")
        response = client.images.edit(image=image, **options) if image else client.images.generate(**options)
        usage = getattr(response,"usage",None)
        generation.update(usage_details=usage and {"input":usage.input_tokens,"output":usage.output_tokens})
        if not response.data or not response.data[0].b64_json:
            raise ValueError("IMAGE_EMPTY")
        return base64.b64decode(response.data[0].b64_json, validate=True)
