import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.review import router
from app.review.models import ReviewResponse

from traced import MEMBER, attrs, bearer

pytestmark = pytest.mark.integration


def test_review_route_is_one_request_trace_of_the_author(monkeypatch, spans):
    monkeypatch.setenv('INTERNAL_TOKEN', 'review-token')
    monkeypatch.setattr(router.service, 'review', lambda data: ReviewResponse(
        workId=data.workId, episode=data.episode, revision=4, check='mechanical', findings=[], gaps=[], model='m',
        providerResponseId='resp-1', usage=None))
    response = TestClient(create_app()).post(
        '/internal/v1/reviews', headers={'X-Internal-Token': 'review-token', 'X-User-Authorization': bearer()},
        json={'workId': 'work-1', 'episode': 3, 'check': 'mechanical'})
    assert response.status_code == 200
    [root] = spans()  # 동기 핸들러는 스레드풀에서 돌지만 요청 루트와 속성은 같다
    found = attrs(root)
    assert root.name == 'review' and found['user.id'] == MEMBER and found['langfuse.trace.metadata.work_id'] == 'work-1'
    assert found['langfuse.trace.tags'] == ['feature:review', 'status:success']
