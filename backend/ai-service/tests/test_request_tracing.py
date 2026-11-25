"""app/main.py의 모든 AI Router는 요청 하나를 trace 하나로 남긴다(DEC-55): 기능 태그·루트 상태·회원·작업 식별. 앱이 끝날 때는 남은 span을 보낸다."""

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException

from app import tracing
from app.generation import router as generation
from app.generation.errors import ProviderFailure
from app.generation.models import GenerationInput
from app.main import create_app
from app.initial_world import router as initial_world
from app.initial_world.errors import ExtractionFailure
from app.manuscript_review import router as manuscript_review
from app.manuscript_review.errors import ReviewFailure
from app.manuscript_review.models import ReviewRequest
from app.orchestration import service as orchestration
from app.rating import router as rating
from app.rating.errors import RatingFailure
from app.rating.models import RatingRequest
from app.research import router as research
from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest
from app.work_tags import router as work_tags
from app.work_tags.errors import SuggestionFailure
from app.world_review import router as world_review
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import FillRequest, WorldReviewRequest
from app.writing import router as writing
from app.writing.errors import WritingFailure
from app.writing.models import DraftRequest, PatchRequest

from traced import MEMBER, attrs, bearer, status_of

TOKEN = 'router-token'
ANALYSIS = UUID('0b1f6a52-3c1e-4b7a-9a58-2f6f0c1d4e10')
AUTHOR = bearer()
# (기능 키, 호출, 대체할 (객체, 속성), 그 기능의 실패)
CASES = {
    'proposals': (lambda auth='': generation.propose(GenerationInput(context={}, prompt='이어서'), TOKEN, auth), (generation.agent, 'generate'),
                  ProviderFailure()),
    'initial_world': (lambda auth='': initial_world.extract_initial_world(SimpleNamespace(analysisId=ANALYSIS), TOKEN, auth),
                      (initial_world, 'extract'), ExtractionFailure('MODEL_UNAVAILABLE', 503)),
    'manuscript_review': (lambda auth=AUTHOR: manuscript_review.review(ReviewRequest(workId='work-1', episode=3, check='mechanical'), TOKEN, auth),
                          (manuscript_review.service, 'review'), ReviewFailure(422, '검수할 초안이 없어요.')),
    'rating': (lambda auth=AUTHOR: rating.rate(RatingRequest(workId='work-1', episodes=[3]), TOKEN, auth), (rating.service, 'rate'),
               RatingFailure(502, '판별 실패')),
    'web_research': (lambda auth='': research.research(ResearchRequest(question='질문'), TOKEN, auth), (research.service, 'research'),
                     ResearchFailure(503, '웹 검색 실패')),
    'world_review': (lambda auth='': world_review.review(WorldReviewRequest(worldName='세계', worldDescription='', cards=[], relationships=[]),
                                                          TOKEN, auth),
                     (world_review.service, 'review'), WorldReviewFailure(502, '검토 실패')),
    'world_review/fill': (lambda auth='': world_review.fill(FillRequest(cardId='card-1', title='치삼', targets=['body'], passages=[{'episode': 2, 'text': '치삼이 왔다.'}]),
                                                             TOKEN, auth),
                          (world_review.service, 'fill'), WorldReviewFailure(502, '채우기 실패')),
    'work_tags': (lambda auth='': work_tags.suggest_work_tags(SimpleNamespace(), TOKEN, auth), (work_tags, 'suggest'),
                  SuggestionFailure(502, '추천 실패')),
    'writing_editing': (lambda auth='': writing.draft(DraftRequest(episodeNumber=1, plan='계획'), TOKEN, auth), (writing.agent, 'draft'),
                        WritingFailure(502, '집필 실패')),
    'writing_editing/patch': (lambda auth='': writing.patch(PatchRequest(selection='문장', instruction='고쳐'), TOKEN, auth), (writing.agent, 'patch'),
                              WritingFailure(502, '수정 실패')),
}


def prepare(monkeypatch, key, outcome):
    call, (owner, name), _ = CASES[key]
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)

    def serve(*_):
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(owner, name, serve)
    return call


@pytest.mark.parametrize('key', CASES)
def test_a_served_request_is_one_root_named_and_tagged_with_its_feature_and_marked_success(monkeypatch, spans, key):
    assert prepare(monkeypatch, key, 'ok')() == 'ok'
    [root] = spans()
    assert root.name == key.split('/')[0] and root.parent is None
    found = attrs(root)
    assert found['langfuse.trace.name'] == root.name and found['langfuse.trace.tags'] == [f'feature:{root.name}']
    assert status_of(root) == 'success' and found['langfuse.trace.metadata.fork'] == 'false'


@pytest.mark.parametrize('key', CASES)
def test_a_failed_request_is_marked_failed_on_its_root_and_keeps_its_http_error(monkeypatch, spans, key):
    failure = CASES[key][2]
    with pytest.raises(HTTPException) as error:
        prepare(monkeypatch, key, failure)()
    [root] = spans()
    assert attrs(root)['langfuse.trace.tags'] == [f'feature:{root.name}']
    assert status_of(root) == 'failed' and root.attributes['langfuse.observation.level'] == 'ERROR'
    assert error.value.status_code == getattr(failure, 'status', 503)  # 이어쓰기의 ProviderFailure는 상태 없이 503이다


@pytest.mark.parametrize('key', ['manuscript_review', 'rating'])
def test_the_author_bearer_and_work_identify_the_request(monkeypatch, spans, key):
    prepare(monkeypatch, key, 'ok')()
    [root] = spans()
    found = attrs(root)
    assert found['user.id'] == MEMBER and found['langfuse.trace.metadata.work_id'] == 'work-1'


def test_a_bearer_without_a_member_leaves_the_trace_anonymous(monkeypatch, spans):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    monkeypatch.setattr(manuscript_review.service, 'review', lambda data: 'ok')
    manuscript_review.review(ReviewRequest(workId='work-1', episode=3, check='mechanical'), TOKEN, '')
    [root] = spans()
    assert 'user.id' not in root.attributes


def test_the_initial_analysis_id_is_the_job_id_of_the_trace(monkeypatch, spans):
    prepare(monkeypatch, 'initial_world', 'ok')()
    [root] = spans()
    assert attrs(root)['session.id'] == str(ANALYSIS)


def test_a_wrong_internal_token_is_refused_before_anything_is_traced(monkeypatch, spans):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    with pytest.raises(HTTPException):
        manuscript_review.review(ReviewRequest(workId='work-1', episode=3, check='mechanical'), 'wrong', AUTHOR)
    assert spans() == ()


# 작가 Bearer(X-User-Authorization)는 모든 추적 Router가 선택으로 받는다. 검수·심의·오케스트레이션은 MCP에도 쓰고, 나머지는 회원 식별에만 쓴다.
UNAUTHENTICATED = [key for key in CASES if key not in ('manuscript_review', 'rating')]


@pytest.mark.parametrize('key', UNAUTHENTICATED)
def test_the_optional_author_bearer_identifies_the_request_of_routes_that_had_no_member(monkeypatch, spans, key):
    prepare(monkeypatch, key, 'ok')(AUTHOR)
    [root] = spans()
    assert attrs(root)['user.id'] == MEMBER


@pytest.mark.parametrize('authorization', ['', 'Bearer not-a-jwt'])
@pytest.mark.parametrize('key', UNAUTHENTICATED)
def test_without_a_usable_bearer_the_request_is_served_and_the_trace_stays_anonymous(monkeypatch, spans, key, authorization):
    assert prepare(monkeypatch, key, 'ok')(authorization) == 'ok'  # 헤더가 없거나 읽을 수 없어도 오류가 아니다
    [root] = spans()
    assert 'user.id' not in root.attributes


TRACED_PATHS = ['/internal/v1/proposals', '/internal/v1/initial-world/extractions', '/internal/v1/research/web', '/internal/v1/world-reviews',
                '/internal/v1/world-reviews/fill',
                '/internal/v1/writing/drafts', '/internal/v1/writing/patches', '/internal/v1/work-tags/suggestions',
                '/internal/v1/manuscript-reviews', '/internal/v1/ratings', '/internal/v1/orchestrations', '/internal/v1/orchestrations/stream']


def test_every_traced_route_declares_the_optional_author_bearer_header():
    spec = create_app().openapi()
    for path in TRACED_PATHS:
        header = next((p for p in spec['paths'][path]['post'].get('parameters', []) if p['name'] == 'x-user-authorization'), None)
        assert header is not None and header['in'] == 'header' and not header['required'], path


def test_closing_the_app_sends_the_spans_that_are_still_waiting_in_the_batch(monkeypatch):
    """SDK의 atexit 전송은 uvicorn의 SIGTERM 종료에서 돌지 않는다(이유는 app/main.py lifespan). 앱 종료가 직접 남은 span을 보낸다."""
    flushed = []
    monkeypatch.delenv('AI_CHECKPOINT_DATABASE_URL', raising=False)
    monkeypatch.setattr(tracing, 'client', lambda: SimpleNamespace(flush=lambda: flushed.append(True)))
    application = create_app()

    async def serve():
        async with application.router.lifespan_context(application):
            assert flushed == []  # 요청을 받는 동안에는 보내지 않는다(SDK 주기에 맡긴다)

    asyncio.run(serve())

    assert flushed == [True]


def test_a_failure_while_closing_still_sends_the_waiting_spans(monkeypatch):
    flushed = []
    monkeypatch.setattr(tracing, 'client', lambda: SimpleNamespace(flush=lambda: flushed.append(True)))

    @asynccontextmanager
    async def checkpoint_connection_fails_to_close(_app):
        yield
        raise RuntimeError('체크포인트 연결 종료 실패')

    monkeypatch.setattr(orchestration, 'lifespan', checkpoint_connection_fails_to_close)
    application = create_app()

    async def serve():
        async with application.router.lifespan_context(application):
            pass

    with pytest.raises(RuntimeError):
        asyncio.run(serve())

    assert flushed == [True]
