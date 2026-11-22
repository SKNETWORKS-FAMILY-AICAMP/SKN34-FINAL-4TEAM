"""#343 전처리 접수 요청 DTO. 계약 본문만 받고 URL 경로에 들어갈 작업 ID는 안전한 문자만 허용한다."""
import pytest
from pydantic import ValidationError

from app.preprocessing.models import JobRequest

JOB = {'jobId': '3f2b9c1e-0000-4000-8000-000000000001', 'workId': 'work-1', 'episodes': [1, 2, 5]}


def test_job_request_accepts_the_contract_body():
    request = JobRequest.model_validate(JOB)
    assert (request.jobId, request.workId, request.episodes) == (JOB['jobId'], 'work-1', [1, 2, 5])


@pytest.mark.parametrize('change', [
    {'jobId': ''}, {'jobId': 'a/../b'}, {'jobId': 'a b'}, {'workId': ''},
    {'episodes': []}, {'episodes': [0]}, {'episodes': [1, 1]}, {'episodes': [True]}, {'episodes': ['1']},
    {'episodes': list(range(1, 5002))}, {'extra': 1},
], ids=['empty-job', 'path-job', 'space-job', 'empty-work', 'no-episodes', 'episode-zero', 'duplicate', 'bool', 'string',
        'too-many', 'unknown-field'])
def test_job_request_rejects_malformed_bodies(change):
    with pytest.raises(ValidationError):
        JobRequest.model_validate({**JOB, **change})


def test_job_request_requires_every_field():
    for key in JOB:
        with pytest.raises(ValidationError):
            JobRequest.model_validate({k: v for k, v in JOB.items() if k != key})
