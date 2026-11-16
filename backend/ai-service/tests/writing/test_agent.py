import pytest
from openai import OpenAIError

from app.writing import agent
from app.writing.errors import WritingFailure
from app.writing.models import DraftRequest, PatchRequest, Usage

from .stubs import fake_openai


def test_draft_writes_new_text_from_plan_and_allowed_context(monkeypatch):
    seen = fake_openai(monkeypatch, text='  비가 그친 새벽, 서윤은 문을 열었다.  ')
    data = DraftRequest(episodeNumber=11, plan='1. 서윤이 편지를 발견한다.', context='10화: 서윤은 도시를 떠났다.')

    result = agent.draft(data)

    assert seen['store'] is False
    assert seen['model'] == 'test-model'
    assert '서윤이 편지를 발견한다' in seen['input'] and '도시를 떠났다' in seen['input']
    assert result.text == '비가 그친 새벽, 서윤은 문을 열었다.'
    assert result.model == 'resolved-model'
    assert result.providerResponseId == 'resp-1'
    assert result.usage == Usage(inputTokens=10, outputTokens=5)


def test_patch_returns_before_and_after_for_the_selection_only(monkeypatch):
    seen = fake_openai(monkeypatch, text='그는 조용히 웃었다.')
    data = PatchRequest(selection='그는 웃었다.', instruction='더 차분하게', precedingText='문이 닫혔다.',
                        followingText='창밖은 어두웠다.')

    result = agent.patch(data)

    # 앞뒤 문장은 읽기 전용 문맥으로만 보내고, 결과는 선택 구간의 교체 문장뿐이다.
    assert '문이 닫혔다' in seen['input'] and '그는 웃었다' in seen['input'] and '더 차분하게' in seen['input']
    assert result.before == '그는 웃었다.'
    assert result.after == '그는 조용히 웃었다.'
    assert result.providerResponseId == 'resp-1'


def test_missing_model_settings_is_503(monkeypatch):
    fake_openai(monkeypatch)
    monkeypatch.delenv('OPENAI_MODEL')
    with pytest.raises(WritingFailure) as error:
        agent.patch(PatchRequest(selection='문장', instruction='고쳐줘'))
    assert error.value.status == 503


@pytest.mark.parametrize('kwargs, code', [
    ({'error': OpenAIError('down')}, 503),
    ({'status': 'incomplete'}, 502),
    ({'text': '   '}, 502),
])
def test_provider_failure_and_empty_output_are_errors_not_results(monkeypatch, kwargs, code):
    fake_openai(monkeypatch, **kwargs)
    with pytest.raises(WritingFailure) as error:
        agent.draft(DraftRequest(episodeNumber=1, plan='계획'))
    assert error.value.status == code
