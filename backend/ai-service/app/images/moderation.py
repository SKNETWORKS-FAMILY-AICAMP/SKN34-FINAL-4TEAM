"""생성 결과와 직접 업로드하는 표지의 콘텐츠를 저장 전에 검사한다."""
import base64
import os
import re
from io import BytesIO
from subprocess import run
from unicodedata import normalize

from openai import OpenAI
from openai.types import ModerationMultiModalInputParam
from PIL import Image


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
    """이미지가 콘텐츠 기준에 걸렸다."""


class OutputModerationUnavailable(Exception):
    """OCR이나 적용된 검사 판정을 확인할 수 없다."""


class InvalidCover(Exception):
    """정지 이미지의 내용을 확인할 수 없는 표지 파일이다."""



def read_image_text(raw: bytes) -> str:
    """파일을 남기지 않고 이미지에서 한글·영문 문구를 읽는다."""
    result = run(
        ["tesseract", "stdin", "stdout", "-l", "eng+kor", "--psm", "11"],
        input=raw, capture_output=True, check=True, timeout=10,
        env={**os.environ, "OMP_THREAD_LIMIT": "1"},
    )
    # Tesseract는 두 언어 중 하나만 읽어도 성공 코드로 끝날 수 있다.
    if b"Failed loading language" in result.stderr:
        raise ValueError("OCR_LANGUAGE_UNAVAILABLE")
    return " ".join(result.stdout.decode("utf-8").split())


def check_categories(
    client: OpenAI,
    input_value: str | list[ModerationMultiModalInputParam],
    input_type: str,
    categories: tuple[str, ...] = ("sexual",),
) -> None:
    """검사에 실제로 사용한 입력 유형과 각 필수 항목의 판정을 확인한다."""
    result, = client.moderations.create(model="omni-moderation-latest", input=input_value).results
    for category in categories:
        flagged = getattr(result.categories, category)
        applied = getattr(result.category_applied_input_types, category)
        if not isinstance(flagged, bool) or input_type not in applied:
            raise ValueError("MODERATION_VERDICT_INVALID")
        if flagged:
            raise OutputBlocked


def check_adult_service_ad(text: str) -> None:
    """성인 서비스와 예약·구매 유도 문구가 함께 있는 광고를 차단한다."""
    # 서비스 언급만 있는 문학·교육 문구의 오탐을 줄이기 위해 두 표현을 함께 확인한다.
    normalized = re.sub(r"[\W_]+", " ", normalize("NFKC", text).casefold())
    if _ADULT_SERVICE.search(normalized) and _COMMERCIAL_OFFER.search(normalized):
        raise OutputBlocked


def check_output(raw: bytes) -> None:
    """워커가 검증한 생성 PNG 바이트에 기존 검사 기준을 적용한다."""
    check_image(raw, "image/png", ("sexual",), raw)


def check_cover(raw: bytes, media_type: str) -> None:
    """표지가 실제로 표시할 프레임을 확인하고 노골적인 폭력 판정도 적용한다."""
    image_format = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}.get(media_type)
    if image_format is None:
        raise InvalidCover
    try:
        with Image.open(BytesIO(raw), formats=[image_format]) as image:
            width, height = image.size
            if width > 4096 or height > 4096 or width * height > 16_000_000 or getattr(image, "n_frames", 1) != 1:
                raise InvalidCover
            image.load()
            ocr_bytes = raw
            if image_format == "WEBP":
                # 설치된 Tesseract의 WebP 빌드 옵션과 무관하게 OCR을 실행한다.
                with BytesIO() as png:
                    image.save(png, format="PNG")
                    ocr_bytes = png.getvalue()
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        raise InvalidCover from None
    check_image(raw, media_type, ("sexual", "violence_graphic"), ocr_bytes)


def check_image(raw: bytes, media_type: str, categories: tuple[str, ...], ocr_bytes: bytes) -> None:
    """이미지와 OCR 문구 검사를 모두 통과하면 반환한다."""
    data_url = f"data:{media_type};base64," + base64.b64encode(raw).decode("ascii")
    try:
        with OpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=10, max_retries=0) as client:
            check_categories(client, [{
                "type": "image_url", "image_url": {"url": data_url},
            }], "image", categories)
            text = read_image_text(ocr_bytes)
            if text:
                check_categories(client, text, "text")
                check_adult_service_ad(text)
    except OutputBlocked:
        raise
    except Exception:
        # 오류에 이미지나 문구가 포함될 수 있어 내부 상태만 전달한다.
        raise OutputModerationUnavailable from None
