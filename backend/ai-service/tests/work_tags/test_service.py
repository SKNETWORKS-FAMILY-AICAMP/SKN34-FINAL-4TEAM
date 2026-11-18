"""#372 Content 규칙 검증. 규칙을 벗어난 후보는 보정하지 않고 전체를 거부한다."""
import pytest

from app.work_tags import service
from app.work_tags.errors import SuggestionFailure
from app.work_tags.models import Input, Output

from .stubs import data, fake_openai, output


def test_returns_candidates_within_content_rules(monkeypatch):
    fake_openai(monkeypatch, output())
    assert service.suggest(Input.model_validate(data())).model_dump() == output()


def test_accepts_keyword_without_trailing_newline(monkeypatch):
    fake_openai(monkeypatch, output(hashtags=['회귀']))
    assert service.suggest(Input.model_validate(data())).hashtags == ['회귀']


@pytest.mark.parametrize('proposed', [
    output(genres=['무협']),
    output(genres=['고전', '드라마', '현대']),
    output(genres=['고전', '고전']),
    output(hashtags=['가', '나', '다', '라']),
    output(hashtags=['가', '가']),
    output(hashtags=['장돌뱅이', '드라마']),
    output(genres=[]),
    output(hashtags=['#장돌뱅이']),
    output(hashtags=['여름 밤']),
    output(hashtags=['']),
    output(hashtags=['회귀\n']),
    output(hashtags=['가' * 31]),
])
def test_rejects_whole_result_instead_of_correcting(monkeypatch, proposed):
    fake_openai(monkeypatch, proposed)
    with pytest.raises(SuggestionFailure) as failure:
        service.suggest(Input.model_validate(data()))
    assert failure.value.status == 502
