import json

import pytest

from app.content_mcp.errors import ContentMcpFailure
from app.story_qa import service
from app.story_qa.errors import StoryQaFailure
from app.story_qa.models import AnswerRequest, Claim, EmbeddingRequest, Excerpt


def test_embedding_preserves_prefix_and_vector_order(monkeypatch):
    vectors = [[0.01] * 384, [0.02] * 384]

    class Encoder:
        def encode(self, texts):
            assert texts == ['passage: 첫 문단', 'passage: 둘째 문단']
            return vectors

    monkeypatch.setattr(service, 'get_encoder', Encoder)
    response = service.embed(EmbeddingRequest(texts=['첫 문단', '둘째 문단'], kind='passage'))
    assert response.model == 'intfloat/multilingual-e5-small'
    assert response.vectors == vectors


def test_embedding_input_over_token_limit_is_422(monkeypatch):
    class Encoder:
        def encode(self, texts):
            raise ValueError('E5 input exceeds 512 tokens')

    monkeypatch.setattr(service, 'get_encoder', Encoder)
    with pytest.raises(StoryQaFailure) as error:
        service.embed(EmbeddingRequest(texts=['긴 질문'], kind='query'))
    assert error.value.status == 422


def test_embedding_model_unavailable_is_an_explicit_error(monkeypatch):
    monkeypatch.delenv('MANUSCRIPT_EMBEDDING_MODEL_DIR', raising=False)
    service.get_encoder.cache_clear()
    with pytest.raises(StoryQaFailure) as error:
        service.embed(EmbeddingRequest(texts=['질문'], kind='query'))
    assert error.value.status == 503


def answer_with(monkeypatch, claims):
    """모델 대역. claims의 sourceIds는 모델이 보는 별칭(e1·e2…)이다."""
    from app.story_qa.models import AnswerResponse
    monkeypatch.setattr(service.agent, 'answer', lambda data: AnswerResponse(claims=claims, gaps=[]))
    return AnswerRequest(question='누구?', excerpts=[Excerpt(id='a', episode=1, quote='원문')])


def test_model_cites_short_aliases_and_answer_returns_the_real_ids(monkeypatch):
    """긴 UUID를 모델이 옮겨 적다 한 글자씩 틀려 502가 났다(#548). 모델에는 e1·e2… 별칭만 보이고 답은 실제 id로 돌아온다."""
    from app.story_qa.models import AnswerResponse
    card, relation = 'card:aff97912-9452-5e5a-8920-68d92da24865', 'relation:dc15545b-41a5-5888-a6bb-e28019c6d4b3'
    seen = {}

    def fake(data):
        seen['ids'] = [e.id for e in data.excerpts]
        return AnswerResponse(claims=[Claim(text='스승', kind='confirmed', sourceIds=['e2', 'e1'])], gaps=[])

    monkeypatch.setattr(service.agent, 'answer', fake)
    data = AnswerRequest(question='누구?', excerpts=[Excerpt(id=card, episode=1, quote='카드', kind='setting'),
                                                     Excerpt(id=relation, episode=1, quote='관계', kind='relationship')])
    assert service.answer(data).claims[0].sourceIds == [relation, card]
    assert seen['ids'] == ['e1', 'e2']


def test_answer_keeps_claims_cited_from_given_excerpts(monkeypatch):
    data = answer_with(monkeypatch, [Claim(text='홍길동', kind='confirmed', sourceIds=['e1'])])
    assert service.answer(data).claims[0].sourceIds == ['a']


@pytest.mark.parametrize('ids', [[], ['other']])
def test_answer_with_unknown_or_missing_citation_is_502(monkeypatch, ids):
    data = answer_with(monkeypatch, [Claim(text='홍길동', kind='confirmed', sourceIds=ids)])
    with pytest.raises(StoryQaFailure) as error:
        service.answer(data)
    assert (error.value.status, error.value.retry) == (502, 'output')


def attrs(span):
    """span 속성. Langfuse가 JSON 문자열로 담는 input/output/metadata는 읽을 수 있게 풀어 둔다."""
    return {k: json.loads(v) if k.startswith('langfuse.observation.') and isinstance(v, str) and v[:1] in '[{"' else v
            for k, v in span.attributes.items()}


def test_answer_trace_has_question_manuscript_and_answer_bodies_but_no_setting_text(monkeypatch, spans):
    data = answer_with(monkeypatch, [Claim(text='홍길동', kind='confirmed', sourceIds=['e1'])])
    data.excerpts.append(Excerpt(id='s', episode=1, quote='비공개 설정 본문', kind='setting', title='설정 제목'))
    service.answer(data)
    retrieval, check, qa = spans()
    assert (retrieval.name, check.name, qa.name) == ('retrieval', 'evidence_check', 'story_context.qa')
    assert retrieval.parent.span_id == qa.context.span_id == check.parent.span_id
    assert attrs(check)['langfuse.observation.metadata.citedIds'] == ['a']
    # 팀 결정(2026-11-13): 질문·원고·답변 본문은 추적한다. 설정·관계 본문은 결정 범위 밖이라 참조만 남긴다.
    assert attrs(retrieval)['langfuse.observation.output'] == [
        {'id': 'a', 'episode': 1, 'kind': 'manuscript', 'quote': '원문'}, {'id': 's', 'episode': 1, 'kind': 'setting'}]
    assert attrs(qa)['langfuse.observation.input'] == {'question': '누구?'}
    assert attrs(qa)['langfuse.observation.output']['claims'][0]['text'] == '홍길동'
    assert not any(text in str(attrs(s)) for s in (retrieval, check, qa) for text in ('비공개 설정 본문', '설정 제목'))


def test_invalid_citation_is_traced_as_error_and_still_fails(monkeypatch, spans):
    data = answer_with(monkeypatch, [Claim(text='홍길동', kind='confirmed', sourceIds=['other'])])
    with pytest.raises(StoryQaFailure):
        service.answer(data)
    _, check, qa = spans()
    assert attrs(check)['langfuse.observation.level'] == 'ERROR'
    assert attrs(check)['langfuse.observation.metadata.invalidIds'] == ['other']
    assert attrs(qa)['langfuse.observation.level'] == 'ERROR'


def test_image_bakes_the_pinned_model_files_and_manuscript_extra():
    from pathlib import Path

    dockerfile = (Path(__file__).resolve().parents[2] / 'Dockerfile').read_text(encoding='utf-8')
    assert dockerfile.count('--extra manuscript') == 2
    for name, digest in service.FILES.items():
        url = f'https://huggingface.co/{service.MODEL}/resolve/{service.REVISION}/onnx/{name}'
        assert f'--checksum=sha256:{digest} {url}' in dockerfile
    assert 'MANUSCRIPT_EMBEDDING_MODEL_DIR=' in dockerfile


# --- 세계관 근거(#490): Content MCP로 기준 회차 시점의 WorldStudio 카드·관계를 읽는다 ---

WORK = 'work-1'
WORLD = {
    'worldId': 'world-1',
    'cards': [
        {'id': 'seoyun', 'cardType': 'character', 'title': '서윤', 'body': '29세 기록관.',
         'semanticMetadata': {'characterDocs': {'soul': '말수가 적다.', 'goal': '', 'episodes': {'2': '편지를 받았다.', '5': '비밀을 안다.'}}}},
        {'id': 'guild', 'cardType': 'organization', 'title': '길드', 'body': '밤에 문을 닫는다.'},
        {'id': 'secret', 'cardType': 'event', 'title': '숨은 결말', 'body': '7화에 밝혀진다.', 'semanticMetadata': {'revealFromEpisode': 7}},
    ],
    'relationships': [
        {'id': 'r1', 'sourceCardId': 'seoyun', 'targetCardId': 'guild', 'label': '소속'},
        {'id': 'r2', 'sourceCardId': 'seoyun', 'targetCardId': 'secret', 'label': '모른다'},
    ],
}
NO_INHERITED = {'workId': WORK, 'worldId': None, 'upto': 0, 'cards': [], 'relationships': [], 'relationshipStatus': 'current'}


def fake_world(monkeypatch, world=WORLD, linked=WORK, inherited=NO_INHERITED, fail=None):
    """Content MCP 대역. 호출한 도구 이름과 인자 목록을 돌려준다. fail은 {도구: 던질 예외}."""
    calls = []

    def call(tool, arguments):
        calls.append((tool, arguments))
        if tool in (fail or {}):
            raise fail[tool]
        return {'world_studio_list': [{'worldId': 'world-1', 'linkedWorkId': linked}],
                'world_studio_read': world, 'work_inherited_world': inherited}[tool]

    monkeypatch.setattr(service.content_mcp, 'call', call)
    return calls


def test_world_excerpts_read_the_linked_world_at_the_basis_episode(monkeypatch):
    calls = fake_world(monkeypatch)
    excerpts, gaps = service.world_excerpts(WORK, 3, '서윤은 어디 소속?')
    assert calls == [('world_studio_list', {}), ('world_studio_read', {'id': 'world-1', 'episode': '3'})]
    assert gaps == []
    assert [(e.id, e.kind, e.episode, e.title) for e in excerpts] == [
        ('card:seoyun', 'setting', 3, '서윤'), ('card:guild', 'setting', 3, '길드'), ('relation:r1', 'relationship', 3, '서윤 → 길드')]


def test_world_excerpts_drop_cards_memories_and_relations_revealed_after_the_basis_episode(monkeypatch):
    fake_world(monkeypatch)
    excerpts, _ = service.world_excerpts(WORK, 3, '서윤')
    quotes = {e.id: e.quote for e in excerpts}
    assert 'card:secret' not in quotes and 'relation:r2' not in quotes  # 7화 공개 카드와 그 카드에 이어진 관계
    assert '편지를 받았다.' in quotes['card:seoyun'] and '비밀을 안다.' not in quotes['card:seoyun']  # 5화 기억


def test_fork_without_its_own_world_reads_the_inherited_original_world(monkeypatch):
    inherited = {**NO_INHERITED, 'worldId': 'world-1', 'upto': 3, 'cards': [WORLD['cards'][1]]}
    calls = fake_world(monkeypatch, linked='other-work', inherited=inherited)
    excerpts, gaps = service.world_excerpts(WORK, 3, '길드')
    assert calls[-1] == ('work_inherited_world', {'id': WORK, 'upto': '3'})
    assert [e.id for e in excerpts] == ['card:guild'] and gaps == []


def test_without_linked_or_inherited_world_there_is_no_world_evidence_but_a_gap(monkeypatch):
    fake_world(monkeypatch, linked='other-work')
    assert service.world_excerpts(WORK, 3, '길드') == ([], [service.NO_WORLD])


def test_world_without_visible_settings_is_a_gap(monkeypatch):
    fake_world(monkeypatch, world={**WORLD, 'cards': [WORLD['cards'][2]], 'relationships': []})
    assert service.world_excerpts(WORK, 3, '결말') == ([], [service.NO_SETTINGS])


def test_large_world_sends_only_the_cards_that_match_the_question(monkeypatch):
    cards = [{'id': f'c{i}', 'cardType': 'object', 'title': f'물건{i}', 'body': '평범한 물건.'} for i in range(service.WORLD_EXCERPTS)]
    cards.append({'id': 'sword', 'cardType': 'object', 'title': '달빛 검', 'body': '왕가의 검.'})
    fake_world(monkeypatch, world={**WORLD, 'cards': cards, 'relationships': []})
    excerpts, _ = service.world_excerpts(WORK, 3, '달빛 검은 누구 것?')
    assert excerpts[0].id == 'card:sword' and len(excerpts) <= service.WORLD_EXCERPTS


def test_long_card_is_cut_to_the_quote_limit(monkeypatch):
    fake_world(monkeypatch, world={**WORLD, 'cards': [{'id': 'g', 'cardType': 'rule', 'title': '규칙', 'body': '가' * 5000}], 'relationships': []})
    excerpts, _ = service.world_excerpts(WORK, 3, '규칙')
    assert len(excerpts[0].quote) == service.QUOTE_LIMIT


def test_world_read_failure_is_not_hidden(monkeypatch):
    fake_world(monkeypatch, fail={'world_studio_read': ContentMcpFailure(503, '관계 저장이 끝나지 않았어요.')})
    with pytest.raises(ContentMcpFailure) as error:
        service.world_excerpts(WORK, 3, '길드')
    assert error.value.status == 503


@pytest.mark.parametrize('world, failure', [(None, ContentMcpFailure), ({'worldId': 'world-1', 'cards': [{'id': 'c'}]}, StoryQaFailure)])
def test_malformed_world_read_is_502_not_a_missing_world(monkeypatch, world, failure):
    fake_world(monkeypatch, world=world)
    with pytest.raises(failure) as error:
        service.world_excerpts(WORK, 3, '길드')
    assert error.value.status == 502


def test_world_read_is_traced_with_references_but_no_card_text(monkeypatch, spans):
    fake_world(monkeypatch)
    service.world_excerpts(WORK, 3, '길드')
    traced = attrs(next(s for s in spans() if s.name == 'world_read'))
    assert [e['id'] for e in traced['langfuse.observation.output']] == ['card:seoyun', 'card:guild', 'relation:r1']
    assert '29세 기록관.' not in json.dumps(traced, ensure_ascii=False)
