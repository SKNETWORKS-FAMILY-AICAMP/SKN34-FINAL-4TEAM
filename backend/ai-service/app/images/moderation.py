"""생성한 PNG와 이미지 속 문구의 성적 콘텐츠 여부를 저장 전에 확인한다."""
import base64
import os
import re
from subprocess import run
from unicodedata import normalize

from openai import OpenAI
from openai.types import ModerationMultiModalInputParam


_ADULT_SERVICE = re.compile(
    r"\b(?:adult escorts?(?: services?)?|sex(?:ual)? services?)\b"
    r"|성인\s*에스코트(?:\s*서비스)?|성적\s*서비스|성매매"
)
_COMMERCIAL_OFFER = re.compile(
    r"\b(?:book (?:now|online|today|an adult encounter|a session|an appointment)"
    r"|(?:call|text|contact us) to book|booking (?:open|available)|rates (?:from|start at))\b"
    r"|지금\s*예약|예약\s*(?:문의|가능)|가격\s*문의"
)


class OutputBlocked(Exception):
    """생성 결과가 이미지 콘텐츠 기준에 걸렸다."""


class OutputModerationUnavailable(Exception):
    """OCR이나 적용된 검사 판정을 확인할 수 없다."""


def read_image_text(raw: bytes) -> str:
    """파일을 남기지 않고 PNG에서 한글·영문 문구를 읽는다."""
    result = run(
        ["tesseract", "stdin", "stdout", "-l", "eng+kor", "--psm", "11"],
        input=raw, capture_output=True, check=True, timeout=10,
        env={**os.environ, "OMP_THREAD_LIMIT": "1"},
    )
    # Tesseract는 두 언어 중 하나만 읽어도 성공 코드로 끝날 수 있다.
    if b"Failed loading language" in result.stderr:
        raise ValueError("OCR_LANGUAGE_UNAVAILABLE")
    return " ".join(result.stdout.decode("utf-8").split())


def check_sexual(
    client: OpenAI, input_value: str | list[ModerationMultiModalInputParam], input_type: str,
) -> None:
    """검사에 사용된 입력의 성적 콘텐츠 판정을 확인한다."""
    result, = client.moderations.create(model="omni-moderation-latest", input=input_value).results
    sexual = result.categories.sexual
    if not isinstance(sexual, bool) or input_type not in result.category_applied_input_types.sexual:
        raise ValueError("MODERATION_VERDICT_INVALID")
    if sexual:
        raise OutputBlocked


def check_adult_service_ad(text: str) -> None:
    """성인 서비스와 예약·구매 유도 문구가 함께 있는 광고를 차단한다."""
    # 서비스 언급만 있는 문학·교육 문구의 오탐을 줄이기 위해 두 표현을 함께 확인한다.
    normalized = re.sub(r"[\W_]+", " ", normalize("NFKC", text).casefold())
    if _ADULT_SERVICE.search(normalized) and _COMMERCIAL_OFFER.search(normalized):
        raise OutputBlocked


def check_output(raw: bytes) -> None:
    """검증을 마친 PNG 바이트 그대로 검사하고 통과한 경우만 반환한다."""
    data_url = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
    try:
        with OpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=10, max_retries=0) as client:
            check_sexual(client, [{
                "type": "image_url", "image_url": {"url": data_url},
            }], "image")
            text = read_image_text(raw)
            if text:
                check_sexual(client, text, "text")
                check_adult_service_ad(text)
    except OutputBlocked:
        raise
    except Exception:
        # 오류에 이미지나 문구가 포함될 수 있어 내부 상태만 전달한다.
        raise OutputModerationUnavailable from None
