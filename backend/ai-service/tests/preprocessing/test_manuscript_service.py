"""원고 기반 전처리 의미 로직 회귀. 제공사 호출은 모두 대역이다."""
import copy
import json
from pathlib import Path
import pytest
from app.manuscript_extraction import service
from app.manuscript_extraction.models import EpisodeText, LoadPayload
from app.manuscript_extraction.errors import PreprocessingFailure
from app.novelbrain.models import Card as WorldCard
from app.simulation import service as simulation
from app.simulation.errors import SimulationFailure

FIXTURES = Path(__file__).parent / 'fixtures'


def proposed():
    return {'mentions': [{'id': 'm1', 'name': '길동', 'kind': 'character', 'quote': '길동은 산을 넘을 계획이었다.'}],
            'statements': [{'id': 's1', 'kind': 'plan', 'certainty': 'intended', 'subjects': ['m1'], 'knowers': ['m1'],
                            'document': 'goal', 'occurredEpisode': None, 'knownFromEpisode': 1,
                            'quote': '길동은 산을 넘을 계획이었다.'}], 'relationships': []}


def run_extract(monkeypatch, output=None, body='길동은 산을 넘을 계획이었다.', number=1):
    monkeypatch.setattr(service.agent, 'extract', lambda data: output or proposed())
    return service.extract(EpisodeText(number=number, title='계획', body=body))


def person(i, name, quote, kind='character'):
    return {'id': i, 'name': name, 'kind': kind, 'quote': quote}


def build(monkeypatch, episodes, links=()):
    """{회차: (본문, 모델 출력)}을 추출·정체 정리·구성까지 돌려 (rows, identity, payload)를 돌려준다."""
    monkeypatch.setattr(service.agent, 'extract', lambda ep: episodes[ep.number][1])
    monkeypatch.setattr(service.agent, 'resolve', lambda rows: {'links': list(links)})
    rows = {n: service.extract(EpisodeText(number=n, title=f'{n}화', body=body)) for n, (body, _) in episodes.items()}
    identity = service.resolve(rows)
    return rows, identity, service.organize(identity, rows)


def test_extract_keeps_intention_and_verified_source(monkeypatch):
    result = run_extract(monkeypatch)
    assert result.statements[0].kind == 'plan'
    assert result.evidence[0].quote == '길동은 산을 넘을 계획이었다.'
    assert len(result.sourceHash) == 64 and result.skipped == {}


@pytest.mark.parametrize('mutation, code, count', [
    ('missing_quote', 'INVALID_OR_AMBIGUOUS_QUOTE', 1), ('bad_id', 'UNKNOWN_ENTITY', 1), ('plan_as_event', 'SEMANTIC_TYPE_CONFLICT', 1),
    ('conjecture_as_fact', 'SEMANTIC_TYPE_CONFLICT', 1), ('future_memory', 'INVALID_KNOWLEDGE_TIME', 1), ('future_event', 'FUTURE_EVENT', 1),
    ('duplicate_id', 'DUPLICATE_LOCAL_ID', 2)])
def test_one_bad_statement_is_left_out_and_counted_while_the_episode_succeeds(monkeypatch, mutation, code, count):
    data = proposed()
    if mutation == 'missing_quote': data['statements'][0]['quote'] = '길동은 이미 도착했다.'
    if mutation == 'bad_id': data['statements'][0]['subjects'] = ['unknown']
    if mutation == 'plan_as_event': data['statements'][0]['kind'] = 'event'
    if mutation == 'conjecture_as_fact': data['statements'][0].update(kind='fact', certainty='uncertain')
    if mutation == 'future_memory': data['statements'][0]['knownFromEpisode'] = 3
    if mutation == 'future_event': data['statements'][0].update(kind='event', certainty='asserted', document='memory', occurredEpisode=2)
    if mutation == 'duplicate_id': data['statements'] *= 2
    result = run_extract(monkeypatch, data)
    assert [m.id for m in result.mentions] == ['m1'] and result.statements == []
    assert result.skipped == {code: count}


@pytest.mark.parametrize('mutation', ['ambiguous_quote', 'duplicate_mention_id', 'wrong_name'])
def test_an_episode_whose_proposals_all_fail_verification_still_fails(monkeypatch, mutation):
    data = proposed(); body = '길동은 산을 넘을 계획이었다.'
    if mutation == 'ambiguous_quote': body += body
    if mutation == 'duplicate_mention_id': data['mentions'] *= 2
    if mutation == 'wrong_name': data['mentions'][0]['name'] = '철수'
    with pytest.raises(PreprocessingFailure, match='NO_VERIFIED_MENTION'): run_extract(monkeypatch, data, body)


def test_a_malformed_model_output_still_fails_the_episode(monkeypatch):
    data = proposed(); data['statements'][0]['kind'] = 'magic'
    with pytest.raises(PreprocessingFailure, match='INVALID_EXTRACTION'): run_extract(monkeypatch, data)


def test_an_output_with_nothing_in_it_is_an_empty_extraction_not_a_failure(monkeypatch):
    result = run_extract(monkeypatch, {'mentions': [], 'statements': [], 'relationships': []}, body='이름 없는 풍경만 있다.')
    assert (result.mentions, result.statements, result.skipped) == ([], [], {})


def test_utf16_crlf_quote_coordinates(monkeypatch):
    result = run_extract(monkeypatch, body='😀\r\n길동은 산을 넘을 계획이었다.')
    assert result.evidence[0].start == 4
    assert result.evidence[0].end == 20


def test_a_plan_word_in_the_quote_does_not_make_a_real_event_a_failure(monkeypatch):
    quote = '길동은 계획대로 문을 열었다.'
    data = {'mentions': [person('m1', '길동', quote)], 'relationships': [],
            'statements': [{'id': 's1', 'kind': 'event', 'certainty': 'asserted', 'subjects': ['m1'], 'knowers': ['m1'], 'document': 'memory',
                            'occurredEpisode': 1, 'knownFromEpisode': 1, 'quote': quote}]}
    result = run_extract(monkeypatch, data, body=quote)
    assert result.statements[0].kind == 'event' and result.skipped == {}


def test_the_program_fills_the_relation_episode_and_end_flag(monkeypatch):
    def relation(change):
        quote = '길동은 활빈당에 가입했다.' if change == 'started' else '길동은 활빈당을 떠났다.'
        data = {'mentions': [person('m1', '길동', quote), person('m2', '활빈당', quote, 'organization')], 'statements': [],
                'relationships': [{'id': 'r1', 'source': 'm1', 'target': 'm2', 'label': '소속', 'change': change, 'quote': quote}]}
        return run_extract(monkeypatch, data, body=quote, number=3 if change == 'ended' else 2).relationships[0]
    started, ended = relation('started'), relation('ended')
    assert (started.fromEpisode, started.ended, started.change) == (2, False, 'started')
    assert (ended.fromEpisode, ended.ended, ended.change) == (3, True, 'ended')


def test_a_renamed_relation_is_the_old_name_ended_and_the_new_name_started(monkeypatch):
    body = '길동은 활빈당의 졸개였다.\n길동은 활빈당의 두령이 되었다.'
    data = {'mentions': [person('m1', '길동', '길동은 활빈당의 졸개였다.'), person('m2', '활빈당', '길동은 활빈당의 두령이 되었다.', 'organization')],
            'statements': [], 'relationships': [
                {'id': 'r1', 'source': 'm1', 'target': 'm2', 'label': '졸개', 'change': 'ended', 'quote': '길동은 활빈당의 졸개였다.'},
                {'id': 'r2', 'source': 'm1', 'target': 'm2', 'label': '두령', 'change': 'started', 'quote': '길동은 활빈당의 두령이 되었다.'}]}
    rows, _, payload = build(monkeypatch, {4: (body, data)})
    assert rows[4].skipped == {}
    assert sorted((r.label, r.fromEpisode, r.ended) for r in payload.relations) == [('두령', 4, False), ('졸개', 4, True)]


@pytest.mark.parametrize('mutation, code', [('self', 'INVALID_RELATION_ENDPOINT'), ('unknown', 'INVALID_RELATION_ENDPOINT'), ('twice', 'DUPLICATE_RELATION')])
def test_one_bad_relation_is_left_out_and_counted(monkeypatch, mutation, code):
    quote = '길동은 활빈당에 가입했다.'
    relation = {'id': 'r1', 'source': 'm1', 'target': 'm2', 'label': '소속', 'change': 'started', 'quote': quote}
    data = {'mentions': [person('m1', '길동', quote), person('m2', '활빈당', quote, 'organization')], 'statements': [], 'relationships': [relation]}
    if mutation == 'self': relation['target'] = 'm1'
    if mutation == 'unknown': relation['target'] = 'm9'
    if mutation == 'twice': data['relationships'].append({**relation, 'id': 'r2'})
    result = run_extract(monkeypatch, data, body=quote)
    assert len(result.relationships) == (1 if mutation == 'twice' else 0) and result.skipped == {code: 1}


def test_world_rules_become_rule_cards(monkeypatch):
    quote = '마법은 달빛 아래에서만 쓸 수 있다.'
    data = {'mentions': [person('m1', '마법', quote, 'rule')], 'relationships': [],
            'statements': [{'id': 's1', 'kind': 'rule', 'certainty': 'asserted', 'subjects': ['m1'], 'knowers': [], 'document': 'identity',
                            'occurredEpisode': None, 'knownFromEpisode': 1, 'quote': quote}]}
    _, _, payload = build(monkeypatch, {1: (quote, data)})
    card, = payload.cards
    assert (card.cardType, card.title, card.body, card.characterDocs) == ('rule', '마법', '[규칙] ' + quote, None)


def test_a_statement_that_would_overflow_a_target_document_is_left_out_not_truncated(monkeypatch):
    first, second = '길동은 ' + '가' * 1500 + '.', '길동은 ' + '나' * 1500 + '.'
    statement = lambda i, quote: {'id': i, 'kind': 'description', 'certainty': 'asserted', 'subjects': ['m1'], 'knowers': [],
                                  'document': 'soul', 'occurredEpisode': None, 'knownFromEpisode': 1, 'quote': quote}
    data = {'mentions': [person('m1', '길동', first)], 'relationships': [], 'statements': [statement('s1', first), statement('s2', second)]}
    rows, _, payload = build(monkeypatch, {1: (first + '\n' + second, data)})
    assert [s.id for s in rows[1].statements] == ['s1'] and rows[1].skipped == {'DOCUMENT_TOO_LONG': 1}
    assert payload.cards[0].characterDocs.soul == '[묘사] ' + first


def test_event_titles_cut_the_quote_by_code_points(monkeypatch):
    quote = '길동은 ' + '😀' * 30 + ' 서 있었다.'
    data = {'mentions': [person('m1', '길동', quote)], 'relationships': [],
            'statements': [{'id': 's1', 'kind': 'event', 'certainty': 'asserted', 'subjects': ['m1'], 'knowers': ['m1'], 'document': 'memory',
                            'occurredEpisode': 1, 'knownFromEpisode': 1, 'quote': quote}]}
    _, _, payload = build(monkeypatch, {1: (quote, data)})
    event = next(c for c in payload.cards if c.cardType == 'event')
    assert event.title == '1화 · ' + quote[:24] and event.title.endswith('😀')


def test_an_output_without_any_setting_ends_as_no_settings_found(monkeypatch):
    with pytest.raises(PreprocessingFailure, match='NO_SETTINGS_FOUND'):
        build(monkeypatch, {1: ('이름 없는 풍경만 있다.', {'mentions': [], 'statements': [], 'relationships': []})})


@pytest.fixture
def four(monkeypatch):
    data = json.loads((FIXTURES / 'four-episodes.json').read_text(encoding='utf-8'))
    monkeypatch.setattr(service.agent, 'extract', lambda ep: data['episodes'][ep.number-1]['output'])
    monkeypatch.setattr(service.agent, 'resolve', lambda rows: data['resolution'])
    return data


@pytest.fixture
def natural(monkeypatch):
    data = json.loads((FIXTURES / 'natural-two-episodes.json').read_text(encoding='utf-8'))
    monkeypatch.setattr(service.agent, 'extract', lambda ep: data['episodes'][ep.number-1]['output'])
    monkeypatch.setattr(service.agent, 'resolve', lambda rows: data['resolution'])
    return data


def extract_four(data):
    return {e['number']: service.extract(EpisodeText(**{k:v for k,v in e.items() if k!='output'})) for e in data['episodes']}


def test_natural_prose_builds_one_card_per_entity(natural):
    rows = extract_four(natural)
    assert rows[1].skipped == {} and rows[2].skipped == {'INVALID_OR_AMBIGUOUS_QUOTE': 1, 'UNREPRESENTABLE_STATEMENT': 1}
    identity = service.resolve(rows); payload = service.organize(identity, rows)
    assert [(d.link.basis, d.link.right, d.status) for d in identity.decisions] == [('same_name', f'2:m{i}', 'merged') for i in (1, 2, 3)]
    cards = {c.title: c for c in payload.cards if c.cardType != 'event'}
    assert sorted(cards) == ['도윤', '서하', '열쇠', '폐역']
    assert cards['폐역'].body == '[묘사] 폐역은 십 년 전 사고 이후로 버려진 곳이었다.'
    assert cards['열쇠'].body == '[묘사] 열쇠는 어머니가 남긴 것이었다.'
    seoha = cards['서하'].characterDocs
    assert seoha.goal == '[계획] 서하는 오늘 밤 안에 금고를 열 계획이었다.' and set(seoha.episodes) == {'01', '02'}
    assert seoha.episodes['01'] == '[사건] 서하는 폐역 앞에 섰다.\n[계획] 서하는 오늘 밤 안에 금고를 열 계획이었다.'
    assert seoha.episodes['02'] == '[사건] 다음 날, 서하는 다시 폐역으로 향했다.\n[사실] 서하는 어릴 때부터 이 역의 종소리를 기억하고 있었다.'
    assert '계획대로 뒷문을 열었다' in cards['도윤'].characterDocs.episodes['02'] and '소문난 점집' in cards['도윤'].characterDocs.episodes['02']
    assert '지도 모양' not in payload.model_dump_json()  # 뒤 회차의 폐역 재서술은 카드에 싣지 않는다
    assert sorted(c.title for c in payload.cards if c.cardType == 'event') == sorted(
        ['1화 · 서하는 폐역 앞에 섰다.', '2화 · 다음 날, 서하는 다시 폐역으로 향했다.', '2화 · 도윤은 계획대로 뒷문을 열었다.'])
    assert [(r.label, r.fromEpisode, r.ended, r.fromKey, r.toKey) for r in payload.relations] == [
        ('친구', 1, False, cards['서하'].key, cards['도윤'].key), ('사촌', 2, False, cards['서하'].key, cards['도윤'].key)]


@pytest.mark.parametrize('count', [4, 10])
def test_fixture_episodes_build_the_expected_world_with_the_model_links(monkeypatch, count):
    data = json.loads((FIXTURES / 'ten-episodes.json').read_text(encoding='utf-8'))
    data['episodes'] = data['episodes'][:count]
    data['resolution']['links'] = [l for l in data['resolution']['links'] if l['evidenceEpisode'] <= count]
    monkeypatch.setattr(service.agent, 'extract', lambda ep: data['episodes'][ep.number-1]['output'])
    monkeypatch.setattr(service.agent, 'resolve', lambda rows: data['resolution'])
    rows = extract_four(data); identity = service.resolve(rows); payload = service.organize(identity, rows)
    assert all(row.skipped == {} and row.source == ep['body'] for row, ep in zip(rows.values(), data['episodes']))
    assert [(r.fromEpisode, r.ended) for r in payload.relations] == ([(1, False), (4, True)] if count == 4 else [(1, False), (4, True), (5, False), (8, True), (9, False)])
    if count == 10:
        hero = next(c for c in payload.cards if c.title == '길동')
        merchant = next(c for c in payload.cards if c.title == '홍길동' and c.firstEpisode == 2)
        assert hero.key != merchant.key and hero.aliases == []
        assert '다스리고' not in hero.characterDocs.goal and '다스리고' in hero.characterDocs.episodes['03']
        assert '10화의 암호' not in hero.model_dump_json() and '비밀 지도' not in merchant.model_dump_json()
        assert '10화의 암호' in merchant.characterDocs.episodes['10']
        assert next(c for c in payload.cards if c.title == '산채').firstEpisode == 5
        assert next(c for c in payload.cards if c.title == '부채').firstEpisode == 6


def test_four_episode_payload_preserves_time_and_identity(four):
    rows = extract_four(four); identity = service.resolve(rows); payload = service.organize(identity, rows)
    assert identity.mapping['1:m1'] != identity.mapping['1:m2']
    assert identity.mapping['1:m1'] == identity.mapping['4:m1']
    candidate, = payload.identityCandidates
    assert {candidate.fromKey, candidate.toKey} == {identity.mapping['1:m1'], identity.mapping['1:m2']}
    assert candidate.episode == 1 and candidate.quote == four['resolution']['links'][0]['quote']
    assert identity.mapping['1:m2'] != identity.mapping['2:m1']
    hero = next(c for c in payload.cards if c.key == identity.mapping['1:m1'])
    stranger = next(c for c in payload.cards if c.key == identity.mapping['2:m1'])
    assert hero.title == '길동' and hero.aliases == [] and hero.firstEpisode == 1
    assert '약자를' in hero.characterDocs.soul and hero.characterDocs.goal == '[계획] 길동은 산을 넘을 계획이었다.'
    assert '백성을' not in hero.characterDocs.goal and '백성을' in hero.characterDocs.episodes['03']
    assert '비밀 지도' not in stranger.model_dump_json() and '추측' in stranger.characterDocs.episodes['02']
    assert '산을 넘었다' not in hero.characterDocs.episodes['01']
    assert '출생' in hero.characterDocs.episodes['00']
    assert [(r.fromEpisode,r.ended) for r in payload.relations] == [(1,False),(4,True)]
    assert payload.relations[0].fromKey == payload.relations[1].fromKey
    assert {c.firstEpisode for c in payload.cards if c.cardType=='event'} == {3,4}
    assert {c.title for c in payload.cards if c.cardType=='event'} == {'3화 · 길동은 산을 넘었다.', '4화 · 길동은 활빈당을 탈퇴했다.'}
    assert service.resolve(dict(reversed(list(rows.items())))) == identity
    assert service.organize(identity, dict(reversed(list(rows.items())))) == payload


def test_late_identity_cannot_leak_into_global_title_alias_or_docs(four):
    late = '가면 사내는 길동이었다.'
    four['episodes'][2]['body'] += '\n' + late
    four['episodes'][2]['output']['mentions'].append({'id':'m2','name':'가면 사내','kind':'character','quote':late})
    four['resolution']['links'].append({'left':'1:m1','right':'3:m2','basis':'explicit_alias','confirmedAt':3,'evidenceEpisode':3,'quote':late})
    rows = extract_four(four); identity = service.resolve(rows)
    decision = next(d for d in identity.decisions if d.link.right=='3:m2')
    assert decision.status == 'deferred' and decision.reason == 'AUTHOR_REVIEW_REQUIRED'
    payload = service.organize(identity, rows)
    assert any(c.episode == 3 and c.quote == late for c in payload.identityCandidates)
    assert all('가면 사내' not in c.aliases for c in payload.cards)


def test_unconfirmed_alias_keeps_both_cards_without_suggestion(four):
    four['resolution']['links'][0]['basis'] = 'uncertain'
    rows = extract_four(four)
    identity = service.resolve(rows)
    assert identity.mapping['1:m1'] != identity.mapping['1:m2']
    assert service.organize(identity, rows).identityCandidates == []


def test_a_link_whose_quote_lacks_both_names_is_dropped_alone(four):
    four['resolution']['links'][0]['quote'] = '길동은 산을 넘을 계획이었다.'
    rows = extract_four(four); identity = service.resolve(rows)
    assert all(d.link.basis != 'explicit_alias' for d in identity.decisions)
    assert identity.mapping['1:m1'] == identity.mapping['4:m1']  # 나머지 링크는 그대로 적용된다
    assert service.organize(identity, rows).identityCandidates == []


@pytest.mark.parametrize('change', [{'right': '9:m9'}, {'evidenceEpisode': 2, 'confirmedAt': 2}, {'quote': '없는 문장이다.'}, {'basis': 'same_name'}])
def test_any_one_unverifiable_link_is_dropped_and_the_rest_still_apply(four, change):
    bad = {'left': '1:m1', 'right': '1:m2', 'basis': 'explicit_alias', 'confirmedAt': 1, 'evidenceEpisode': 1, 'quote': '길동은 홍길동이라고도 불린다.', **change}
    four['resolution']['links'][0] = bad
    rows = extract_four(four); identity = service.resolve(rows)
    assert [d.link.right for d in identity.decisions if d.link.left == '1:m1' and d.link.right in ('9:m9', '1:m2')] == []
    assert identity.mapping['1:m1'] == identity.mapping['4:m1'] and identity.mapping['1:m3'] == identity.mapping['4:m2']
    assert service.organize(identity, rows).identityCandidates == []


def test_organize_rejects_an_identity_whose_links_no_longer_verify(four):
    rows = extract_four(four); identity = service.resolve(rows)
    identity.decisions[0].link.quote = '길동은 산을 넘을 계획이었다.'
    with pytest.raises(PreprocessingFailure, match='IDENTITY_INPUT_MISMATCH'): service.organize(identity, rows)


def test_changed_source_hash_and_cross_input_identity_are_rejected(four):
    rows=extract_four(four); identity=service.resolve(rows)
    rows[1].sourceHash = '0'*64
    with pytest.raises(PreprocessingFailure, match='EXTRACTION_EVIDENCE_MISMATCH'): service.organize(identity,rows)


def test_name_only_match_stays_separate_with_reason(four):
    four['resolution']['links'][1]['basis']='name_only'
    rows=extract_four(four);identity=service.resolve(rows)
    assert identity.mapping['1:m2']!=identity.mapping['2:m1']
    assert any(d.status=='deferred' and d.reason=='name_only' for d in identity.decisions)


@pytest.mark.parametrize('name, titles, relations', [
    ('four-episodes.json', ['길동', '홍길동', '홍길동', '활빈당'], [(1, False), (4, True)]),
    ('ten-episodes.json', ['길동', '부채', '산채', '홍길동', '홍길동', '홍길동', '활빈당'], [(1, False), (4, True), (5, False), (8, True), (9, False)])])
def test_same_name_merges_without_model_links(monkeypatch, name, titles, relations):
    data = json.loads((FIXTURES / name).read_text(encoding='utf-8'))
    data['resolution']['links'] = [l for l in data['resolution']['links'] if l['basis'] != 'explicit_coreference']
    monkeypatch.setattr(service.agent, 'extract', lambda ep: data['episodes'][ep.number-1]['output'])
    monkeypatch.setattr(service.agent, 'resolve', lambda rows: data['resolution'])
    rows = extract_four(data); identity = service.resolve(rows); payload = service.organize(identity, rows)
    assert sorted(c.title for c in payload.cards if c.cardType != 'event') == titles  # 모델이 distinct로 가른 상인 홍길동은 그대로 따로다
    assert [(r.fromEpisode, r.ended) for r in payload.relations] == relations
    assert len({(r.fromKey, r.toKey) for r in payload.relations}) == 1
    assert all(d.link.basis != 'explicit_coreference' for d in identity.decisions)
    assert service.resolve(dict(reversed(list(rows.items())))) == identity
    assert service.organize(identity, dict(reversed(list(rows.items())))) == payload


@pytest.mark.parametrize('twins', ['same_episode_twin', 'two_earlier_candidates'])
def test_same_name_is_not_merged_when_it_is_ambiguous(monkeypatch, twins):
    one = person('m1', '철수', '철수는 문을 열었다.')
    two = person('m2', '철수', '다른 철수는 창을 닫았다.')
    quotes = {1: '철수는 문을 열었다.\n다른 철수는 창을 닫았다.', 2: '철수는 돌아왔다.'} if twins == 'two_earlier_candidates' else {1: '철수는 문을 열었다.', 2: '철수는 돌아왔다.\n다른 철수는 가버렸다.'}
    outs = {1: {'mentions': [one, two] if twins == 'two_earlier_candidates' else [one], 'statements': [], 'relationships': []},
            2: {'mentions': [person('m1', '철수', '철수는 돌아왔다.')] + ([] if twins == 'two_earlier_candidates' else [person('m2', '철수', '다른 철수는 가버렸다.')]),
                'statements': [], 'relationships': []}}
    _, identity, payload = build(monkeypatch, {n: (quotes[n], outs[n]) for n in (1, 2)})
    assert len(payload.cards) == 3 and not identity.decisions


def test_a_model_distinct_pair_is_never_joined_through_the_default_merge(monkeypatch):
    quotes = {1: '철수는 문을 열었다.', 2: '철수는 창을 닫았다.', 3: '이 철수는 어제의 철수와 다른 사람이다.'}
    episodes = {n: (quote, {'mentions': [person('m1', '철수', quote)], 'statements': [], 'relationships': []}) for n, quote in quotes.items()}
    distinct = {'left': '2:m1', 'right': '3:m1', 'basis': 'distinct', 'confirmedAt': 3, 'evidenceEpisode': 3, 'quote': quotes[3]}
    _, identity, payload = build(monkeypatch, episodes, links=[distinct])
    assert identity.mapping['1:m1'] == identity.mapping['2:m1'] != identity.mapping['3:m1']  # 1·2화는 같은 이름이라 묶이고 3화는 가른 쌍이라 따로다
    assert len(payload.cards) == 2


def test_a_knower_whose_name_is_not_in_the_quote_is_dropped_not_the_statement(four):
    data=four['episodes'][2]; quote='낯선이는 객주에 있었다.'
    data['body']+='\n'+quote
    data['output']['mentions'].append({'id':'m2','name':'낯선이','kind':'character','quote':quote})
    data['output']['statements'][2]['knowers'].append('m2')
    rows = extract_four(four)
    assert rows[3].skipped == {'KNOWLEDGE_NOT_EXPLICIT': 1} and rows[3].statements[2].knowers == ['m1']
    payload = service.organize(service.resolve(rows), rows)
    stranger = next(c for c in payload.cards if c.title == '낯선이')
    assert stranger.characterDocs.episodes == {} and '비밀 지도' not in stranger.model_dump_json()


def test_a_later_soul_statement_joins_the_global_soul_but_not_the_identity_or_goal(four):
    data=four['episodes'][2]; quote='길동은 이제 냉혹하게 말하는 성격으로 변했다.'
    data['body']+='\n'+quote
    data['output']['statements'].append({'id':'s4','kind':'description','certainty':'asserted','subjects':['m1'],'knowers':['m1'],'document':'soul','occurredEpisode':None,'knownFromEpisode':3,'quote':quote})
    rows=extract_four(four);identity=service.resolve(rows);payload=service.organize(identity,rows)
    hero=next(c for c in payload.cards if c.key==identity.mapping['1:m1'])
    assert hero.characterDocs.soul == '[묘사] 길동은 약자를 돕는 성격이다.\n[묘사] ' + quote  # SOUL은 뒤 회차 진술까지 앞 회차부터 쌓인다(#839)
    assert '냉혹' not in hero.body+hero.title+hero.characterDocs.goal
    assert '냉혹' in hero.characterDocs.episodes['03']


def test_a_later_identity_restatement_without_a_knower_is_left_off_the_card_and_does_not_fail(four):
    data=four['episodes'][2]; quote='길동은 냉혹하게 말하는 성격이다.'
    data['body']+='\n'+quote
    data['output']['statements'].append({'id':'s4','kind':'description','certainty':'asserted','subjects':['m1'],'knowers':[],'document':'identity','occurredEpisode':None,'knownFromEpisode':3,'quote':quote})
    rows=extract_four(four);payload=service.organize(service.resolve(rows),rows)
    assert rows[3].skipped == {} and '냉혹' not in payload.model_dump_json()


def test_a_duplicate_claim_is_dropped_and_counted(four):
    data=four['episodes'][0]['output']; duplicate=copy.deepcopy(data['statements'][0]);duplicate['id']='s4';data['statements'].append(duplicate)
    rows=extract_four(four)
    assert rows[1].skipped == {'DUPLICATE_STATEMENT': 1} and [s.id for s in rows[1].statements] == ['s1','s2','s3']


def test_resolution_is_bound_to_extraction_not_only_original_source(four):
    rows=extract_four(four); identity=service.resolve(rows)
    rows[1].statements[0].knowers=[]
    with pytest.raises(PreprocessingFailure,match='IDENTITY_INPUT_MISMATCH'): service.organize(identity,rows)


def test_a_statement_with_nowhere_to_go_is_left_out_and_counted(four):
    four['episodes'][1]['output']['statements'][0]['knowers']=[]
    rows=extract_four(four)
    assert rows[2].statements == [] and rows[2].skipped == {'UNREPRESENTABLE_STATEMENT': 1}


def test_prestory_memory_needs_no_magic_phrase_and_is_episode_zero_at_first_appearance(monkeypatch):
    quote = '길동은 어릴 때부터 자신의 출생을 알고 있었다.'
    data = {'mentions': [person('m1', '길동', quote)], 'relationships': [],
            'statements': [{'id': 's1', 'kind': 'fact', 'certainty': 'asserted', 'subjects': ['m1'], 'knowers': ['m1'], 'document': 'memory',
                            'occurredEpisode': 0, 'knownFromEpisode': 0, 'quote': quote}]}
    rows, _, payload = build(monkeypatch, {1: (quote, data)})
    assert rows[1].skipped == {} and payload.cards[0].characterDocs.episodes == {'00': '[사실] ' + quote}


def test_a_later_prestory_claim_lands_in_its_own_episode_not_in_episode_zero(four):
    four['episodes'][2]['output']['statements'][2].update(occurredEpisode=0,knownFromEpisode=0)
    rows=extract_four(four);identity=service.resolve(rows);payload=service.organize(identity,rows)
    hero=next(c for c in payload.cards if c.key==identity.mapping['1:m1'])
    assert '비밀 지도' in hero.characterDocs.episodes['03'] and '비밀 지도' not in hero.characterDocs.episodes['00']


def test_late_revealed_preexisting_memory_is_filed_under_the_episode_that_reveals_it(four):
    data=four['episodes'][2];quote='길동은 이야기 시작 전부터 왕의 비밀을 알고 있었다.'
    data['body']+='\n'+quote
    data['output']['statements'].append({'id':'s4','kind':'fact','certainty':'asserted','subjects':['m1'],'knowers':['m1'],'document':'memory','occurredEpisode':0,'knownFromEpisode':0,'quote':quote})
    rows=extract_four(four);identity=service.resolve(rows);payload=service.organize(identity,rows)
    hero=next(c for c in payload.cards if c.key==identity.mapping['1:m1'])
    assert '왕의 비밀' in hero.characterDocs.episodes['03'] and '왕의 비밀' not in hero.characterDocs.episodes['00']


def claim(i, subject, quote, n, document='soul', kind='description'):
    """진술 하나(knowers 없음). 기본은 인물의 성격(soul) 묘사다."""
    return {'id': i, 'kind': kind, 'certainty': 'intended' if kind in ('plan', 'goal') else 'asserted', 'subjects': [subject], 'knowers': [],
            'document': document, 'occurredEpisode': None, 'knownFromEpisode': n, 'quote': quote}


def episode(mentions, statements=()):
    return {'mentions': mentions, 'statements': list(statements), 'relationships': []}


def test_a_trait_that_shows_only_in_a_later_episode_still_reaches_the_soul(monkeypatch):
    """첫 회차엔 이름만 스친 인물의 성격이 뒤 회차에 드러나면 SOUL에 쌓는다(#839). 같은 문장은 한 번만, 정체(IDENTITY)·목표(GOAL)는 첫 등장 회차 진술만."""
    first, joke, trade, plan = '치삼은 선술집 앞에 서 있었다.', '치삼은 말끝마다 농을 던지는 사람이었다.', '치삼은 본디 장터의 약장수였다.', '치삼은 장사를 접을 마음을 먹었다.'
    laugh = '"허, 이 사람아." 치삼이 껄껄 웃었다.'
    episodes = {1: (first, episode([person('m1', '치삼', first)])),
                2: (f'{joke}\n{trade}\n{plan}', episode([person('m1', '치삼', joke)], [claim('s1', 'm1', joke, 2), claim('s2', 'm1', trade, 2, 'identity'),
                                                                                    claim('s3', 'm1', plan, 2, 'goal', 'plan')])),
                3: (f'{joke}\n{laugh}', episode([person('m1', '치삼', laugh)], [claim('s1', 'm1', joke, 3), claim('s2', 'm1', laugh, 3)]))}
    _, _, payload = build(monkeypatch, episodes)
    card, = payload.cards
    assert card.characterDocs.soul == f'[묘사] {joke}\n[묘사] {laugh}'
    assert card.body == '' and card.characterDocs.goal == ''  # 첫 등장 회차(1화)에 진술이 없으면 뒤 회차의 정체·목표는 싣지 않는다


def test_the_accumulated_soul_stops_before_the_document_limit_without_cutting_a_line(monkeypatch):
    lines = ['치삼은 ' + filler * 1400 + '.' for filler in '가나다']
    episodes = {n: (quote, episode([person('m1', '치삼', quote)], [claim('s1', 'm1', quote, n)])) for n, quote in enumerate(lines, 1)}
    _, _, payload = build(monkeypatch, episodes)
    assert payload.cards[0].characterDocs.soul == '\n'.join('[묘사] ' + quote for quote in lines[:2])  # 셋째 줄은 3,000자를 넘기게 되어 줄째 빠진다


def test_a_character_without_an_identity_statement_keeps_an_empty_body_that_the_simulation_check_reports(monkeypatch):
    quote, place = '치삼은 껄껄 웃었다.', '선술집은 비어 있었다.'
    data = episode([person('m1', '치삼', quote), person('m2', '선술집', place, 'location')], [claim('s1', 'm1', quote, 1)])
    _, _, payload = build(monkeypatch, {1: (f'{quote}\n{place}', data)})
    cards = {c.title: c for c in payload.cards}
    # 이름으로 채우면 시뮬레이션 필수 문서 검사를 통과해 빈 문서가 가려진다. 인물이 아닌 카드는 확정 때 본문이 필수라 이름을 그대로 둔다.
    assert (cards['치삼'].body, cards['선술집'].body) == ('', '선술집')
    world = {'c1': WorldCard(id='c1', cardType='character', title='치삼', text=cards['치삼'].body, soul=cards['치삼'].characterDocs.soul)}
    with pytest.raises(SimulationFailure, match=r'IDENTITY\.md') as error:
        simulation._filled(['c1'], world, {})
    assert 'SOUL.md' not in str(error.value)


def two_episodes(first, later, kinds=('character', 'character')):
    quotes = {1: f'{first} 앞에 선술집이 있었다.', 2: f'{later} 선술집을 나섰다.'}
    return {n: (quotes[n], episode([person('m1', name, quotes[n], kind)])) for n, name, kind in ((1, first, kinds[0]), (2, later, kinds[1]))}


@pytest.mark.parametrize('first, later', [('치삼', '치삼이'), ('치삼이', '치삼'), ('치삼', '치삼아'), ('영희', '영희야'), ('치삼', '치삼은'), ('영희', '영희는'),
                                          ('치삼이', '치삼이가'), ('치삼', '치삼의')])
def test_a_suffix_or_particle_variant_of_a_name_is_the_same_character(monkeypatch, first, later):
    _, identity, payload = build(monkeypatch, two_episodes(first, later))
    card, = payload.cards
    assert (card.title, card.aliases) == (first, [later])  # 카드 이름은 처음 나온 호칭 그대로다
    assert [(d.link.basis, d.status) for d in identity.decisions] == [('same_name', 'merged')]


@pytest.mark.parametrize('first, later', [('영희', '영희이'), ('치삼', '치삼야'), ('순', '순이'), ('치삼', '치삼과')])
def test_a_name_that_only_looks_like_a_variant_stays_a_separate_character(monkeypatch, first, later):
    # 받침 규칙에 어긋난 접미사(영희이·치삼야), 뗀 뒤 한 글자만 남는 꼴(순이), 아는 접미사가 아닌 끝(치삼과)은 묶지 않는다.
    _, identity, payload = build(monkeypatch, two_episodes(first, later))
    assert sorted(c.title for c in payload.cards) == sorted([first, later]) and identity.decisions == []


def test_variants_of_different_kinds_the_same_episode_twins_and_a_model_distinct_pair_stay_separate(monkeypatch):
    _, identity, payload = build(monkeypatch, two_episodes('치삼', '치삼이', ('character', 'location')))
    assert len(payload.cards) == 2 and identity.decisions == []
    quote = '치삼이 앞에 치삼도 있었다.'
    twins = {1: (quote, episode([person('m1', '치삼', quote), person('m2', '치삼이', quote)])), 2: ('치삼은 돌아왔다.', episode([person('m1', '치삼은', '치삼은 돌아왔다.')]))}
    _, identity, payload = build(monkeypatch, twins)
    assert len(payload.cards) == 3 and identity.decisions == []  # 같은 회차에 변형이 둘이면 모델이 일부러 가른 것이고, 뒤 회차의 변형은 둘 중 어느 쪽인지 알 수 없다
    both = '치삼이는 치삼의 아들이다.'
    episodes = {1: ('치삼은 장터에 있었다.', episode([person('m1', '치삼', '치삼은 장터에 있었다.')])), 2: (both, episode([person('m1', '치삼이', both)]))}
    distinct = {'left': '1:m1', 'right': '2:m1', 'basis': 'distinct', 'confirmedAt': 2, 'evidenceEpisode': 2, 'quote': both}
    _, identity, payload = build(monkeypatch, episodes, links=[distinct])
    assert len(payload.cards) == 2 and [d.status for d in identity.decisions] == ['distinct']


def test_an_identical_name_is_matched_before_any_variant(monkeypatch):
    quote = '치삼이 앞에 치삼도 있었다.'
    episodes = {1: (quote, episode([person('m1', '치삼', quote), person('m2', '치삼이', quote)])), 2: ('치삼이 돌아왔다.', episode([person('m1', '치삼이', '치삼이 돌아왔다.')]))}
    _, identity, payload = build(monkeypatch, episodes)
    assert sorted(c.title for c in payload.cards) == ['치삼', '치삼이'] and [(d.link.left, d.link.right) for d in identity.decisions] == [('1:m2', '2:m1')]


def test_an_alias_link_between_variants_merges_them_instead_of_suggesting_a_character_to_itself(monkeypatch):
    both = '치삼이는 치삼이라고도 불린다.'
    episodes = {1: ('치삼은 장터에 있었다.', episode([person('m1', '치삼', '치삼은 장터에 있었다.')])), 2: (both, episode([person('m1', '치삼이', both)]))}
    alias = {'left': '1:m1', 'right': '2:m1', 'basis': 'explicit_alias', 'confirmedAt': 2, 'evidenceEpisode': 2, 'quote': both}
    _, identity, payload = build(monkeypatch, episodes, links=[alias])
    assert len(payload.cards) == 1 and payload.identityCandidates == [] and [d.status for d in identity.decisions] == ['merged']


@pytest.mark.parametrize('name', ['ai-result.json', 'ai-result-variants.json'])  # 두 번째는 호칭 변형·뒤 회차 SOUL·빈 인물 본문(#839)
def test_content_fixture_matches_python_output(name):
    """Content 단위 테스트가 읽는 ai-result*.json은 파이썬 organize 출력과 글자 단위로 같다. 표기 규칙을 한쪽만 고치면 이 테스트가 깨진다."""
    path = Path(__file__).parents[4] / 'backend/content-service/src/test/resources/initial-build' / name
    data = json.loads(path.read_text(encoding='utf-8'))
    rows = {row['number']: row for row in data['extractions']}
    assert service.organize(data['identity'], rows) == LoadPayload.model_validate(data['payload'])


def test_extract_passes_a_regression_evaluations_instructions_and_model_to_the_agent_and_still_verifies(monkeypatch):
    """#824: 평가가 지정한 버전의 본문·모델은 agent로 가고, 결과는 production과 같은 원문 검증을 거친다. 평소 호출은 아무것도 넘기지 않는다."""
    seen = []
    monkeypatch.setattr(service.agent, 'extract', lambda ep, instructions=None, model=None: seen.append((instructions, model)) or proposed())
    episode = EpisodeText(number=1, title='계획', body='길동은 산을 넘을 계획이었다.')

    evaluated = service.extract(episode, '평가할 버전 본문', 'gpt-evaluated')
    service.extract(episode)

    assert seen == [('평가할 버전 본문', 'gpt-evaluated'), (None, None)]
    assert evaluated.statements[0].kind == 'plan' and evaluated.evidence[0].quote == '길동은 산을 넘을 계획이었다.'
