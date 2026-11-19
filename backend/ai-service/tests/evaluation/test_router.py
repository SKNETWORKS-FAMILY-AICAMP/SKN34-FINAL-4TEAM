from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.evaluation import router
from app.evaluation.errors import EvaluationFailure
from app.evaluation.models import EvaluationAccepted, LeakCheckRequest, LeakCheckResponse

from .stubs import QA_REQUEST

LEAK = LeakCheckRequest(response='응답', references=['비공개 카드'])


@pytest.fixture(autouse=True)
def token(monkeypatch):
    monkeypatch.setenv('INTERNAL_TOKEN', 'eval-token')


def test_wrong_token_is_403_on_both_routes():
    for call in (lambda: router.start(QA_REQUEST, BackgroundTasks(), 'wrong-token'), lambda: router.leak_check(LEAK, 'wrong-token')):
        with pytest.raises(HTTPException) as error:
            call()
        assert error.value.status_code == 403


def test_start_answers_with_the_run_name_and_runs_the_plan_in_the_background(monkeypatch):
    plan = SimpleNamespace(run_name='qa.answer@v3-20261119T000000Z-abcdef')
    monkeypatch.setattr(router.service, 'prepare', lambda data: plan if data == QA_REQUEST else None)
    background = BackgroundTasks()

    assert router.start(QA_REQUEST, background, 'eval-token') == EvaluationAccepted(runName=plan.run_name)

    [task] = background.tasks
    assert (task.func, task.args) == (router.service.run, (plan,))


def test_a_rejected_evaluation_keeps_status_and_message_and_starts_nothing(monkeypatch):
    def reject(_):
        raise EvaluationFailure(404, '평가 세트를 찾을 수 없어요.')
    monkeypatch.setattr(router.service, 'prepare', reject)
    background = BackgroundTasks()

    with pytest.raises(HTTPException) as error:
        router.start(QA_REQUEST, background, 'eval-token')

    assert (error.value.status_code, error.value.detail) == (404, '평가 세트를 찾을 수 없어요.') and background.tasks == []


def test_leak_check_returns_the_result_or_the_failure_status(monkeypatch):
    monkeypatch.setattr(router.service, 'leak_check', lambda data: LeakCheckResponse(suspected=True, reason='근거') if data == LEAK else None)
    assert router.leak_check(LEAK, 'eval-token') == LeakCheckResponse(suspected=True, reason='근거')

    def fail(_):
        raise EvaluationFailure(503, '평가 모델 설정이 필요합니다.')
    monkeypatch.setattr(router.service, 'leak_check', fail)
    with pytest.raises(HTTPException) as error:
        router.leak_check(LEAK, 'eval-token')
    assert (error.value.status_code, error.value.detail) == (503, '평가 모델 설정이 필요합니다.')
