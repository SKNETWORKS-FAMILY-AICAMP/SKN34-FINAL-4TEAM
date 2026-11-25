import json

import pytest

from app.content_mcp.errors import ContentMcpFailure
from app.world_review import service
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import MAX_CARD_CHARS, MAX_CARDS, EnrichResult, FillResult, ImpactResult, WorldReviewResult

from .stubs import (CONTEXT, PLANS, REL, affected, card, fake_agent, fake_enrich, fake_fill, fake_impact, fake_openai, fill_line, fill_request, finding,
                    fix, request)


def test_a_valid_review_is_returned_with_the_reviewed_card_count_and_model(monkeypatch):
    replacement = fix(target='episode', episode=0, text='새 00회차')
    fake_agent(monkeypatch, finding(card_ids=('seoyun', 'war'), kind='doc_role', fix=replacement),
               finding(card_ids=('rule',), kind='other', message='규칙이 모자란다.'))

    result = service.review(request())

    assert [f.kind for f in result.findings] == ['doc_role', 'other']
    assert result.findings[0].fix == replacement and result.findings[1].fix is None
    assert (result.reviewedCards, result.model) == (3, 'resolved-model')


def test_relationships_to_cards_that_were_not_sent_are_not_sent(monkeypatch):
    seen = fake_agent(monkeypatch)

    service.review(request(relationships=[REL, {**REL, 'id': 'rel-2', 'targetCardId': 'ghost'}]))

    assert [r.id for r in seen['data'].relationships] == ['rel-1']


def test_no_cards_means_no_model_call_and_an_empty_review(monkeypatch):
    seen = fake_agent(monkeypatch)

    result = service.review(request(cards=[], relationships=[]))

    assert seen == {} and (result.findings, result.reviewedCards) == ([], 0)


@pytest.mark.parametrize('bad', [
    finding(card_ids=('ghost',)),                                                       # 입력에 없는 카드
    finding(card_ids=('seoyun', 'ghost')),
    finding(card_ids=()),                                                               # 카드 0개
    finding(message='가' * 301),                                                        # 300자 초과
    finding(message='  '),                                                              # 읽을 문장이 없다
    finding(fix=fix(card_id='war', target='body')),                                     # 수정할 카드가 지적의 카드가 아니다
    finding(fix=fix(card_id='ghost', target='body')),                                   # 입력에 없는 카드
    finding(card_ids=('war',), fix=fix(card_id='war', target='soul')),                  # 인물이 아닌 카드의 SOUL
    finding(card_ids=('war',), fix=fix(card_id='war', target='goal')),
    finding(card_ids=('war',), fix=fix(card_id='war', target='episode', episode=0)),
    finding(fix=fix(target='soul', episode=1)),                                         # 회차는 target=episode일 때만
    finding(fix=fix(target='body', episode=0)),
    finding(fix=fix(target='episode', episode=None)),                                   # target=episode는 회차가 있어야 한다
    finding(fix=fix(target='episode', episode=-1)),
    finding(fix=fix(text='가' * 3001)),                                                 # 카드 본문·문서 한도
    finding(fix=fix(target='body', text='가' * 3001)),
    finding(fix=fix(text=' \n')),                                                      # 칸을 비우는 수정은 수정안이 아니다
])
def test_findings_outside_the_contract_are_errors_not_repaired(monkeypatch, bad):
    fake_agent(monkeypatch, bad)
    with pytest.raises(WorldReviewFailure) as error:
        service.review(request())
    assert error.value.status == 502


def test_four_cards_in_one_finding_is_an_error(monkeypatch):
    world = request(cards=[card(f'c{i}') for i in range(4)], relationships=[])
    fake_agent(monkeypatch, finding(card_ids=('c0', 'c1', 'c2', 'c3')))
    with pytest.raises(WorldReviewFailure) as error:
        service.review(world)
    assert error.value.status == 502


@pytest.mark.parametrize('ok', [
    finding(card_ids=('seoyun', 'war', 'rule')),                                        # 카드 3개
    finding(message='가' * 300),
    finding(card_ids=('war',), fix=fix(card_id='war', target='body', text='가' * 3000)),  # 인물이 아닌 카드는 본문만
    finding(fix=fix(target='body')),                                                    # 인물 카드의 본문(IDENTITY)
    finding(fix=fix(target='goal')),
    finding(fix=fix(target='episode', episode=0)),
    finding(card_ids=('war', 'seoyun'), fix=fix(card_id='seoyun', target='episode', episode=12)),  # 아직 없는 회차 문서도 새로 쓸 수 있다
])
def test_findings_inside_the_contract_pass_unchanged(monkeypatch, ok):
    fake_agent(monkeypatch, ok)
    assert service.review(request()).findings == [ok]


def test_trace_keeps_refs_and_never_the_setting_bodies(monkeypatch, spans):
    fake_openai(monkeypatch, WorldReviewResult(findings=[finding(fix=fix())]))

    service.review(request())

    recorded = {s.name: json.loads(s.attributes['langfuse.observation.input']) for s in spans() if 'langfuse.observation.input' in s.attributes}
    assert recorded['world_review'] == {'cards': ['seoyun', 'war', 'rule'], 'relationships': ['rel-1']}
    assert '약초꾼' not in json.dumps(recorded, ensure_ascii=False) and '달이 둘인 대륙' not in json.dumps(recorded, ensure_ascii=False)


# --- 채팅 경로: 작품에 연결된 세계관을 Content MCP로 읽어 같은 요청으로 만든다 ---------------------------------------------------

def payload(id, card_type='location', body='본문', meta=None, lifecycle='active', area='basic'):
    """`world_studio_read`의 카드 한 장(CardPayload JSON). 인물 문서는 semanticMetadata에 있다."""
    return {'id': id, 'title': id.upper(), 'body': body, 'cardType': card_type, 'areaCode': area, 'classification': '', 'aliases': [], 'tags': [],
            'semanticMetadata': meta or {}, 'visibility': 'private', 'lifecycle': lifecycle}


def link(id, source, target, label='겪음', polarity='asserted', lifecycle='active'):
    return {'id': id, 'sourceCardId': source, 'targetCardId': target, 'category': 'structural', 'body': '긴 설명', 'label': label,
            'direction': 'directed', 'polarity': polarity, 'semanticMetadata': {}, 'lifecycle': lifecycle}


def read(cards, relationships=()):
    return {'worldId': 'world-1', 'draftRevision': 3, 'name': '달빛 세계', 'description': '달이 둘인 대륙', 'cards': cards,
            'relationships': list(relationships), 'visibility': 'private'}


def fake_content(monkeypatch, world, linked='work-1'):
    """Content MCP 대역. 호출한 도구 이름과 인자 목록을 돌려준다."""
    calls = []

    def call(tool, arguments):
        calls.append((tool, arguments))
        if tool == 'world_studio_list':
            return [{'worldId': 'world-1', 'linkedWorkId': 'other'}, {'worldId': 'world-2', 'linkedWorkId': linked}]
        if tool == 'world_studio_read':
            return world
        raise AssertionError(tool)

    monkeypatch.setattr(service.content_mcp, 'call', call)
    return calls


DOCS = {'characterDocs': {'soul': '말수가 적다.', 'goal': '동생을 찾는다.', 'memory': '옛 기억', 'episodes': {'3': '편지를 받았다.'}}}


def test_linked_request_reads_the_latest_world_of_the_work_without_an_episode(monkeypatch):
    calls = fake_content(monkeypatch, read(
        [payload('seoyun', 'character', '29세', meta={**DOCS, 'revealFromEpisode': 2}, area='society'), payload('gone', lifecycle='removed'),
         payload('war', 'event', area='history'), payload('stale', 'location', meta=DOCS)],
        [link('rel-1', 'seoyun', 'war'), link('rel-2', 'seoyun', 'gone'), link('rel-3', 'war', 'seoyun', lifecycle='removed'),
         link('rel-4', 'war', 'seoyun', label='원수', polarity='denied')]))

    data = service.linked_request('work-1')

    # 시뮬레이션이 연결 세계관을 찾는 방식(world_studio_list의 linkedWorkId → world_studio_read)이되, 회차를 지정하지 않아 최신 관계다.
    assert calls == [('world_studio_list', {}), ('world_studio_read', {'id': 'world-2'})]
    assert (data.worldName, data.worldDescription) == ('달빛 세계', '달이 둘인 대륙')
    assert [(c.id, c.cardType, c.areaCode, c.title, c.body) for c in data.cards] == [
        ('seoyun', 'character', 'society', 'SEOYUN', '29세'), ('war', 'event', 'history', 'WAR', '본문'), ('stale', 'location', 'basic', 'STALE', '본문')]
    # 인물 문서는 인물 카드에만 읽고, 옛 memory는 00회차 앞에 이어 붙는다.
    assert data.cards[0].characterDocs.model_dump() == {'soul': '말수가 적다.', 'goal': '동생을 찾는다.', 'episodes': {0: '옛 기억', 3: '편지를 받았다.'}}
    assert data.cards[1].characterDocs is None and data.cards[2].characterDocs is None
    assert [(r.id, r.sourceCardId, r.targetCardId, r.label, r.polarity) for r in data.relationships] == [
        ('rel-1', 'seoyun', 'war', '겪음', 'asserted'), ('rel-4', 'war', 'seoyun', '원수', 'denied')]


def test_linked_request_sends_card_links_as_plain_text_in_the_body_and_the_character_documents(monkeypatch):
    # 채팅 경로의 AI 입력 경계: 모델 입력에 카드 id가 섞이지 않게 대상이 있든 없든 글자만 보낸다(DEC-53).
    link = '[승상](card:aaaaaaaa-2222-3333-4444-555555555555)'
    docs = {'characterDocs': {'soul': f'말투 {link}', 'goal': f'목표 {link}', 'episodes': {'0': f'기억 {link}'}}}
    fake_content(monkeypatch, read([payload('seoyun', 'character', f'앞 {link} 뒤', meta=docs), payload('war', 'event', f'{link}')]))

    cards = service.linked_request('work-1').cards

    assert [c.body for c in cards] == ['앞 승상 뒤', '승상']
    assert cards[0].characterDocs.model_dump() == {'soul': '말투 승상', 'goal': '목표 승상', 'episodes': {0: '기억 승상'}}


def test_linked_request_does_not_send_cards_over_the_limits(monkeypatch):
    cards = [payload(f'c{i}') for i in range(MAX_CARDS + 5)]
    cards[1] = payload('long', body='가' * (MAX_CARD_CHARS + 1))
    fake_content(monkeypatch, read(cards, [link('r', 'c0', 'long'), link('s', 'c0', 'c2')]))

    data = service.linked_request('work-1')

    ids = [c.id for c in data.cards]
    assert len(ids) == MAX_CARDS and 'long' not in ids and ids[:3] == ['c0', 'c2', 'c3']
    assert [r.id for r in data.relationships] == ['s']  # 보내지 않은 카드에 이어진 관계는 뺀다


def test_a_work_without_a_linked_world_fails_with_a_reason_the_author_can_read(monkeypatch):
    calls = fake_content(monkeypatch, read([payload('a')]), linked='other-work')

    with pytest.raises(WorldReviewFailure) as error:
        service.linked_request('work-1')

    assert error.value.status == 409 and '연결된 세계관' in str(error.value) and [t for t, _ in calls] == ['world_studio_list']


@pytest.mark.parametrize('world', [{'worldId': 'world-1'}, {**read([payload('a')]), 'cards': 'x'}, read([{**payload('a'), 'areaCode': 'sky'}]),
                                   read([payload('a')], [{'sourceCardId': 'a', 'targetCardId': 'a'}])])  # 관계에 id가 없다
def test_an_unreadable_content_response_is_502_without_echoing_it(monkeypatch, world):
    fake_content(monkeypatch, world)
    with pytest.raises(WorldReviewFailure) as error:
        service.linked_request('work-1')
    assert error.value.status == 502 and 'sky' not in str(error.value)


def test_content_failures_keep_their_status_and_message(monkeypatch):
    def call(tool, arguments):
        raise ContentMcpFailure(404, '세계관을 찾을 수 없어요.')

    monkeypatch.setattr(service.content_mcp, 'call', call)
    with pytest.raises(ContentMcpFailure) as error:
        service.linked_request('work-1')
    assert (error.value.status, str(error.value)) == (404, '세계관을 찾을 수 없어요.')


# --- linked_world: enrich가 반영할 세계관의 id와 읽은 초안 revision ---------------------------------------------------------------

def test_linked_world_returns_the_request_with_the_linked_world_id_and_the_draft_revision_it_read(monkeypatch):
    fake_content(monkeypatch, read([payload('seoyun', 'character', '29세', area='society')]))

    data, world_id, revision = service.linked_world('work-1')

    # 연결 세계관 id는 world_studio_list의 linkedWorkId로 찾은 것이고, revision은 그 세계관을 읽은 응답의 draftRevision이다.
    assert (world_id, revision) == ('world-2', 3) and [c.id for c in data.cards] == ['seoyun']
    assert data == service.linked_request('work-1')


@pytest.mark.parametrize('world', [{**read([payload('a')]), 'draftRevision': None}, {k: v for k, v in read([payload('a')]).items() if k != 'draftRevision'}])
def test_a_world_read_without_a_usable_draft_revision_is_502_because_enrich_could_not_check_it_later(monkeypatch, world):
    fake_content(monkeypatch, world)
    with pytest.raises(WorldReviewFailure) as error:
        service.linked_world('work-1')
    assert error.value.status == 502


# --- enrich ---------------------------------------------------------------------------------------------------------------------

def test_enrich_returns_the_proposed_cells_with_titles_filled_from_the_input(monkeypatch):
    seen = fake_enrich(monkeypatch, fix(target='soul', text='더 자세한 SOUL'), fix(card_id='war', target='body', text='북방 전쟁은 10년 전에 일어났다.'),
                       fix(target='episode', episode=12, text='아직 없는 회차 문서'), note='서윤의 문서를 보강했어요.')

    result = service.enrich('서윤과 전쟁을 자세히', request(), 'world-1', 3)

    assert (seen['request'], seen['data']) == ('서윤과 전쟁을 자세히', request())
    assert (result.worldId, result.revision, result.note, result.model) == ('world-1', 3, '서윤의 문서를 보강했어요.', 'resolved-model')
    assert [(f.cardId, f.cardTitle, f.target, f.episode, f.text) for f in result.fixes] == [
        ('seoyun', '서윤', 'soul', None, '더 자세한 SOUL'), ('war', '북방 전쟁', 'body', None, '북방 전쟁은 10년 전에 일어났다.'),
        ('seoyun', '서윤', 'episode', 12, '아직 없는 회차 문서')]


def test_enrich_without_cards_is_a_conflict_the_author_can_read_and_never_calls_the_model(monkeypatch):
    seen = fake_enrich(monkeypatch, fix())

    with pytest.raises(WorldReviewFailure) as error:
        service.enrich('보강해줘', request(cards=[], relationships=[]), 'world-1', 3)

    assert error.value.status == 409 and '카드' in str(error.value) and seen == {}


@pytest.mark.parametrize('fixes, note', [
    ((), '설명'),                                                                              # 제안이 하나도 없다
    ((fix(target='body'), fix(target='soul'), fix(target='goal'), fix(target='episode', episode=0), fix(target='episode', episode=1),
      fix(card_id='war', target='body')), '설명'),                                            # 서로 다른 칸 6개(상한은 5)
    ((fix(card_id='ghost', target='body'),), '설명'),                                          # 입력에 없는 카드
    ((fix(card_id='war', target='soul'),), '설명'),                                             # 인물이 아닌 카드의 SOUL
    ((fix(card_id='war', target='goal'),), '설명'),
    ((fix(card_id='war', target='episode', episode=0),), '설명'),
    ((fix(target='soul', episode=1),), '설명'),                                                 # 회차는 target=episode일 때만
    ((fix(target='body', episode=0),), '설명'),
    ((fix(target='episode', episode=None),), '설명'),
    ((fix(target='episode', episode=-1),), '설명'),
    ((fix(text='가' * 3001),), '설명'),                                                         # 칸 한도
    ((fix(text=' \n'),), '설명'),                                                              # 칸을 비우는 수정은 수정안이 아니다
    ((fix(target='soul', text='하나'), fix(target='soul', text='둘')), '설명'),                  # 같은 칸을 두 번 고친다
    ((fix(target='episode', episode=3, text='하나'), fix(target='episode', episode=3, text='둘')), '설명'),
    ((fix(),), '가' * 301),                                                                     # note 300자 초과
])
def test_enrich_outside_the_contract_is_an_error_not_repaired(monkeypatch, fixes, note):
    fake_enrich(monkeypatch, *fixes, note=note)
    with pytest.raises(WorldReviewFailure) as error:
        service.enrich('보강해줘', request(), 'world-1', 3)
    assert error.value.status == 502


def test_enrich_accepts_five_different_cells_and_a_300_char_note(monkeypatch):
    cells = [fix(target='body'), fix(target='soul'), fix(target='goal'), fix(target='episode', episode=0), fix(card_id='war', target='body')]
    fake_enrich(monkeypatch, *cells, note='가' * 300)
    assert len(service.enrich('보강해줘', request(), 'world-1', 3).fixes) == 5


def test_enrich_trace_keeps_the_request_and_refs_and_never_the_setting_bodies(monkeypatch, spans):
    fake_openai(monkeypatch, EnrichResult(fixes=[fix(text='서윤은 약초꾼이다.')], note='보강'))

    service.enrich('서윤을 자세히', request(), 'world-1', 3)

    recorded = {s.name: json.loads(s.attributes['langfuse.observation.input']) for s in spans() if 'langfuse.observation.input' in s.attributes}
    assert recorded['world_review.enrich'] == {'request': '서윤을 자세히', 'cards': ['seoyun', 'war', 'rule'], 'relationships': ['rel-1']}
    assert '달이 둘인 대륙' not in json.dumps(recorded['world_review.enrich'], ensure_ascii=False)


# --- impact ---------------------------------------------------------------------------------------------------------------------

def test_impact_returns_the_analysis_and_sends_the_snapshot_context_and_plans_as_they_are(monkeypatch):
    seen = fake_impact(monkeypatch, affected(), affected(kind='relationship', ref='rel-1', title='겪음', certainty='inferred'),
                       affected(kind='episode', ref='3', title='3화'), affected(kind='scene', ref='scene-1', title='재회'),
                       conflicts=['3화의 나이와 충돌한다.'], gaps=['5화 계획의 나이를 알 수 없다.'])

    result = service.impact('서윤의 나이를 바꾸면?', request(), CONTEXT, PLANS)

    assert (seen['request'], seen['data'], seen['context'], seen['plans']) == ('서윤의 나이를 바꾸면?', request(), CONTEXT, PLANS)
    assert [(a.kind, a.ref, a.certainty) for a in result.affected] == [
        ('card', 'seoyun', 'confirmed'), ('relationship', 'rel-1', 'inferred'), ('episode', '3', 'confirmed'), ('scene', 'scene-1', 'confirmed')]
    assert (result.conflicts, result.gaps, result.model) == (['3화의 나이와 충돌한다.'], ['5화 계획의 나이를 알 수 없다.'], 'resolved-model')


@pytest.mark.parametrize('ok', [
    affected(kind='episode', ref='4'),                 # 원고 문맥의 기준 회차(지금 쓰는 회차)
    affected(kind='scene', ref='plot-1', title='남매'),  # 계획 목록의 항목(플롯 계획도 계획이다)
])
def test_impact_accepts_the_current_episode_and_any_plan_item(monkeypatch, ok):
    fake_impact(monkeypatch, ok)
    assert service.impact('영향은?', request(), CONTEXT, PLANS).affected == [ok]


@pytest.mark.parametrize('bad', [
    affected(kind='card', ref='ghost'),                  # 입력에 없는 카드
    affected(kind='card', ref='rel-1'),                  # 관계 id를 카드로 인용
    affected(kind='relationship', ref='seoyun'),         # 카드 id를 관계로 인용
    affected(kind='relationship', ref='ghost'),
    affected(kind='episode', ref='9'),                   # 원고 문맥에 없는 회차
    affected(kind='episode', ref='3화'),                  # 회차 번호는 숫자만
    affected(kind='episode', ref='seoyun'),
    affected(kind='scene', ref='ghost'),                 # 계획에 없는 장면
    affected(kind='scene', ref='5'),                     # 장면은 계획 id로만 가리킨다
    affected(reason=' '), affected(reason='가' * 301), affected(title=''),
])
def test_impact_refs_outside_the_input_are_an_error_not_repaired(monkeypatch, bad):
    fake_impact(monkeypatch, affected(), bad)
    with pytest.raises(WorldReviewFailure) as error:
        service.impact('영향은?', request(), CONTEXT, PLANS)
    assert error.value.status == 502


@pytest.mark.parametrize('field', ['conflicts', 'gaps'])
@pytest.mark.parametrize('sentence', [' ', '가' * 301])
def test_impact_conflict_and_gap_sentences_must_be_readable_and_within_300_chars(monkeypatch, field, sentence):
    fake_impact(monkeypatch, **{field: [sentence]})
    with pytest.raises(WorldReviewFailure) as error:
        service.impact('영향은?', request(), CONTEXT, PLANS)
    assert error.value.status == 502


def test_impact_without_findings_is_a_valid_empty_analysis(monkeypatch):
    fake_impact(monkeypatch)
    result = service.impact('영향은?', request(cards=[], relationships=[]), {**CONTEXT, 'episodes': []}, [])
    assert (result.affected, result.conflicts, result.gaps) == ([], [], [])


@pytest.mark.parametrize('context, plans', [({'title': '달빛'}, PLANS), (CONTEXT, [{'title': '제목뿐'}]), (CONTEXT, 'x'), ('x', PLANS)])
def test_unreadable_context_or_plans_from_content_are_502_without_a_model_call(monkeypatch, context, plans):
    seen = fake_impact(monkeypatch)
    with pytest.raises(WorldReviewFailure) as error:
        service.impact('영향은?', request(), context, plans)
    assert error.value.status == 502 and seen == {}


def test_impact_trace_keeps_the_request_and_refs_and_never_the_setting_bodies(monkeypatch, spans):
    fake_openai(monkeypatch, ImpactResult(affected=[affected()], conflicts=[], gaps=[]))

    service.impact('서윤의 나이를 바꾸면?', request(), CONTEXT, PLANS)

    recorded = {s.name: json.loads(s.attributes['langfuse.observation.input']) for s in spans() if 'langfuse.observation.input' in s.attributes}
    assert recorded['world_review.impact'] == {'request': '서윤의 나이를 바꾸면?', 'cards': ['seoyun', 'war', 'rule'], 'relationships': ['rel-1']}
    assert '남매가 다시 만난다' not in json.dumps(recorded, ensure_ascii=False)


# --- fill: 한 인물의 비어 있는 IDENTITY·SOUL을 원고 발췌의 문장으로 채운다(근거 없는 줄은 만들 수 없다) -----------------------------------

BODY = fill_line('body', 'description', 2, '키가 작고 얼굴이 검게 탔다.')               # 2화(첫 등장)의 문장이라 IDENTITY에 쓸 수 있다
SOUL = fill_line('soul', 'description', 4, '"됐어, 난 안 할 거야." 치삼이 퉁명스럽게 말했다.')  # 4화의 문장은 SOUL에만 쓸 수 있다


def test_fill_keeps_the_lines_whose_quote_is_in_the_stated_episode_in_the_models_order(monkeypatch):
    seen = fake_fill(monkeypatch, SOUL, BODY)

    result = service.fill(fill_request())

    assert result.lines == [SOUL, BODY] and (result.skipped, result.model) == (0, 'resolved-model')
    assert seen['data'] == fill_request()


def test_fill_without_any_evidence_is_an_empty_result_not_an_error(monkeypatch):
    fake_fill(monkeypatch)

    result = service.fill(fill_request())

    assert (result.lines, result.skipped) == ([], 0)


LONG = '가' * 400
TWO = [{'episode': 2, 'text': '키가 작다.'}, {'episode': 2, 'text': '얼굴이 검다.'}]
SENTENCES = [f'치삼은 {n}번째 버릇이 있다.' for n in range(9)]


@pytest.mark.parametrize('request_patch, good, bad', [
    ({}, BODY, fill_line('body', 'fact', 2, '키가 크고 힘이 세다.')),                                    # 발췌에 없는 문장(지어냄)
    ({}, BODY, fill_line('soul', 'description', 2, SOUL.quote)),                                        # 문장은 4화에 있는데 2화라고 했다
    ({}, SOUL, fill_line('body', 'description', 4, SOUL.quote)),                                        # IDENTITY는 첫 등장 회차(2화)의 발췌에서만
    ({'targets': ['body']}, BODY, SOUL),                                                                # 채우라고 하지 않은 문서
    ({'passages': [{'episode': 2, 'text': LONG}]}, fill_line('soul', 'fact', 2, '가' * 10), fill_line('soul', 'fact', 2, LONG)),  # 한 줄 300자 초과
    ({}, BODY, fill_line('soul', 'fact', 2, '  \n')),                                                  # 읽을 문장이 없다
    ({'passages': TWO}, fill_line('soul', 'fact', 2, '키가 작다.'), fill_line('soul', 'fact', 2, '키가 작다.얼굴이 검다.')),  # 두 발췌를 이어 붙인 문장은 원문이 아니다
    ({}, BODY, fill_line('soul', 'fact', 9, SOUL.quote)),                                               # 보내지 않은 회차
])
def test_fill_drops_a_line_it_cannot_verify_and_counts_it(monkeypatch, request_patch, good, bad):
    fake_fill(monkeypatch, good, bad)

    result = service.fill(fill_request(**request_patch))

    assert result.lines == [good] and result.skipped == 1


def test_fill_when_every_proposed_line_is_unverifiable_the_model_output_is_not_trusted(monkeypatch):
    fake_fill(monkeypatch, fill_line('body', 'fact', 2, '키가 크고 힘이 세다.'), fill_line('soul', 'fact', 4, '지어낸 말투'))

    with pytest.raises(WorldReviewFailure) as error:
        service.fill(fill_request())

    assert error.value.status == 502


def test_fill_keeps_at_most_8_lines_per_document(monkeypatch):
    text = ' '.join(SENTENCES)
    fake_fill(monkeypatch, *[fill_line('soul', 'description', 3, sentence) for sentence in SENTENCES])

    result = service.fill(fill_request(passages=[{'episode': 3, 'text': text}], targets=['soul']))

    assert [line.quote for line in result.lines] == SENTENCES[:8] and result.skipped == 1


def test_fill_trims_the_quote_and_a_repeated_line_is_kept_once_without_counting(monkeypatch):
    padded = fill_line('body', 'description', 2, '  키가 작고 얼굴이 검게 탔다.\n')
    fake_fill(monkeypatch, padded, BODY, SOUL)

    result = service.fill(fill_request())

    assert result.lines == [BODY, SOUL] and result.skipped == 0


def test_fill_trace_keeps_refs_and_never_the_manuscript_or_the_names(monkeypatch, spans):
    fake_openai(monkeypatch, FillResult(lines=[BODY]))

    service.fill(fill_request())

    recorded = {s.name: json.loads(s.attributes['langfuse.observation.input']) for s in spans() if 'langfuse.observation.input' in s.attributes}
    refs = {'cardId': 'chisam', 'targets': ['body', 'soul'], 'episodes': [2, 4]}
    assert recorded['world_review.fill'] == refs and recorded['world_review.fill.generation'] == refs
    assert '소금장수' not in json.dumps(recorded, ensure_ascii=False) and '치삼' not in json.dumps(recorded, ensure_ascii=False)
