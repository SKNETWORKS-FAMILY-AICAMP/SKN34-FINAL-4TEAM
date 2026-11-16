import pytest

from app import tracing
from app.manuscript.errors import ManuscriptFailure


def test_failure_is_level_error_with_fixed_message_and_no_exception_event(spans):
    with pytest.raises(ManuscriptFailure):
        with tracing.observe('step'):
            raise ManuscriptFailure(502, 'Q&A 모델 응답을 확인할 수 없습니다.')
    with pytest.raises(ValueError):
        with tracing.observe('bug'):
            raise ValueError('원고 본문이 담긴 메시지')
    step, bug = spans()
    assert step.attributes['langfuse.observation.level'] == 'ERROR'
    assert step.attributes['langfuse.observation.status_message'] == 'Q&A 모델 응답을 확인할 수 없습니다.'
    assert bug.attributes['langfuse.observation.status_message'] == 'ValueError'
    assert not step.events and not bug.events


def test_child_joins_given_trace_from_another_request(spans):
    run_id, parent = tracing.start_run('run')
    with tracing.observe('child', trace_context=tracing.context(run_id, parent)):
        pass
    root, child = spans()  # root는 열자마자 닫는다.
    assert format(child.context.trace_id, '032x') == run_id and format(child.parent.span_id, '016x') == parent


def test_disabled_tracing_has_no_run_id(monkeypatch):
    monkeypatch.delenv('LANGFUSE_PUBLIC_KEY', raising=False)
    monkeypatch.delenv('LANGFUSE_SECRET_KEY', raising=False)
    tracing.client.cache_clear()
    assert tracing.start_run('run') == (None, None)
    with tracing.observe('child', trace_context=tracing.context(None, None)):
        pass
