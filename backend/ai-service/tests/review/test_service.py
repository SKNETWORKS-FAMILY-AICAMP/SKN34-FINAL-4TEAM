import pytest

from app.review import service
from app.review.errors import ReviewFailure
from app.review.models import ReviewRequest, ReviewResult

from .stubs import NO_INHERITED, WORK, WORLD, fake_agent, fake_content, finding


def mechanical():
    return ReviewRequest(workId=WORK, episode=3, check='mechanical')


def semantic():
    return ReviewRequest(workId=WORK, episode=3, check='semantic')


def test_mechanical_reads_only_the_draft_and_locates_the_quote_in_utf16(monkeypatch):
    calls = fake_content(monkeypatch, body='😀 비가 왔다. 서윤은 웃엇다.')
    seen = fake_agent(monkeypatch, finding(), gaps=['날짜 비교 대상 없음'])

    result = service.review(mechanical())

    # 맞춤법 검수는 세계관·시뮬레이션 없이 초안 하나로 끝난다.
    assert [tool for tool, _ in calls] == ['episode_read']
    assert seen == {'check': 'mechanical', 'draft': '😀 비가 왔다. 서윤은 웃엇다.', 'settings': []}
    # 이모지는 UTF-16 두 단위다.
    assert (result.findings[0].start, result.findings[0].end) == (10, 18)
    assert (result.workId, result.episode, result.revision, result.check) == (WORK, 3, 4, 'mechanical')
    assert result.gaps == ['날짜 비교 대상 없음']
    assert result.model == 'resolved-model'


def test_quote_found_twice_has_no_location_and_is_not_confirmed(monkeypatch):
    fake_content(monkeypatch, body='웃엇다. 그리고 또 웃엇다.')
    fake_agent(monkeypatch, finding(quote='웃엇다.'))

    found = service.review(mechanical()).findings[0]

    # 위치를 확인하지 못한 지적은 확정 오류가 아니다(설계: 원고 위치가 확인된 경우만 확정).
    assert (found.start, found.end, found.status) == (None, None, 'suspected')


def test_overlapping_quote_counts_as_twice(monkeypatch):
    # str.count는 겹치는 출현을 한 번으로 센다('하하하'에서 '하하'는 0·1 두 곳, #390).
    fake_content(monkeypatch, body='하하하')
    fake_agent(monkeypatch, finding(quote='하하'))
    found = service.review(mechanical()).findings[0]
    assert (found.start, found.end, found.status) == (None, None, 'suspected')


@pytest.mark.parametrize('bad', [
    finding(quote='원고에 없는 문장'),             # 원고에 없는 구절
    finding(category='setting'),                   # Mechanical에 Semantic 분류
    finding(refs=['card:seoyun']),                 # Mechanical은 설정 근거를 받지 않았다
])
def test_mechanical_findings_outside_the_input_are_errors(monkeypatch, bad):
    fake_content(monkeypatch)
    fake_agent(monkeypatch, bad)
    with pytest.raises(ReviewFailure) as error:
        service.review(mechanical())
    assert error.value.status == 502


def test_empty_draft_is_422_without_model_call(monkeypatch):
    fake_content(monkeypatch, body='   ')
    seen = fake_agent(monkeypatch)
    with pytest.raises(ReviewFailure) as error:
        service.review(mechanical())
    assert error.value.status == 422
    assert seen == {}


def test_semantic_sends_settings_visible_at_the_episode(monkeypatch):
    calls = fake_content(monkeypatch)
    seen = fake_agent(monkeypatch, finding(category='setting', refs=['card:seoyun']))

    result = service.review(semantic())

    assert calls[-1] == ('world_studio_read', {'id': 'world-1', 'episode': '3'})
    refs = [s['ref'] for s in seen['settings']]
    # 7화 공개 카드와 그 카드에 걸린 관계는 3화 검수 근거가 아니다.
    assert refs == ['card:seoyun']
    seoyun = seen['settings'][0]
    assert '편지를 받았다' in seoyun['text'] and '비밀을 안다' not in seoyun['text']
    assert result.findings[0].evidenceRefs == ['card:seoyun']


def test_semantic_sends_relations_between_visible_cards(monkeypatch):
    world = {**WORLD, 'cards': WORLD['cards'] + [{'id': 'mother', 'cardType': 'character', 'title': '어머니', 'body': '고향에 산다.'}],
             'relationships': WORLD['relationships'] + [
                 {'id': 'rel-2', 'sourceCardId': 'seoyun', 'targetCardId': 'mother', 'label': '연락함', 'polarity': 'denied'}]}
    fake_content(monkeypatch, world=world)
    seen = fake_agent(monkeypatch, finding(category='setting', refs=['relation:rel-2']))

    service.review(semantic())

    relation = next(s for s in seen['settings'] if s['ref'] == 'relation:rel-2')
    assert relation == {'ref': 'relation:rel-2', 'type': 'relation', 'title': '서윤 → 어머니', 'text': '연락함(아님)'}
    assert 'relation:rel-1' not in [s['ref'] for s in seen['settings']]


@pytest.mark.parametrize('bad', [
    finding(category='setting', refs=['card:secret']),              # 보내지 않은 설정
    finding(category='setting', refs=[]),                            # 근거 없는 확정
    finding(category='spelling', refs=['card:seoyun']),              # Semantic에 Mechanical 분류
])
def test_semantic_findings_without_allowed_evidence_are_errors(monkeypatch, bad):
    fake_content(monkeypatch)
    fake_agent(monkeypatch, bad)
    with pytest.raises(ReviewFailure) as error:
        service.review(semantic())
    assert error.value.status == 502


def test_semantic_suspicion_may_have_no_evidence(monkeypatch):
    fake_content(monkeypatch)
    fake_agent(monkeypatch, finding(category='emotion', status='suspected'))
    assert service.review(semantic()).findings[0].status == 'suspected'


@pytest.mark.parametrize('world', [[], None, {'worldId': 'world-1'}, {'worldId': 'world-1', 'cards': [{'id': 'c'}]}])
def test_semantic_with_malformed_world_read_is_502(monkeypatch, world):
    # 세계관 응답 형식 오류는 처리되지 않은 500이 아니라 정해진 502다(#392).
    fake_content(monkeypatch, world=world)
    fake_agent(monkeypatch)
    with pytest.raises(ReviewFailure) as error:
        service.review(semantic())
    assert (error.value.status, str(error.value)) == (502, service.BAD_CONTENT)


def test_semantic_of_a_fork_without_a_world_of_its_own_uses_the_inherited_original_world(monkeypatch):
    inherited = {**NO_INHERITED, 'worldId': 'world-1', 'upto': 3, 'cards': [{**WORLD['cards'][0], 'semanticMetadata': {'revealFromEpisode': 1}}]}
    calls = fake_content(monkeypatch, linked='other-work', inherited=inherited)
    seen = fake_agent(monkeypatch, finding(category='setting', refs=['card:seoyun']))

    service.review(semantic())

    assert calls[-1] == ('work_inherited_world', {'id': WORK, 'upto': '3'})
    assert 'world_studio_read' not in [tool for tool, _ in calls]
    assert [s['ref'] for s in seen['settings']] == ['card:seoyun']


def test_semantic_without_linked_world_is_409(monkeypatch):
    fake_content(monkeypatch, linked='other-work')
    seen = fake_agent(monkeypatch)
    with pytest.raises(ReviewFailure) as error:
        service.review(semantic())
    assert error.value.status == 409
    assert seen == {}


def test_both_reads_once_runs_semantic_and_mechanical_and_lists_semantic_first(monkeypatch):
    calls = fake_content(monkeypatch, body='비가 왔다. 서윤은 웃엇다.')
    seen = []

    def review(check, draft, settings):
        seen.append((check, len(settings)))
        found = finding(category='setting', refs=['card:seoyun']) if check == 'semantic' else finding()
        usage = {'inputTokens': 10, 'outputTokens': 2}
        return ReviewResult(findings=[found], gaps=[f'{check} 빈 곳']), {'model': 'm', 'providerResponseId': f'resp-{check}', 'usage': usage}

    monkeypatch.setattr(service.agent, 'review', review)
    result = service.review(ReviewRequest(workId=WORK, episode=3, check='both'))

    # 초안·세계관은 한 번만 읽고, 검수 두 개는 각자의 입력(Mechanical은 설정 없음)으로 부른다.
    assert [tool for tool, _ in calls] == ['episode_read', 'world_studio_list', 'world_studio_read']
    assert sorted(seen) == [('mechanical', 0), ('semantic', 1)]
    assert result.check == 'both' and [f.category for f in result.findings] == ['setting', 'spelling']
    assert result.gaps == ['semantic 빈 곳', 'mechanical 빈 곳']
    assert result.providerResponseId == 'resp-semantic,resp-mechanical'
    assert (result.usage.inputTokens, result.usage.outputTokens) == (20, 4)


def test_both_still_checks_each_finding_against_its_own_check(monkeypatch):
    fake_content(monkeypatch)

    def review(check, draft, settings):  # Mechanical 결과가 설정 근거를 인용했다
        return ReviewResult(findings=[finding(refs=['card:seoyun'])], gaps=[]), {'model': 'm', 'providerResponseId': 'r', 'usage': None}

    monkeypatch.setattr(service.agent, 'review', review)
    with pytest.raises(ReviewFailure) as error:
        service.review(ReviewRequest(workId=WORK, episode=3, check='both'))
    assert error.value.status == 502
