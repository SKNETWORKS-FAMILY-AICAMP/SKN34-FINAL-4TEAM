"""원고 기반 전처리 의미 로직 회귀. 제공사 호출은 모두 대역이다."""
import copy
import pytest
from app.manuscript_extraction import service
from app.manuscript_extraction.models import EpisodeText
from app.manuscript_extraction.errors import PreprocessingFailure


def proposed():
    return {'mentions': [{'id': 'm1', 'name': '길동', 'kind': 'character', 'quote': '길동은 산을 넘을 계획이었다.'}],
            'statements': [{'id': 's1', 'kind': 'plan', 'certainty': 'intended', 'subjects': ['m1'], 'knowers': ['m1'],
                            'document': 'goal', 'occurredEpisode': None, 'knownFromEpisode': 1,
                            'quote': '길동은 산을 넘을 계획이었다.'}], 'relationships': []}


def run_extract(monkeypatch, output=None, body='길동은 산을 넘을 계획이었다.'):
    monkeypatch.setattr(service.agent, 'extract', lambda data: output or proposed())
    return service.extract(EpisodeText(number=1, title='계획', body=body))


def test_extract_keeps_intention_and_verified_source(monkeypatch):
    result = run_extract(monkeypatch)
    assert result.statements[0].kind == 'plan'
    assert result.evidence[0].quote == '길동은 산을 넘을 계획이었다.'
    assert len(result.sourceHash) == 64


@pytest.mark.parametrize('mutation', ['missing_quote', 'ambiguous_quote', 'bad_id', 'duplicate_id', 'plan_as_event', 'conjecture_as_fact', 'bad_kind', 'future_memory'])
def test_invalid_extraction_is_rejected(monkeypatch, mutation):
    data = proposed(); body = '길동은 산을 넘을 계획이었다.'
    if mutation == 'missing_quote': data['statements'][0]['quote'] = '길동은 이미 도착했다.'
    if mutation == 'ambiguous_quote': body += body
    if mutation == 'bad_id': data['statements'][0]['subjects'] = ['unknown']
    if mutation == 'duplicate_id': data['mentions'] *= 2
    if mutation == 'plan_as_event': data['statements'][0]['kind'] = 'event'
    if mutation == 'conjecture_as_fact': data['statements'][0].update(kind='fact', certainty='uncertain')
    if mutation == 'bad_kind': data['statements'][0]['kind'] = 'magic'
    if mutation == 'future_memory': data['statements'][0]['knownFromEpisode'] = 3
    with pytest.raises(PreprocessingFailure): run_extract(monkeypatch, data, body)


def test_utf16_crlf_quote_coordinates(monkeypatch):
    result = run_extract(monkeypatch, body='😀\r\n길동은 산을 넘을 계획이었다.')
    assert result.evidence[0].start == 4
    assert result.evidence[0].end == 20


@pytest.fixture
def four(monkeypatch):
    import json
    from pathlib import Path
    data = json.loads((Path(__file__).parent / 'fixtures/four-episodes.json').read_text(encoding='utf-8'))
    monkeypatch.setattr(service.agent, 'extract', lambda ep: data['episodes'][ep.number-1]['output'])
    monkeypatch.setattr(service.agent, 'resolve', lambda rows: data['resolution'])
    return data


def extract_four(data):
    return {e['number']: service.extract(EpisodeText(**{k:v for k,v in e.items() if k!='output'})) for e in data['episodes']}


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
    assert '약자를' in hero.characterDocs.soul and '산을 넘을 계획' in hero.characterDocs.goal
    assert '백성을' not in hero.characterDocs.goal and '백성을' in hero.characterDocs.episodes['03']
    assert '비밀 지도' not in stranger.model_dump_json() and '추측' in stranger.characterDocs.episodes['02']
    assert '산을 넘었다' not in hero.characterDocs.episodes['01']
    assert '출생' in hero.characterDocs.episodes['00']
    assert [(r.fromEpisode,r.ended) for r in payload.relations] == [(1,False),(4,True)]
    assert payload.relations[0].fromKey == payload.relations[1].fromKey
    assert {c.firstEpisode for c in payload.cards if c.cardType=='event'} == {3,4}
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


def test_alias_requires_both_names_in_verified_quote(four):
    four['resolution']['links'][0]['quote'] = '길동은 산을 넘을 계획이었다.'
    rows = extract_four(four)
    with pytest.raises(PreprocessingFailure, match='IDENTITY_NAMES_NOT_IN_EVIDENCE'):
        service.resolve(rows)


def test_relationship_discovery_is_not_a_relationship_change(four):
    four['episodes'][0]['output']['relationships'][0]['change'] = 'learned'
    with pytest.raises(PreprocessingFailure, match='RELATION_DISCOVERY_NOT_REPRESENTABLE'):
        extract_four(four)


def test_changed_source_hash_and_cross_input_identity_are_rejected(four):
    rows=extract_four(four); identity=service.resolve(rows)
    rows[1].sourceHash = '0'*64
    with pytest.raises(PreprocessingFailure, match='EXTRACTION_EVIDENCE_MISMATCH'): service.organize(identity,rows)


def test_name_only_match_stays_separate_with_reason(four):
    four['resolution']['links'][1]['basis']='name_only'
    rows=extract_four(four);identity=service.resolve(rows)
    assert identity.mapping['1:m2']!=identity.mapping['2:m1']
    assert any(d.status=='deferred' and d.reason=='name_only' for d in identity.decisions)


def test_four_episode_semantics_without_a_task_framework(four):
    rows={row['number']:service.extract(EpisodeText(**{k:v for k,v in row.items() if k!='output'})).model_dump() for row in four['episodes']}
    payload=service.organize(service.resolve(rows),rows)
    assert len(payload.cards)==6 and len(payload.relations)==2


@pytest.mark.parametrize('kind', ['fact','event'])
def test_explicit_plan_cannot_be_promoted_by_changing_both_labels(monkeypatch,kind):
    data=proposed(); data['statements'][0].update(kind=kind,certainty='asserted',occurredEpisode=1,document='memory')
    with pytest.raises(PreprocessingFailure,match='UNCERTAIN_SOURCE_AS_FACT'): run_extract(monkeypatch,data)


def test_other_character_cannot_receive_unmentioned_secret(four):
    data=four['episodes'][2]; quote='낯선이는 객주에 있었다.'
    data['body']+='\n'+quote
    data['output']['mentions'].append({'id':'m2','name':'낯선이','kind':'character','quote':quote})
    data['output']['statements'][2]['knowers'].append('m2')
    with pytest.raises(PreprocessingFailure,match='KNOWLEDGE_NOT_EXPLICIT'): extract_four(four)


def test_later_soul_cannot_change_global_soul(four):
    data=four['episodes'][2]; quote='길동은 이제 냉혹하게 말하는 성격으로 변했다.'
    data['body']+='\n'+quote
    data['output']['statements'].append({'id':'s4','kind':'description','certainty':'asserted','subjects':['m1'],'knowers':['m1'],'document':'soul','occurredEpisode':None,'knownFromEpisode':3,'quote':quote})
    rows=extract_four(four);identity=service.resolve(rows);payload=service.organize(identity,rows)
    hero=next(c for c in payload.cards if c.key==identity.mapping['1:m1'])
    assert '냉혹' not in hero.body+hero.title+hero.characterDocs.soul+hero.characterDocs.goal
    assert '냉혹' in hero.characterDocs.episodes['03']


def test_duplicate_claim_is_not_silently_dropped(four):
    data=four['episodes'][0]['output']; duplicate=copy.deepcopy(data['statements'][0]);duplicate['id']='s4';data['statements'].append(duplicate)
    with pytest.raises(PreprocessingFailure,match='DUPLICATE_STATEMENT'): extract_four(four)


def test_resolution_is_bound_to_extraction_not_only_original_source(four):
    rows=extract_four(four); identity=service.resolve(rows)
    rows[3].statements[2].knowers=[]
    with pytest.raises(PreprocessingFailure,match='IDENTITY_INPUT_MISMATCH'): service.organize(identity,rows)


def test_unrepresentable_statement_blocks_payload_instead_of_disappearing(four):
    four['episodes'][1]['output']['statements'][0]['knowers']=[]
    rows=extract_four(four);identity=service.resolve(rows)
    with pytest.raises(PreprocessingFailure,match='UNREPRESENTABLE_STATEMENT'): service.organize(identity,rows)


def test_relation_label_change_requires_content_identity_contract(four):
    four['episodes'][3]['output']['relationships'][0].update(change='changed',ended=False)
    with pytest.raises(PreprocessingFailure,match='RELATION_CHANGE_NOT_REPRESENTABLE'): extract_four(four)


def test_full_document_limit_is_not_satisfied_by_truncation(monkeypatch):
    data=proposed(); body='길동 '+('가'*2990)
    data['mentions'][0]['quote']=body
    data['statements'][0].update(quote=body,kind='description',certainty='asserted',document='soul')
    monkeypatch.setattr(service.agent,'resolve',lambda rows:{'links':[]})
    rows={1:run_extract(monkeypatch,data,body)};identity=service.resolve(rows)
    with pytest.raises(PreprocessingFailure,match='INVALID_LOAD_PAYLOAD'): service.organize(identity,rows)


def test_future_secret_cannot_be_relabelled_as_episode_zero(four):
    four['episodes'][2]['output']['statements'][2].update(occurredEpisode=0,knownFromEpisode=0)
    with pytest.raises(PreprocessingFailure,match='PRESTORY_EVIDENCE_REQUIRED'): extract_four(four)


def test_late_revealed_preexisting_memory_cannot_backfill_old_character(four):
    data=four['episodes'][2];quote='길동은 이야기 시작 전부터 왕의 비밀을 알고 있었다.'
    data['body']+='\n'+quote
    data['output']['statements'].append({'id':'s4','kind':'fact','certainty':'asserted','subjects':['m1'],'knowers':['m1'],'document':'memory','occurredEpisode':0,'knownFromEpisode':0,'quote':quote})
    rows=extract_four(four);identity=service.resolve(rows)
    with pytest.raises(PreprocessingFailure,match='RETROACTIVE_MEMORY_NOT_REPRESENTABLE'):service.organize(identity,rows)
