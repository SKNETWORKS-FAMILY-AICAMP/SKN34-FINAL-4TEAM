"""app/main.py의 모든 AI Router는 요청 하나를 trace 하나로 남긴다(DEC-55): 기능 태그·상태 태그·회원·작업 식별."""

from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.generation import router as generation
from app.generation.errors import ProviderFailure
from app.generation.models import GenerationInput
from app.initial_world import router as initial_world
from app.initial_world.errors import ExtractionFailure
from app.rating import router as rating
from app.rating.errors import RatingFailure
from app.rating.models import RatingRequest
from app.research import router as research
from app.research.errors import ResearchFailure
from app.research.models import ResearchRequest
from app.review import router as review
from app.review.errors import ReviewFailure
from app.review.models import ReviewRequest
from app.story_qa import router as story_qa
from app.story_qa.errors import StoryQaFailure
from app.story_qa.models import AnswerRequest, Excerpt
from app.work_tags import router as work_tags
from app.work_tags.errors import SuggestionFailure
from app.world_review import router as world_review
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import WorldReviewRequest
from app.writing import router as writing
from app.writing.errors import WritingFailure
from app.writing.models import DraftRequest, PatchRequest

from traced import MEMBER, attrs, bearer

TOKEN = 'router-token'
ANALYSIS = UUID('0b1f6a52-3c1e-4b7a-9a58-2f6f0c1d4e10')
AUTHOR = bearer()
# (기능 키, 호출, 대체할 (객체, 속성), 그 기능의 실패)
CASES = {
    'proposals': (lambda: generation.propose(GenerationInput(context={}, prompt='이어서'), TOKEN), (generation.agent, 'generate'), ProviderFailure()),
    'initial_world': (lambda: initial_world.extract_initial_world(SimpleNamespace(analysisId=ANALYSIS), TOKEN), (initial_world, 'extract'),
                      ExtractionFailure('MODEL_UNAVAILABLE', 503)),
    'story_context': (lambda: story_qa.answer(AnswerRequest(question='누구?', excerpts=[Excerpt(id='a', episode=1, quote='원문')]), TOKEN),
                      (story_qa.service, 'answer'), StoryQaFailure(502, '출처 확인 실패')),
    'review': (lambda: review.review(ReviewRequest(workId='work-1', episode=3, check='mechanical'), TOKEN, AUTHOR),
               (review.service, 'review'), ReviewFailure(422, '검수할 초안이 없어요.')),
    'rating': (lambda: rating.rate(RatingRequest(workId='work-1', episodes=[3]), TOKEN, AUTHOR), (rating.service, 'rate'),
               RatingFailure(502, '판별 실패')),
    'web_research': (lambda: research.research(ResearchRequest(question='질문'), TOKEN), (research.service, 'research'),
                     ResearchFailure(503, '웹 검색 실패')),
    'world_review': (lambda: world_review.review(WorldReviewRequest(worldName='세계', worldDescription='', cards=[], relationships=[]), TOKEN),
                     (world_review.service, 'review'), WorldReviewFailure(502, '검토 실패')),
    'work_tags': (lambda: work_tags.suggest_work_tags(SimpleNamespace(), TOKEN), (work_tags, 'suggest'), SuggestionFailure(502, '추천 실패')),
    'writing_editing': (lambda: writing.draft(DraftRequest(episodeNumber=1, plan='계획'), TOKEN), (writing.agent, 'draft'), WritingFailure(502, '집필 실패')),
    'writing_editing/patch': (lambda: writing.patch(PatchRequest(selection='문장', instruction='고쳐'), TOKEN), (writing.agent, 'patch'),
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
def test_a_served_request_is_one_trace_tagged_with_its_feature_and_success(monkeypatch, spans, key):
    assert prepare(monkeypatch, key, 'ok')() == 'ok'
    [root] = spans()
    assert root.name == key.split('/')[0]
    assert attrs(root)['langfuse.trace.tags'] == [f'feature:{root.name}', 'status:success']


@pytest.mark.parametrize('key', CASES)
def test_a_failed_request_is_tagged_failed_and_keeps_its_http_error(monkeypatch, spans, key):
    failure = CASES[key][2]
    with pytest.raises(HTTPException) as error:
        prepare(monkeypatch, key, failure)()
    [root] = spans()
    assert attrs(root)['langfuse.trace.tags'] == [f'feature:{root.name}', 'status:failed']
    assert root.attributes['langfuse.observation.level'] == 'ERROR'
    assert error.value.status_code == getattr(failure, 'status', 503)  # 이어쓰기의 ProviderFailure는 상태 없이 503이다


@pytest.mark.parametrize('key', ['review', 'rating'])
def test_the_author_bearer_and_work_identify_the_request(monkeypatch, spans, key):
    prepare(monkeypatch, key, 'ok')()
    [root] = spans()
    found = attrs(root)
    assert found['user.id'] == MEMBER and found['langfuse.trace.metadata.work_id'] == 'work-1'


def test_a_bearer_without_a_member_leaves_the_trace_anonymous(monkeypatch, spans):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    monkeypatch.setattr(review.service, 'review', lambda data: 'ok')
    review.review(ReviewRequest(workId='work-1', episode=3, check='mechanical'), TOKEN, '')
    [root] = spans()
    assert 'user.id' not in root.attributes


def test_the_initial_analysis_id_is_the_job_id_of_the_trace(monkeypatch, spans):
    prepare(monkeypatch, 'initial_world', 'ok')()
    [root] = spans()
    assert attrs(root)['session.id'] == str(ANALYSIS)


def test_a_wrong_internal_token_is_refused_before_anything_is_traced(monkeypatch, spans):
    monkeypatch.setenv('INTERNAL_TOKEN', TOKEN)
    with pytest.raises(HTTPException):
        review.review(ReviewRequest(workId='work-1', episode=3, check='mechanical'), 'wrong', AUTHOR)
    assert spans() == ()
