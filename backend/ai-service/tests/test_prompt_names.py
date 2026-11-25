"""기능별 프롬프트 이름(Langfuse Prompt Management, <기능>.<용도>)과 코드 기본값. 이름은 운영 화면의 프롬프트 목록이 된다."""

import pytest

from app import agent_runtime
from app.manuscript_review import agent as manuscript_review
from app.manuscript_review.prompt import INSTRUCTIONS as MANUSCRIPT_REVIEW
from app.rating import agent as rating
from app.rating.prompt import INSTRUCTIONS as RATING
from app.research import agent as research
from app.research.models import ResearchRequest
from app.research.prompt import PICK_INSTRUCTIONS, REFER_INSTRUCTIONS, RESEARCH_INSTRUCTIONS
from app.story_qa import agent as story_qa
from app.story_qa.models import AnswerRequest, Excerpt
from app.story_qa.prompt import QA_INSTRUCTIONS
from app.work_tags import agent as work_tags
from app.work_tags.models import Input as WorkTagsInput
from app.work_tags.prompt import INSTRUCTIONS as WORK_TAGS
from app.world_review import agent as world_review
from app.world_review.models import FillRequest, WorldReviewRequest
from app.world_review.prompt import ENRICH_INSTRUCTIONS, FILL_INSTRUCTIONS, IMPACT_INSTRUCTIONS, INSTRUCTIONS as WORLD_REVIEW
from app.writing import agent as writing
from app.writing.models import DraftRequest, PatchRequest, PlanBrief, PlanPickRequest, PlanRequest, PlanReviseRequest
from app.writing.prompt import (DRAFT_INSTRUCTIONS, PATCH_INSTRUCTIONS, PICK_PLAN_INSTRUCTIONS, PLAN_INSTRUCTIONS,
                                REVISE_PLAN_INSTRUCTIONS)

EPISODE = {'title': '3화', 'authorNote': None, 'draft': '본문', 'characters': [], 'signals': {}}
WORLD = WorldReviewRequest(worldName='세계', worldDescription='', cards=[], relationships=[])
FILL = FillRequest(cardId='card-1', title='치삼', targets=['body'], passages=[{'episode': 2, 'text': '치삼이 왔다.'}])
TAGS = {'schemaVersion': 'work-tags.v1', 'title': '작품', 'description': '', 'allowedGenres': ['판타지'], 'maxGenres': 1, 'maxHashtags': 1,
        'episodes': [{'number': 1, 'title': '', 'text': '본문'}]}

BRIEF = PlanBrief(id='p', kind='plot', title='복수극')
CASES = [
    (lambda: story_qa.answer(AnswerRequest(question='누구?', excerpts=[Excerpt(id='a', episode=1, quote='원문')])), 'story_context.answer', QA_INSTRUCTIONS),
    (lambda: manuscript_review.review('mechanical', '본문', []), 'manuscript_review.mechanical', MANUSCRIPT_REVIEW['mechanical']),
    (lambda: manuscript_review.review('semantic', '본문', []), 'manuscript_review.semantic', MANUSCRIPT_REVIEW['semantic']),
    (lambda: writing.plan(PlanRequest(episodeNumber=1, request='기획')), 'writing_editing.plan', PLAN_INSTRUCTIONS),
    (lambda: writing.draft(DraftRequest(episodeNumber=1, plan='계획')), 'writing_editing.draft', DRAFT_INSTRUCTIONS),
    (lambda: writing.patch(PatchRequest(selection='문장', instruction='고쳐')), 'writing_editing.patch', PATCH_INSTRUCTIONS),
    (lambda: writing.pick_plan(PlanPickRequest(request='고쳐', plans=[BRIEF])), 'writing_editing.plan_pick', PICK_PLAN_INSTRUCTIONS),
    (lambda: writing.revise_plan(PlanReviseRequest(request='고쳐', plan=BRIEF, content='내용', revision=1)), 'writing_editing.plan_revise',
     REVISE_PLAN_INSTRUCTIONS),
    (lambda: rating.rate(EPISODE), 'rating.assess', RATING),
    (lambda: research.search(ResearchRequest(question='질문')), 'web_research.search', RESEARCH_INSTRUCTIONS),
    (lambda: research.pick('요청', []), 'research.pick', PICK_INSTRUCTIONS),
    (lambda: research.refer('요청', []), 'research.refer', REFER_INSTRUCTIONS),
    (lambda: world_review.review(WORLD), 'world_review.check', WORLD_REVIEW),
    (lambda: world_review.enrich('인물을 보강해줘', WORLD), 'world_review.enrich', ENRICH_INSTRUCTIONS),
    (lambda: world_review.impact('나이를 바꾸면?', WORLD, {}, []), 'world_review.impact', IMPACT_INSTRUCTIONS),
    (lambda: world_review.fill(FILL), 'world_review.fill', FILL_INSTRUCTIONS),
    (lambda: work_tags.propose(WorkTagsInput.model_validate(TAGS)), 'work_tags.suggest', WORK_TAGS),
]


class Stop(Exception):
    pass


@pytest.mark.parametrize('call, name, default', CASES, ids=[case[1] for case in CASES])
def test_each_agent_asks_its_prompt_by_name_with_the_code_text_as_the_seed(monkeypatch, call, name, default):
    seen = []

    def run(label, korean, failure, instructions, data, *, prompt_name, **kwargs):
        seen.append((prompt_name, instructions))
        raise Stop

    monkeypatch.setattr(agent_runtime, 'run', run)
    with pytest.raises(Stop):
        call()
    assert seen == [(name, default)]
