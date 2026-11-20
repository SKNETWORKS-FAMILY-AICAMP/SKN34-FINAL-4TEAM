"""#343 전처리 실행 틀. 단계 함수는 아직 미구현이라 첫 미구현에서 실패를 보고하고, 구현된 것처럼 대역을 끼우면 단계 순서·진행·실패 기록이 계약대로인지 본다."""
import json

import httpx
import pytest

from app.preprocessing import service
from app.preprocessing.errors import ReportFailure
from app.preprocessing.models import JobRequest

REQUEST = JobRequest(jobId='job-1', workId='work-1', episodes=[1, 2, 3])


def progress(stage, done, failed=(), reason=None, total=3):
    body = {'stage': stage, 'done': done, 'total': total, 'failedEpisodes': list(failed)}
    return ('job-1', {**body, 'failed': reason} if reason else body)


@pytest.fixture
def reports(monkeypatch):
    """Content로 가는 진행 보고를 (작업 ID, 본문)으로 모은다."""
    seen = []
    monkeypatch.setattr(service, 'report', lambda job_id, p: seen.append((job_id, p.model_dump(exclude_none=True))))
    return seen


@pytest.fixture
def steps(monkeypatch):
    """네 단계를 구현된 것처럼 바꾸고 호출 순서를 기록한다."""
    calls = []
    monkeypatch.setattr(service, 'extract_episode', lambda job_id, number: calls.append(('extract', number)) or {'n': number})
    monkeypatch.setattr(service, 'resolve_identities', lambda extractions: calls.append(('resolve', len(extractions))) or 'ids')
    monkeypatch.setattr(service, 'organize', lambda extractions, identities: calls.append(('organize', identities)) or 'organized')
    monkeypatch.setattr(service, 'load', lambda job_id, organized: calls.append(('load', job_id, organized)))
    return calls


# ---- 틀 그대로: 로직 미구현 ----

def test_unimplemented_steps_fail_the_job_at_the_first_one_and_never_pretend_success(reports):
    service.run_job(REQUEST)
    assert reports == [progress('extracting', 0), progress('extracting', 0, reason='전처리 로직 미구현')]


def test_every_step_is_still_a_documented_placeholder():
    for step, args in ((service.extract_episode, ('job-1', 1)), (service.resolve_identities, ([],)),
                       (service.organize, ([], {})), (service.load, ('job-1', {}))):
        with pytest.raises(NotImplementedError):
            step(*args)
        assert '계약' in step.__doc__ and '입력' in step.__doc__ and '출력' in step.__doc__


# ---- 구현된 단계가 끼워졌을 때 틀의 동작 ----

def test_stages_run_in_contract_order_and_progress_follows_each_episode(reports, steps):
    service.run_job(REQUEST)
    assert steps == [('extract', 1), ('extract', 2), ('extract', 3), ('resolve', 3), ('organize', 'ids'), ('load', 'job-1', 'organized')]
    assert reports == [progress('extracting', 0), progress('extracting', 1), progress('extracting', 2), progress('extracting', 3),
                       progress('resolving', 3), progress('organizing', 3), progress('loading', 3)]


def test_failed_episodes_are_recorded_and_stop_the_job_before_resolving(reports, steps, monkeypatch):
    def extract(job_id, number):
        if number == 2:
            raise RuntimeError('SECRET 원고 본문')
        return {'n': number}
    monkeypatch.setattr(service, 'extract_episode', extract)
    service.run_job(REQUEST)
    assert reports[-1] == progress('extracting', 2, failed=[2], reason='회차 추출에 실패했어요.')
    assert progress('extracting', 2, failed=[2]) in reports  # 실패 회차 뒤에도 나머지 회차는 이어서 추출한다
    assert not [call for call in steps if call[0] in ('resolve', 'organize', 'load')]
    assert 'SECRET' not in json.dumps(reports, ensure_ascii=False)


def test_an_unexpected_error_in_a_later_step_fails_the_job_with_a_fixed_reason(reports, steps, monkeypatch):
    def organize(extractions, identities):
        raise ValueError('SECRET 원고 본문')
    monkeypatch.setattr(service, 'organize', organize)
    service.run_job(REQUEST)
    assert reports[-1] == progress('organizing', 3, reason='전처리 중 오류가 발생했어요.')
    assert 'load' not in [call[0] for call in steps]
    assert 'SECRET' not in json.dumps(reports, ensure_ascii=False)


def test_a_progress_report_the_content_service_refuses_stops_the_job_without_raising(steps, monkeypatch):
    seen = []

    def refuse(job_id, p):
        seen.append(p.stage)
        if len(seen) == 2:
            raise ReportFailure('Content가 진행 보고를 거절했습니다(409).')
    monkeypatch.setattr(service, 'report', refuse)
    service.run_job(REQUEST)  # 예외 없이 끝난다
    assert steps == [('extract', 1)]  # 보고할 수 없으면 더 진행하지 않는다


def test_a_failure_report_that_cannot_be_delivered_does_not_raise(monkeypatch):
    def refuse(job_id, p):
        raise ReportFailure('Content에 진행을 보고할 수 없습니다.')
    monkeypatch.setattr(service, 'report', refuse)
    service.run_job(REQUEST)


# ---- Content 진행 보고 호출 ----

def content(monkeypatch, status=200, error=None):
    monkeypatch.setenv('CONTENT_SERVICE_BASE_URL', 'http://content.test/')
    monkeypatch.setenv('INTERNAL_TOKEN', 't' * 32)
    seen = {}

    def post(url, **kwargs):
        seen.update(url=url, **kwargs)
        if error:
            raise error
        return httpx.Response(status, json={}, request=httpx.Request('POST', url))
    monkeypatch.setattr(service.httpx, 'post', post)
    return seen


def test_report_posts_the_progress_body_to_content_with_the_internal_token(monkeypatch):
    seen = content(monkeypatch)
    service.report('job-1', service.Progress(stage='extracting', done=1, total=3, failedEpisodes=[]))
    assert seen['url'] == 'http://content.test/internal/v1/preprocessing-jobs/job-1/progress'
    assert seen['headers'] == {'X-Internal-Token': 't' * 32}
    assert seen['json'] == {'stage': 'extracting', 'done': 1, 'total': 3, 'failedEpisodes': []}  # failed는 없을 때 싣지 않는다
    service.report('job-1', service.Progress(stage='extracting', done=1, total=3, failedEpisodes=[2], failed='사유'))
    assert seen['json']['failed'] == '사유' and seen['json']['failedEpisodes'] == [2]


@pytest.mark.parametrize('kwargs', [{'status': 409}, {'status': 500}, {'error': httpx.ConnectError('down')}],
                         ids=['refused', 'server-error', 'unreachable'])
def test_report_failures_are_explicit(monkeypatch, kwargs):
    content(monkeypatch, **kwargs)
    with pytest.raises(ReportFailure):
        service.report('job-1', service.Progress(stage='extracting', done=0, total=3, failedEpisodes=[]))


def test_report_without_content_settings_is_explicit(monkeypatch):
    monkeypatch.delenv('CONTENT_SERVICE_BASE_URL', raising=False)
    with pytest.raises(ReportFailure):
        service.report('job-1', service.Progress(stage='extracting', done=0, total=3, failedEpisodes=[]))


# ---- 추적 ----

def test_the_job_is_one_trace_tagged_as_the_preprocessing_feature_and_marked_failed(reports, spans):
    service.run_job(REQUEST)
    (root,) = spans()
    assert root.name == 'preprocessing'
    assert root.attributes['langfuse.observation.metadata.feature'] == 'preprocessing'
    assert json.loads(root.attributes['langfuse.observation.input']) == {'jobId': 'job-1', 'workId': 'work-1', 'episodes': 3}
    assert root.attributes['langfuse.observation.level'] == 'ERROR'
    assert root.attributes['langfuse.observation.status_message'] == '전처리 로직 미구현'


def test_a_finished_job_trace_has_no_error_level(reports, steps, spans):
    service.run_job(REQUEST)
    (root,) = spans()
    assert 'langfuse.observation.level' not in root.attributes
