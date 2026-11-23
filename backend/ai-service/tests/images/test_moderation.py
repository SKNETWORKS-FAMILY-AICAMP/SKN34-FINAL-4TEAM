from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.images import moderation


def provider(monkeypatch, *, sexual=False, input_types=("image",)):
    client = MagicMock()
    request = client.return_value.__enter__.return_value.moderations.create
    request.return_value = SimpleNamespace(results=[SimpleNamespace(
        categories=SimpleNamespace(sexual=sexual),
        category_applied_input_types=SimpleNamespace(sexual=input_types),
    )])
    monkeypatch.setenv("OPENAI_API_KEY", "local-test")
    monkeypatch.setattr(moderation, "OpenAI", client)
    return request


def test_checks_exact_png_bytes_as_image_without_retries(monkeypatch):
    request = provider(monkeypatch)

    moderation.check_output(b"png")

    request.assert_called_once_with(model="omni-moderation-latest", input=[{
        "type": "image_url", "image_url": {"url": "data:image/png;base64,cG5n"},
    }])
    moderation.OpenAI.assert_called_once_with(api_key="local-test", timeout=10, max_retries=0)


def test_sexual_image_is_blocked(monkeypatch):
    provider(monkeypatch, sexual=True)

    with pytest.raises(moderation.OutputBlocked):
        moderation.check_output(b"png")


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
