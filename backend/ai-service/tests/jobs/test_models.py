"""POST /internal/v1/jobs 요청 DTO. runId는 운영 호출 경로에 들어가므로 경로 문자를 허용하지 않는다."""
import pytest
from pydantic import ValidationError

from app.jobs.models import JobRunRequest

RUN_ID = '3f2b8c1e-9d4a-4e6b-8a57-1c0d2e3f4a5b'


def test_accepts_an_operations_run_id_and_a_snake_case_kind():
    request = JobRunRequest(runId=RUN_ID, kind='regression_eval')
    assert (request.runId, request.kind) == (RUN_ID, 'regression_eval')


@pytest.mark.parametrize('body', [
    {'runId': '', 'kind': 'alert_cleanup'}, {'runId': 'a/b', 'kind': 'alert_cleanup'}, {'runId': '../x', 'kind': 'alert_cleanup'},
    {'runId': 'a?b', 'kind': 'alert_cleanup'}, {'runId': 'r' * 65, 'kind': 'alert_cleanup'},
    {'runId': RUN_ID, 'kind': ''}, {'runId': RUN_ID, 'kind': 'Alert'}, {'runId': RUN_ID, 'kind': 'alert-cleanup'}, {'runId': RUN_ID, 'kind': '1alert'},
    {'runId': RUN_ID, 'kind': 'k' * 65}, {'runId': RUN_ID}, {'kind': 'alert_cleanup'},
    {'runId': RUN_ID, 'kind': 'alert_cleanup', 'extra': 1},
])
def test_rejects_a_run_id_that_is_not_path_safe_a_malformed_kind_or_unknown_fields(body):
    with pytest.raises(ValidationError):
        JobRunRequest(**body)
