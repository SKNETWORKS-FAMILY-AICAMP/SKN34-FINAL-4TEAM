"""파이프라인 평가 ① 실행(pipe_build): 서비스의 extract→resolve→organize를 캐시와 함께 돌리고 그 결과가 시뮬레이션 입력이 되는지, LLM 호출 장부·상한·예상."""

import json
from types import SimpleNamespace

import pytest

import orig_run as rn
import pipe_build as pb
import pipe_world as pw
from app.manuscript_extraction import agent, prompt
from app.manuscript_extraction.errors import PreprocessingFailure
from app.manuscript_extraction.models import Mention, ProposedExtraction, ProposedRelation, ProposedResolution, Statement
from cost import CostLog
from llm import CallCapExceeded

WORK = {'id': 'w', 'episodes': [{'number': 1, 'title': '', 'text': '김 첨지는 인력거꾼이다. 그는 성미가 급하다. 비가 추적추적 내렸다.'},
                                {'number': 2, 'title': '', 'text': '김 첨지는 치삼과 술을 마셨다. 치삼은 오래된 친구였다.'}]}


def statement(id, kind, document, subjects, quote, knowers=(), occurred=None, known=1):
    certainty = {'plan': 'intended', 'goal': 'intended', 'conjecture': 'uncertain'}.get(kind, 'asserted')
    return Statement(id=id, kind=kind, certainty=certainty, subjects=subjects, knowers=list(knowers), document=document, occurredEpisode=occurred, knownFromEpisode=known, quote=quote)


def proposal(number: int) -> ProposedExtraction:
    """모델 응답 대역: 회차마다 원문에서 그대로 베낀 인용으로 대상·진술·관계를 낸다."""
    if number == 1:
        return ProposedExtraction(
            mentions=[Mention(id='m1', name='김 첨지', kind='character', quote='김 첨지는 인력거꾼이다.')],
            statements=[statement('s1', 'fact', 'identity', ['m1'], '김 첨지는 인력거꾼이다.'), statement('s2', 'description', 'soul', ['m1'], '그는 성미가 급하다.'),
                        statement('s3', 'event', 'memory', ['m1'], '비가 추적추적 내렸다.', knowers=['m1'], occurred=1)],   # 인용에 이름이 없어 인지 대상은 빠진다
            relationships=[])
    return ProposedExtraction(
        mentions=[Mention(id='m1', name='김 첨지', kind='character', quote='김 첨지는 치삼과 술을 마셨다.'), Mention(id='m2', name='치삼', kind='character', quote='치삼은 오래된 친구였다.')],
        statements=[statement('s1', 'event', 'memory', ['m1', 'm2'], '김 첨지는 치삼과 술을 마셨다.', knowers=['m1', 'm2'], occurred=2, known=2),
                    statement('s2', 'fact', 'identity', ['m2'], '치삼은 오래된 친구였다.', known=2), statement('s3', 'description', 'soul', ['m2'], '치삼은 오래된 친구였다.', known=2)],
        relationships=[ProposedRelation(id='r1', source='m1', target='m2', label='친구', change='started', quote='치삼은 오래된 친구였다.')])


@pytest.fixture
def fake(monkeypatch):
    """서비스가 부르는 모델 호출(agent.extract·resolve)만 대역으로: 검증·병합·구성은 실제 코드가 한다. 호출 기록을 돌려준다."""
    calls = SimpleNamespace(extract=[], resolve=[], fail={})

    def extract(episode):
        calls.extract.append(episode.number)
        if episode.number in calls.fail:
            raise calls.fail[episode.number]
        return proposal(episode.number)

    def resolve(extractions):
        calls.resolve.append([e.number for e in extractions])
        if None in calls.fail:
            raise calls.fail[None]
        return ProposedResolution(links=[])

    monkeypatch.setattr(agent, 'extract', extract)
    monkeypatch.setattr(agent, 'resolve', resolve)
    return calls


def test_build_world_runs_the_real_pipeline_and_caches_each_stage(tmp_path, fake):
    built = pb.build_world(WORK, tmp_path, 'm1')
    cards = {c.title: c for c in built.payload.cards}
    assert sorted(cards) == ['1화 · 비가 추적추적 내렸다.', '2화 · 김 첨지는 치삼과 술을 마셨다.', '김 첨지', '치삼']   # 같은 이름(김 첨지)은 한 카드로 합쳐진다
    assert cards['김 첨지'].body == '[사실] 김 첨지는 인력거꾼이다.' and cards['김 첨지'].characterDocs.soul == '[묘사] 그는 성미가 급하다.'
    assert [(r.label, r.fromEpisode) for r in built.payload.relations] == [('친구', 2)] and built.failures == [] and built.calls == 3
    assert (sorted(fake.extract), fake.resolve) == ([1, 2], [[1, 2]]) and sum(e.skipped.get('KNOWLEDGE_NOT_EXPLICIT', 0) for e in built.extractions.values()) == 1
    assert built.quotes[(cards['김 첨지'].key, cards['치삼'].key, '친구', 2)] == '치삼은 오래된 친구였다.'   # 관계의 근거 인용
    again = pb.build_world(WORK, tmp_path, 'm1')   # 같은 원문·지시문·모델이면 모델을 부르지 않는다
    assert again.payload == built.payload and again.calls == 0 and (sorted(fake.extract), fake.resolve) == ([1, 2], [[1, 2]])
    assert list(tmp_path.glob('w/payload.*.json'))   # 수동 적재·점검용 LoadPayload


def test_cache_follows_text_prompt_and_model(tmp_path, fake, monkeypatch):
    pb.build_world(WORK, tmp_path, 'm1')
    changed = {**WORK, 'episodes': [WORK['episodes'][0], {**WORK['episodes'][1], 'text': WORK['episodes'][1]['text'] + ' 눈이 왔다.'}]}
    pb.build_world(changed, tmp_path, 'm1')
    assert sorted(fake.extract) == [1, 2, 2] and len(fake.resolve) == 2   # 바뀐 회차만 다시 뽑고, 정체 정리는 입력이 달라져 다시 한다
    pb.build_world(WORK, tmp_path, 'm2')
    assert sorted(fake.extract) == [1, 1, 2, 2, 2]   # 모델이 다르면 모두 다시
    monkeypatch.setattr(prompt, 'EXTRACT', prompt.EXTRACT + ' 새 지시문')
    pb.build_world(WORK, tmp_path, 'm2')
    assert sorted(fake.extract) == [1, 1, 1, 2, 2, 2, 2]   # 지시문이 바뀌어도 다시


def test_offline_build_refuses_to_call_the_model(tmp_path, fake):
    with pytest.raises(pb.CacheMiss):
        pb.build_world(WORK, tmp_path, 'm1', offline=True)
    assert fake.extract == []
    pb.build_world(WORK, tmp_path, 'm1')
    assert pb.build_world(WORK, tmp_path, 'm1', offline=True).calls == 0


def test_failed_episode_is_reported_not_hidden_and_not_cached(tmp_path, fake):
    fake.fail[2] = PreprocessingFailure('INVALID_MODEL_OUTPUT')
    built = pb.build_world(WORK, tmp_path, 'm1')
    assert built.failures == [(2, 'INVALID_MODEL_OUTPUT')] and sorted(built.extractions) == [1] and sorted(c.title for c in built.payload.cards) == ['1화 · 비가 추적추적 내렸다.', '김 첨지']
    del fake.fail[2]
    assert sorted(pb.build_world(WORK, tmp_path, 'm1').extractions) == [1, 2] and sorted(fake.extract) == [1, 2, 2]   # 실패는 캐시하지 않아 다시 하면 그 회차만 다시 부른다


def test_offline_read_reports_failures_recorded_by_the_build_instead_of_asking_for_a_rebuild(tmp_path, fake):
    fake.fail[2] = PreprocessingFailure('MODEL_TIMEOUT', 504)
    built = pb.build_world(WORK, tmp_path, 'm1')
    again = pb.build_world(WORK, tmp_path, 'm1', offline=True)   # 실패한 회차는 캐시가 없어도 모델을 부르지 않고 그 실패를 그대로 돌려준다
    assert again.failures == built.failures == [(2, 'MODEL_TIMEOUT')] and again.payload == built.payload and again.calls == 0 and sorted(fake.extract) == [1, 2]
    del fake.fail[2]
    assert pb.build_world(WORK, tmp_path, 'm1').failures == [] and pb.build_world(WORK, tmp_path, 'm1', offline=True).failures == []   # 다시 뽑아 성공하면 실패 표시는 지워진다
    fake.fail[None] = PreprocessingFailure('INVALID_IDENTITY_OUTPUT')
    with pytest.raises(pb.WorldFailed, match='INVALID_IDENTITY_OUTPUT'):
        pb.build_world({**WORK, 'id': 'other'}, tmp_path, 'm1')
    with pytest.raises(pb.WorldFailed, match='INVALID_IDENTITY_OUTPUT'):   # 정체 정리 실패도 오프라인에서 같은 코드로 읽힌다
        pb.build_world({**WORK, 'id': 'other'}, tmp_path, 'm1', offline=True)


def test_world_fails_when_nothing_can_be_extracted(tmp_path, fake):
    fake.fail.update({1: PreprocessingFailure('MODEL_TIMEOUT', 504), 2: PreprocessingFailure('MODEL_TIMEOUT', 504)})
    with pytest.raises(pb.WorldFailed, match='NO_EXTRACTION'):
        pb.build_world(WORK, tmp_path, 'm1')


class Hand:
    def people(self, wid):
        return [{'id': 'c1', 'title': '김 첨지', 'aliases': [], 'reveal': 1}, {'id': 'c2', 'title': '치삼', 'aliases': [], 'reveal': 2}]

    def facts(self, wid, person, ep):
        return []


def corpus_for(tmp_path, reveal='none'):
    built = pb.build_world(WORK, tmp_path, 'm1')
    return pw.PipelineCorpus(Hand(), {'w': pw.PipelineWorld('w', built.payload, built.quotes, reveal)})


LINES = [{'kind': 'dialogue', 'by': '김 첨지', 'text': '"어서 오게."', 'speaker': '김 첨지'}, {'kind': 'narration', 'by': '나레이션', 'text': '치삼이 문을 열었다.', 'speaker': ''}]   # 마지막 줄이 회상 검색어다


def item(kind, speaker):
    return {'id': 'w-1', 'work': 'w', 'ep': 'w#2', 'n': 2, 'base': 1, 'kind': kind, 'speaker': speaker, 'speaker_id': 'c1' if speaker else '', 'gold': '"그래, 한잔하세."', 'context': LINES,
            'cast': ['김 첨지', '치삼'], 'ids': {'김 첨지': 'c1', '치삼': 'c2'}}


def test_pipeline_documents_reach_the_actor_input_without_later_episodes(tmp_path, fake):
    corpus = corpus_for(tmp_path)
    view = rn.act_view(item('dialogue', '김 첨지'), corpus)
    text = ' '.join(d['text'] for d in view['asked']['known'])
    assert '김 첨지는 인력거꾼이다.' in text and '그는 성미가 급하다.' in text   # 파이프라인이 만든 IDENTITY·SOUL이 운영 입력 조립(character_view)에 실린다
    assert '치삼은 오래된 친구였다.' not in text and '술을 마셨다' not in text   # 2화의 일은 기준 회차(1)의 인물 입력에 없다(관계로 이어지지 않은 카드·뒤 회차 기억)
    assert corpus.status(item('dialogue', '김 첨지')) == 'ok' and corpus.status(item('dialogue', '치삼')) == 'late_card'


def test_reveal_first_hides_cards_after_the_base_episode_from_the_narrator(tmp_path, fake):
    known = lambda reveal: ' '.join(d['text'] for d in rn.narrate_data(item('narration', ''), corpus_for(tmp_path, reveal))['known'])  # noqa: E731
    assert '치삼은 오래된 친구였다.' in known('none')   # 자동 적재는 공개 회차가 없어 나레이터는 기준 회차 뒤에 처음 나온 카드도 본다(운영 그대로)
    assert '치삼은 오래된 친구였다.' not in known('first')   # 작가가 첫 등장 회차를 공개 회차로 정하면 가려진다


class FakeChat:
    """ChatOpenAI 대역: 만들 때의 인자를 남기고 구조화 호출은 사용량이 든 응답을 돌려준다."""
    made, invoked = [], []

    def __init__(self, **options):
        FakeChat.made.append(options)

    def with_structured_output(self, schema, **kwargs):
        def invoke(messages):
            FakeChat.invoked.append(schema.__name__)
            usage = {'input_tokens': 1000, 'output_tokens': 200, 'input_token_details': {'cache_read': 100}}
            return {'raw': SimpleNamespace(usage_metadata=usage), 'parsed': 'x', 'parsing_error': None}
        return SimpleNamespace(invoke=invoke)


def test_metered_chat_records_usage_and_stops_at_the_limit_before_calling(tmp_path):
    FakeChat.made, FakeChat.invoked = [], []
    cost = CostLog(tmp_path / 'cost.jsonl')
    chat = pb.chat_factory(FakeChat, cost, limit_usd=0.0004, reserve=0)   # 한 호출(0.00042달러)이면 닿는 상한
    llm = chat(model='gpt-6-luna', api_key='k', timeout=70)
    assert FakeChat.made == [{'model': 'gpt-6-luna', 'api_key': 'k', 'timeout': 70}]   # 서비스가 정한 인자는 그대로
    result = llm.with_structured_output(ProposedExtraction, method='json_schema').invoke([])
    assert result['parsed'] == 'x'
    [row] = cost.rows()
    assert (row['kind'], row['in'], row['cached'], row['out'], row['usd'] > 0) == ('ProposedExtraction', 1000, 100, 200, True)
    with pytest.raises(CallCapExceeded):   # 장부가 상한에 닿으면 모델을 부르기 전에 멈춘다
        llm.with_structured_output(ProposedExtraction).invoke([])
    assert FakeChat.invoked == ['ProposedExtraction']


def test_ocx_chat_overrides_model_and_key_and_waits_out_rate_limits(tmp_path):
    FakeChat.made, FakeChat.invoked = [], []
    waited = []
    cost = pb.sim_via.OcxCostLog(tmp_path / 'cost.jsonl')
    chat = pb.chat_factory(FakeChat, cost, overrides={'model': 'gpt-6-luna', 'api_key': 'ocx', 'base_url': 'http://gw/v1', 'timeout': 300}, backoff=lambda call: waited.append(1) or call())
    chat(model='anything', api_key='real-key', timeout=70).with_structured_output(ProposedExtraction).invoke([])
    assert FakeChat.made == [{'model': 'gpt-6-luna', 'api_key': 'ocx', 'base_url': 'http://gw/v1', 'timeout': 300}] and waited == [1]   # 실제 키는 게이트웨이로 가지 않는다
    assert [(r['usd'], r['via'], r['in']) for r in cost.rows()] == [(0.0, 'ocx', 1000)]   # 금액 0이어도 토큰은 남겨 실제 단가를 어림하는 근거로 쓴다


def test_estimate_build_counts_only_uncached_calls_and_prices_them(tmp_path, fake):
    works = {'w': WORK}
    first = pb.estimate_build(works, tmp_path, 'm1')
    assert (first['extract'], first['resolve']) == (2, 1) and first['usd'] > 0 and first['tokensIn'] > first['tokensOut'] * 0
    pb.build_world(WORK, tmp_path, 'm1')
    done = pb.estimate_build(works, tmp_path, 'm1')
    assert (done['extract'], done['resolve'], done['usd']) == (0, 0, 0)   # 캐시에 다 있으면 호출 0
    one = pb.estimate_build({'w': {**WORK, 'episodes': [WORK['episodes'][0], {**WORK['episodes'][1], 'text': '다른 글.'}]}}, tmp_path, 'm1')
    assert (one['extract'], one['resolve']) == (1, 1)   # 회차 하나만 바뀌어도 정체 정리는 다시
    assert json.dumps(first)   # JSON으로 쓸 수 있다
