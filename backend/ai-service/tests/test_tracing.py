import asyncio
import contextvars
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from langfuse.api import NotFoundError
from openai import APITimeoutError

from app import tracing
from app.story_qa.errors import StoryQaFailure

from traced import MEMBER, attrs, bearer, status_of


def test_failure_is_level_error_with_fixed_message_and_no_exception_event(spans):
    with pytest.raises(StoryQaFailure):
        with tracing.observe('step'):
            raise StoryQaFailure(502, 'Q&A 모델 응답을 확인할 수 없습니다.')
    with pytest.raises(ValueError):
        with tracing.observe('bug'):
            raise ValueError('원고 본문이 담긴 메시지')
    step, bug = spans()
    assert step.attributes['langfuse.observation.level'] == 'ERROR'
    assert step.attributes['langfuse.observation.status_message'] == 'Q&A 모델 응답을 확인할 수 없습니다.'
    assert bug.attributes['langfuse.observation.status_message'] == 'ValueError'
    assert not step.events and not bug.events


def test_child_joins_given_trace_from_another_request(spans):
    with tracing.request('orchestration') as first:
        pass
    with tracing.observe('child', trace_context=tracing.context(first.trace_id, first.span_id)):
        pass
    root, child = spans()
    assert format(child.context.trace_id, '032x') == first.trace_id and format(child.parent.span_id, '016x') == first.span_id


def test_disabled_tracing_has_no_run_id(monkeypatch):
    monkeypatch.delenv('LANGFUSE_PUBLIC_KEY', raising=False)
    monkeypatch.delenv('LANGFUSE_SECRET_KEY', raising=False)
    tracing.client.cache_clear()
    with tracing.request('orchestration') as run:
        assert tracing.context(run.trace_id, run.span_id) is None
    assert (run.trace_id, run.span_id) == (None, None)


# --- 요청 하나 = trace 하나(DEC-55 계측 규칙) ---------------------------------------------------------------------------

def test_member_id_is_the_uuid_subject_of_the_bearer_token():
    assert tracing.member_id(bearer()) == MEMBER


@pytest.mark.parametrize('authorization', ['', 'Bearer', 'Bearer a.b.c', 'Bearer a.e30.c', 'Bearer a.WzFd.c', bearer('member-1'), bearer(42)])
def test_member_id_is_none_when_there_is_no_uuid_subject(authorization):
    assert tracing.member_id(authorization) is None


def test_request_root_carries_member_session_feature_name_tags_and_metadata(spans):
    with tracing.request('manuscript_review', user_id=MEMBER, session_id='thread-1', work_id='work-1', fork=True, credit_reservation_id='res-1'):
        pass
    [root] = spans()
    found = attrs(root)
    assert root.name == 'manuscript_review' and root.parent is None
    assert (found['user.id'], found['session.id']) == (MEMBER, 'thread-1')
    assert found['langfuse.trace.name'] == 'manuscript_review' and found['langfuse.trace.tags'] == ['feature:manuscript_review']
    assert found['langfuse.trace.metadata.work_id'] == 'work-1' and found['langfuse.trace.metadata.fork'] == 'true'
    assert found['langfuse.trace.metadata.credit_reservation_id'] == 'res-1'
    assert len(found['langfuse.trace.metadata.request_id']) == 32
    assert status_of(root) == 'success' and found['langfuse.internal.is_app_root']  # 이 요청의 루트 관측은 하나뿐이다


def test_fork_is_always_true_or_false_and_other_missing_values_are_left_out(spans):
    with tracing.request('manuscript_review', work_id='', credit_reservation_id=None):
        pass
    [root] = spans()
    found = attrs(root)
    assert found['langfuse.trace.metadata.fork'] == 'false'
    assert not {'langfuse.trace.metadata.work_id', 'langfuse.trace.metadata.credit_reservation_id', 'user.id', 'session.id'} & set(found)


def test_observations_inside_a_request_carry_the_trace_attributes_but_never_the_status(spans):
    with tracing.request('rating', user_id=MEMBER, session_id='s-1', work_id='work-1', fork=True, credit_reservation_id='res-1'):
        with tracing.observe('rating.generation', as_type='generation', model='m'):
            pass
    generation, root = spans()
    assert generation.parent.span_id == root.context.span_id
    found = attrs(generation)
    assert (found['user.id'], found['session.id']) == (MEMBER, 's-1')
    assert found['langfuse.trace.name'] == 'rating' and found['langfuse.trace.tags'] == ['feature:rating']
    assert (found['langfuse.trace.metadata.work_id'], found['langfuse.trace.metadata.fork'],
            found['langfuse.trace.metadata.credit_reservation_id']) == ('work-1', 'true', 'res-1')
    assert found['langfuse.trace.metadata.request_id'] == attrs(root)['langfuse.trace.metadata.request_id']
    assert status_of(generation) is None and 'langfuse.internal.is_app_root' not in found  # 상태는 루트에만, 루트도 하나뿐


def test_attributes_reach_threads_that_copy_the_context(spans):
    def in_thread():
        with tracing.observe('in-thread'):
            pass

    with tracing.request('manuscript_review', user_id=MEMBER):
        with ThreadPoolExecutor(1) as pool:
            pool.submit(contextvars.copy_context().run, in_thread).result()  # 심의·검수가 병렬로 부르는 방식
    thread_span, root = spans()
    assert attrs(thread_span)['user.id'] == MEMBER and thread_span.parent.span_id == root.context.span_id


class Failure(Exception):
    status = 503


@pytest.mark.parametrize('error, status', [(ValueError('원고 본문'), 'failed'), (Failure('고정 문구'), 'failed'),
                                           (APITimeoutError(request=SimpleNamespace()), 'timeout'), (TimeoutError(), 'timeout')])
def test_an_exception_marks_the_request_failed_or_timed_out_on_the_root_and_is_reraised(spans, error, status):
    with pytest.raises(type(error)):
        with tracing.request('manuscript_review'):
            raise error
    [root] = spans()
    assert status_of(root) == status and root.attributes['langfuse.observation.level'] == 'ERROR'
    assert attrs(root)['langfuse.trace.tags'] == ['feature:manuscript_review']  # 상태 태그는 없다


def test_a_fixed_failure_raised_from_a_timeout_still_counts_as_a_timeout(spans):
    with pytest.raises(Failure):
        with tracing.request('manuscript_review'):
            try:
                raise APITimeoutError(request=SimpleNamespace())
            except APITimeoutError:
                raise Failure('고정 문구') from None  # 기능은 이렇게 제공사 오류를 고정 문구로 바꾼다
    [root] = spans()
    assert status_of(root) == 'timeout'


def test_the_caller_sets_or_withholds_the_status_of_a_request_that_did_not_raise(spans):
    with tracing.request('orchestration') as run:
        run.status = None  # 대기 중인 턴은 끝나지 않았다
    with tracing.request('orchestration') as run:
        run.status = 'failed'  # 응답에 실패한 단계가 있어도 예외는 없다
    with tracing.request('orchestration'):
        pass
    waiting, failed, done = spans()
    assert status_of(waiting) is None and 'langfuse.observation.level' not in waiting.attributes
    assert status_of(failed) == 'failed' and failed.attributes['langfuse.observation.level'] == 'ERROR'
    assert status_of(done) == 'success' and 'langfuse.observation.level' not in done.attributes


def test_a_request_cut_off_before_it_ended_has_no_status(spans):
    async def streaming():
        with tracing.request('orchestration'):
            yield 1
            yield 2

    async def cut():
        stream = streaming()
        await stream.__anext__()
        await stream.aclose()  # 클라이언트가 SSE 연결을 끊은 경우

    asyncio.run(cut())
    [root] = spans()
    assert status_of(root) is None  # 끝나지 않은 요청을 성공으로 세지 않는다


def test_the_request_exposes_the_ids_of_its_root_and_a_later_request_joins_that_trace_as_a_root(spans):
    with tracing.request('orchestration') as first:
        pass
    with tracing.request('orchestration', user_id=MEMBER, trace_context=tracing.context(first.trace_id, first.span_id)) as second:
        with tracing.observe('step'):
            pass
    turn, step, resumed = spans()
    assert (format(turn.context.trace_id, '032x'), format(turn.context.span_id, '016x')) == (first.trace_id, first.span_id)
    assert format(resumed.context.trace_id, '032x') == first.trace_id == second.trace_id
    assert format(resumed.parent.span_id, '016x') == first.span_id and resumed.attributes['langfuse.internal.is_app_root']  # 요청마다 루트
    assert step.parent.span_id == resumed.context.span_id and 'langfuse.internal.is_app_root' not in step.attributes
    assert attrs(resumed)['user.id'] == MEMBER


def test_request_runs_with_tracing_off(monkeypatch):
    monkeypatch.delenv('LANGFUSE_PUBLIC_KEY', raising=False)
    monkeypatch.delenv('LANGFUSE_SECRET_KEY', raising=False)
    tracing.client.cache_clear()
    with pytest.raises(ValueError):
        with tracing.request('manuscript_review', user_id=MEMBER):
            raise ValueError('x')
    with tracing.request('manuscript_review', user_id=MEMBER) as run:
        pass
    assert run.status == 'success'


# --- 프롬프트 관리(Langfuse Prompt Management) -------------------------------------------------------------------------

class FakePrompts:
    """Langfuse 프롬프트 API 대역. stored가 None이면 없는 프롬프트(404)다."""

    def __init__(self, stored=None, read_error=None, create_error=None):
        self.stored, self.read_error, self.create_error, self.calls = stored, read_error, create_error, []

    def get_prompt(self, name, **kwargs):
        self.calls.append(('get', name, kwargs))
        if self.read_error:
            raise self.read_error
        if self.stored is None:
            raise NotFoundError(body='없음')
        return SimpleNamespace(name=name, version=2, prompt=self.stored, is_fallback=False)

    def create_prompt(self, **kwargs):
        self.calls.append(('create', kwargs))
        if self.create_error:
            raise self.create_error
        return SimpleNamespace(name=kwargs['name'], version=1, prompt=kwargs['prompt'], is_fallback=False)


def langfuse(monkeypatch, **kwargs) -> FakePrompts:
    fake = FakePrompts(**kwargs)
    monkeypatch.setenv('LANGFUSE_PUBLIC_KEY', 'pk-test')
    monkeypatch.setenv('LANGFUSE_SECRET_KEY', 'sk-test')
    monkeypatch.setattr(tracing, 'client', lambda: fake)
    return fake


def test_prompt_is_the_code_text_and_never_calls_langfuse_without_keys(monkeypatch):
    monkeypatch.delenv('LANGFUSE_PUBLIC_KEY', raising=False)
    monkeypatch.delenv('LANGFUSE_SECRET_KEY', raising=False)
    monkeypatch.setattr(tracing, 'client', lambda: pytest.fail('키가 없으면 Langfuse를 부르지 않는다'))
    assert tracing.prompt('review.mechanical', '코드 지시') == tracing.Prompt('코드 지시')


def test_prompt_reads_the_production_label_with_a_one_minute_cache(monkeypatch):
    fake = langfuse(monkeypatch, stored='운영 지시')
    managed = tracing.prompt('review.mechanical', '코드 지시')
    assert managed.text == '운영 지시' and (managed.client.name, managed.client.version) == ('review.mechanical', 2)
    assert fake.calls == [('get', 'review.mechanical', {'label': 'production', 'cache_ttl_seconds': 60})]


def test_a_missing_prompt_is_registered_from_the_code_text_as_version_one_and_used(monkeypatch):
    fake = langfuse(monkeypatch)
    managed = tracing.prompt('review.mechanical', '코드 지시')
    assert managed.text == '코드 지시' and managed.client.version == 1
    assert fake.calls[1] == ('create', {'name': 'review.mechanical', 'prompt': '코드 지시', 'labels': ['production'], 'type': 'text'})


@pytest.mark.parametrize('options, calls', [({'read_error': RuntimeError('down')}, 1), ({'create_error': RuntimeError('down')}, 2)])
def test_a_prompt_that_cannot_be_read_or_registered_is_unavailable_and_never_replaced_by_the_code_text(monkeypatch, options, calls):
    fake = langfuse(monkeypatch, **options)
    with pytest.raises(tracing.PromptUnavailable) as error:
        tracing.prompt('review.mechanical', '코드 지시')
    assert len(fake.calls) == calls and error.value.__suppress_context__
