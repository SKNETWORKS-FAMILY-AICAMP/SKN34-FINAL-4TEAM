from subprocess import TimeoutExpired
from types import SimpleNamespace
from unittest.mock import MagicMock, call

import pytest

from app.images import moderation


def verdict(sexual=False, input_types=("image",)):
    return SimpleNamespace(results=[SimpleNamespace(
        categories=SimpleNamespace(sexual=sexual),
        category_applied_input_types=SimpleNamespace(sexual=input_types),
    )])


def provider(monkeypatch, *, sexual=False, input_types=("image",)):
    client = MagicMock()
    request = client.return_value.__enter__.return_value.moderations.create
    request.return_value = verdict(sexual, input_types)
    monkeypatch.setenv("OPENAI_API_KEY", "local-test")
    monkeypatch.setattr(moderation, "OpenAI", client)
    return request


def test_checks_exact_png_bytes_as_image_without_retries(monkeypatch):
    request = provider(monkeypatch)
    ocr = MagicMock(return_value=SimpleNamespace(stdout=b" \n", stderr=b""))
    monkeypatch.setattr(moderation, "run", ocr)

    moderation.check_output(b"png")

    assert ocr.call_args.args[0] == ["tesseract", "stdin", "stdout", "-l", "eng+kor", "--psm", "11"]
    assert ocr.call_args.kwargs["input"] == b"png"
    assert ocr.call_args.kwargs["timeout"] == 10
    request.assert_called_once_with(model="omni-moderation-latest", input=[{
        "type": "image_url", "image_url": {"url": "data:image/png;base64,cG5n"},
    }])
    moderation.OpenAI.assert_called_once_with(api_key="local-test", timeout=10, max_retries=0)


def test_sexual_image_is_blocked(monkeypatch):
    provider(monkeypatch, sexual=True)
    ocr = MagicMock()
    monkeypatch.setattr(moderation, "run", ocr)

    with pytest.raises(moderation.OutputBlocked):
        moderation.check_output(b"png")

    ocr.assert_not_called()


@pytest.mark.parametrize("input_types", [(), ("text",)])
def test_non_image_verdict_cannot_release_output(monkeypatch, input_types):
    provider(monkeypatch, input_types=input_types)
    with pytest.raises(moderation.OutputModerationUnavailable):
        moderation.check_output(b"png")


def test_provider_failure_is_returned_as_moderation_unavailable(monkeypatch):
    request = provider(monkeypatch)
    request.side_effect = TimeoutError("private provider payload")
    with pytest.raises(moderation.OutputModerationUnavailable) as raised:
        moderation.check_output(b"png")
    assert "private provider payload" not in str(raised.value)


@pytest.mark.parametrize("sexual", [True, False])
def test_sends_detected_text_for_its_own_verdict(monkeypatch, sexual):
    request = provider(monkeypatch)
    request.side_effect = [verdict(), verdict(sexual, ("text",))]
    monkeypatch.setattr(moderation, "run", lambda *args, **kwargs: SimpleNamespace(
        stdout="표지 문구\nADULT SERVICES".encode("utf-8"), stderr=b"",
    ))

    if sexual:
        with pytest.raises(moderation.OutputBlocked):
            moderation.check_output(b"png")
    else:
        moderation.check_output(b"png")

    assert request.call_count == 2
    assert request.call_args == call(model="omni-moderation-latest", input="표지 문구 ADULT SERVICES")


@pytest.mark.parametrize("text", [
    "ADULT ESCORT SERVICES PAID SEXUAL SERVICES BOOK AN ADULT ENCOUNTER",
    "18+ ONLY ADULT ESCORT SERVICES PAID SEXUAL SERVICES BOOK AN ADULT ENCOUNTER",
    "ＡＤＵＬＴ　ＥＳＣＯＲＴ　ＳＥＲＶＩＣＥＳ\nBOOK—NOW",
    "성인 에스코트 서비스\n예약 문의",
])
def test_blocks_adult_service_ads_even_when_text_verdict_allows(monkeypatch, text):
    request = provider(monkeypatch)
    request.side_effect = [verdict(), verdict(False, ("text",))]
    monkeypatch.setattr(moderation, "run", MagicMock(return_value=SimpleNamespace(
        stdout=text.encode("utf-8"), stderr=b"",
    )))

    with pytest.raises(moderation.OutputBlocked):
        moderation.check_output(b"png")

    assert request.call_args == call(model="omni-moderation-latest", input=" ".join(text.split()))


@pytest.mark.parametrize("text", [
    "18+ ADULT EDUCATION BOOK NOW",
    "TRAVEL ESCORT SERVICE BOOK NOW",
    "A BOOK ABOUT PAID SEXUAL SERVICES AND PUBLIC HEALTH",
    "성매매 예방 상담 예약",
])
def test_allows_unrelated_or_nonpromotional_text(monkeypatch, text):
    request = provider(monkeypatch)
    request.side_effect = [verdict(), verdict(False, ("text",))]
    monkeypatch.setattr(moderation, "run", MagicMock(return_value=SimpleNamespace(
        stdout=text.encode("utf-8"), stderr=b"",
    )))

    moderation.check_output(b"png")


@pytest.mark.parametrize("failure", ["ocr_timeout", "ocr_missing_language", "text_verdict_missing", "text_timeout"])
def test_cannot_release_image_when_text_safety_is_unknown(monkeypatch, failure):
    request = provider(monkeypatch)
    ocr = MagicMock(return_value=SimpleNamespace(stdout=b"text", stderr=b""))
    monkeypatch.setattr(moderation, "run", ocr)
    if failure == "ocr_timeout":
        ocr.side_effect = TimeoutExpired("tesseract", 10)
    elif failure == "ocr_missing_language":
        ocr.return_value.stderr = b"Failed loading language 'kor'"
    elif failure == "text_verdict_missing":
        request.side_effect = [verdict(), verdict(False, ("image",))]
    else:
        request.side_effect = [verdict(), TimeoutError("private OCR text")]

    with pytest.raises(moderation.OutputModerationUnavailable) as raised:
        moderation.check_output(b"png")
    assert "private OCR text" not in str(raised.value)


def cover_bytes(fmt="PNG", *, animated=False):
    from io import BytesIO
    from PIL import Image
    image = Image.new("RGB", (16, 16), "red")
    buf = BytesIO()
    if animated:
        image.save(buf, fmt, save_all=True, append_images=[Image.new("RGB", (16, 16), "blue")], duration=100)
    else:
        image.save(buf, fmt)
    return buf.getvalue()


@pytest.mark.parametrize("graphic,applied,error", [
    (False, ("image",), None),
    (True, ("image",), moderation.OutputBlocked),
    (False, ("text",), moderation.OutputModerationUnavailable),
])
def test_direct_cover_checks_graphic_violence(monkeypatch, graphic, applied, error):
    request = provider(monkeypatch)
    reply = verdict()
    reply.results[0].categories.violence_graphic = graphic
    reply.results[0].category_applied_input_types.violence_graphic = applied
    request.return_value = reply
    ocr = MagicMock(return_value="")
    monkeypatch.setattr(moderation, "read_image_text", ocr)
    raw = cover_bytes("JPEG")

    if error is None:
        moderation.check_cover(raw, "image/jpeg")
        ocr.assert_called_once_with(raw)
    else:
        with pytest.raises(error):
            moderation.check_cover(raw, "image/jpeg")
        ocr.assert_not_called()

    request.assert_called_once()
    assert request.call_args.kwargs["input"][0]["image_url"]["url"].startswith("data:image/jpeg;base64,")


@pytest.mark.parametrize("media_type,raw", [
    ("image/png", cover_bytes(animated=True)),
    ("image/webp", cover_bytes("WEBP", animated=True)),
    ("image/webp", b"broken"),
])
def test_rejects_covers_whose_display_cannot_be_checked(monkeypatch, media_type, raw):
    request = provider(monkeypatch)
    with pytest.raises(moderation.InvalidCover):
        moderation.check_cover(raw, media_type)
    request.assert_not_called()
