"""생성한 PNG의 성적 콘텐츠 여부를 저장 전에 확인한다."""
import base64
import os

from openai import OpenAI


class OutputBlocked(Exception):
    """생성 결과가 이미지 콘텐츠 기준에 걸렸다."""


class OutputModerationUnavailable(Exception):
    """이미지에 적용된 검사 판정을 확인할 수 없다."""


def check_output(raw: bytes) -> None:
    """검증을 마친 PNG 바이트 그대로 검사하고 통과한 경우만 반환한다."""
    data_url = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
    try:
        with OpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=10, max_retries=0) as client:
            result, = client.moderations.create(model="omni-moderation-latest", input=[{
                "type": "image_url", "image_url": {"url": data_url},
            }]).results
        sexual = result.categories.sexual
        if not isinstance(sexual, bool) or "image" not in result.category_applied_input_types.sexual:
            raise ValueError("IMAGE_MODERATION_VERDICT_INVALID")
    except Exception:
        # 제공자 오류에 요청이나 이미지가 포함될 수 있어 내부 상태만 전달한다.
        raise OutputModerationUnavailable from None
    if sexual:
        raise OutputBlocked
