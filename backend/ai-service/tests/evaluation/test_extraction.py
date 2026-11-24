"""추출 평가 세트(extraction.extract)의 생성·코드 채점(app/evaluation/extraction.py): 서비스 호출 그대로 만들고 정답표와 코드로 대조한다. 모델 호출은 대역이다."""

import pytest

from app.evaluation import extraction
from app.evaluation.errors import EvaluationFailure
from app.manuscript_extraction import service
from app.manuscript_extraction.errors import PreprocessingFailure

Q1, Q2, Q3, Q4, Q5 = ('김 첨지는 새벽부터 인력거를 끌고 나갔다.', '치삼이는 김 첨지의 오랜 친구였다.', '아내는 병석에 누워 설렁탕이 먹고 싶다고 했다.',
                      '김 첨지는 설렁탕을 사 가겠다고 약속했다.', '그는 동광학교 앞에서 손님을 태웠다.')
BODY = '\n'.join((Q1, Q2, Q3, Q4, Q5))
INPUT = {'number': 1, 'title': '운수 좋은 날', 'body': BODY}


def mention(name, kind='character', core=True, aliases=()):
    return {'name': name, 'kind': kind, 'aliases': list(aliases), 'core': core}


GOLD = {'mentions': [mention('김 첨지', aliases=['김첨지']), mention('치삼'), mention('동광학교', 'location'), mention('설렁탕', 'object', core=False), mention('아내', core=False)],
        'statements': [{'kind': 'event', 'quote': Q1, 'core': True}, {'kind': 'fact', 'quote': Q2, 'core': True}, {'kind': 'event', 'quote': Q5, 'core': True},
                       {'kind': 'plan', 'quote': Q4, 'core': False}],
        'relationships': [{'source': '치삼', 'target': '김 첨지', 'label': '친구', 'core': True}, {'source': '김 첨지', 'target': '아내', 'label': '가족', 'core': False}]}
OUTPUT = {'mentions': [{'id': 'm1', 'name': '김첨지', 'kind': 'character', 'quote': Q1}, {'id': 'm2', 'name': '치삼이', 'kind': 'location', 'quote': Q2},
                       {'id': 'm3', 'name': '인력거', 'kind': 'object', 'quote': Q1}],
          'statements': [{'id': 's1', 'kind': 'event', 'quote': Q1}, {'id': 's2', 'kind': 'fact', 'quote': Q2}, {'id': 's3', 'kind': 'event', 'quote': Q3}],
          'relationships': [{'id': 'r1', 'source': 'm1', 'target': 'm2', 'label': '친구들', 'quote': Q2}],
          'skipped': {'INVALID_OR_AMBIGUOUS_QUOTE': 1}}


@pytest.mark.parametrize('a, b, same', [
    ('김 첨지', '김첨지', True),           # 공백은 보지 않는다
    ('김 첨지', '첨지', True),             # 짧은 쪽이 두 글자 이상이고 들어 있다
    ('점순', '점순이', True),
    ('Harry Potter', 'harry  potter', True),   # 대소문자·공백
    ('치삼', '김 첨지', False),
    ('길', '길동', False),                 # 한 글자는 포함으로 맞추지 않는다
    ('길', '길', True),                   # 같은 한 글자는 같다
    ('', '길동', False), ('...', '길동', False),   # 접은 뒤 빈 호칭은 맞지 않는다
])
def test_names_match_by_equality_or_a_contained_name_of_two_or_more_characters(a, b, same):
    assert extraction.names_match(a, b) is same and extraction.names_match(b, a) is same


def test_recall_is_the_mean_of_the_core_recalls_of_mentions_statements_and_relationships():
    result = extraction.score(BODY, OUTPUT, GOLD)

    assert result['recalls'] == {'mentions': pytest.approx(2 / 3), 'statements': pytest.approx(2 / 3), 'relationships': 1.0}   # 동광학교·Q5를 놓쳤고 관계는 방향이 거꾸로여도 맞춘 것이다
    assert result['recall'] == pytest.approx((2 / 3 + 2 / 3 + 1) / 3)


def test_only_the_core_answers_count_for_recall_so_an_unlisted_extra_is_not_a_miss():
    gold = {**GOLD, 'mentions': [mention('김 첨지'), mention('설렁탕', 'object', core=False)], 'statements': [], 'relationships': []}

    got = extraction.score(BODY, {**OUTPUT, 'mentions': OUTPUT['mentions'][:1]}, gold)

    assert got['recall'] == 1.0   # 설렁탕은 core가 아니라 빠뜨려도 재현율에 영향이 없다
    assert got['recalls'] == {'mentions': 1.0, 'statements': None, 'relationships': None}   # core가 없는 종류는 평균에서 뺀다


def test_precision_is_against_the_union_of_the_answers_and_the_kind_direction_and_label_are_reference_only():
    reference = extraction.score(BODY, OUTPUT, GOLD)['reference']

    assert reference['precision'] == {'mentions': pytest.approx(2 / 3), 'statements': pytest.approx(2 / 3), 'relationships': 1.0}   # 인력거·Q3은 정답표에 없다
    assert reference['kind_match'] == 0.5   # 김첨지는 종류까지 맞고 치삼이는 location으로 뽑아 어긋났다
    assert reference['direction'] == 0.0 and reference['label'] == 1.0   # 정답은 치삼 → 김 첨지, 추출은 거꾸로. 라벨 친구들은 친구를 포함한다


def test_precision_counts_a_match_with_a_non_core_answer_as_right_while_recall_asks_only_for_the_core():
    output = {'mentions': [{'id': 'a', 'name': '김 첨지', 'kind': 'character', 'quote': Q1}, {'id': 'b', 'name': '아내', 'kind': 'character', 'quote': Q3}],
              'statements': [{'id': 's', 'kind': 'plan', 'quote': Q4}], 'relationships': [{'id': 'r', 'source': 'a', 'target': 'b', 'label': '가족', 'quote': Q3}], 'skipped': {}}

    got = extraction.score(BODY, output, GOLD)

    assert got['reference']['precision'] == {'mentions': 1.0, 'statements': 1.0, 'relationships': 1.0}   # 아내·Q4·김 첨지→아내는 core가 아니어도 정답표(합집합)에 있다
    assert got['recalls'] == {'mentions': pytest.approx(1 / 3), 'statements': 0.0, 'relationships': 0.0}   # 재현율은 core 정답만 센다


def test_a_name_matches_through_the_aliases_of_the_answer():
    gold = {**GOLD, 'mentions': [mention('김 첨지', aliases=['인력거꾼'])], 'statements': [], 'relationships': []}
    output = {**OUTPUT, 'mentions': [{'id': 'm1', 'name': '인력거꾼', 'kind': 'character', 'quote': Q1}], 'skipped': {}}

    assert extraction.score(BODY, output, gold)['recall'] == 1.0


def test_a_relation_end_matches_through_the_aliases_of_the_answer_mention():
    gold = {'mentions': [mention('김 첨지', aliases=['인력거꾼']), mention('치삼')], 'statements': [],
            'relationships': [{'source': '김 첨지', 'target': '치삼', 'label': '친구', 'core': True}]}
    output = {'mentions': [{'id': 'a', 'name': '인력거꾼', 'kind': 'character', 'quote': Q1}, {'id': 'b', 'name': '치삼', 'kind': 'character', 'quote': Q2}],
              'statements': [], 'relationships': [{'id': 'r', 'source': 'a', 'target': 'b', 'label': '친구', 'quote': Q2}], 'skipped': {}}

    got = extraction.score(BODY, output, gold)

    assert got['recalls']['relationships'] == 1.0 and got['reference']['direction'] == 1.0


@pytest.mark.parametrize('quote, found', [('ABCDEFGH', True), ('ABCDEFGHIJKLM', True), ('EFGHIJKL', True), ('FGHIJKLM', False), ('JKLM', False)])
def test_statements_are_the_same_when_their_quotes_overlap_by_half_of_the_shorter_one(quote, found):
    body = 'ABCDEFGHIJKLM'
    gold = {'mentions': [mention('가나')], 'statements': [{'kind': 'event', 'quote': 'ABCDEFGH', 'core': True}], 'relationships': []}   # 정답 인용 0~8칸
    output = {'mentions': [{'id': 'm', 'name': '가나', 'kind': 'character', 'quote': 'ABCDEFGH'}],
              'statements': [{'id': 's', 'kind': 'event', 'quote': quote}], 'relationships': [], 'skipped': {}}

    assert extraction.score(body, output, gold)['recalls']['statements'] == (1.0 if found else 0.0)


def test_quote_ok_is_the_kept_items_over_kept_plus_skipped():
    assert extraction.score(BODY, OUTPUT, GOLD)['quote_ok'] == pytest.approx(7 / 8)   # 남은 항목 7(대상 3·진술 3·관계 1)과 뺀 건수 1


@pytest.mark.parametrize('output, ok', [({'mentions': [], 'statements': [], 'relationships': [], 'skipped': {}}, 1.0),   # 아무것도 안 낸 추출은 검증할 항목이 없다(재현율이 0으로 잡는다)
                                        ({'mentions': [], 'statements': [], 'relationships': [], 'skipped': {'UNKNOWN_ENTITY': 2, 'FUTURE_EVENT': 1}}, 0.0)])
def test_quote_ok_of_an_empty_extraction(output, ok):
    assert extraction.score(BODY, output, GOLD)['quote_ok'] == ok


def test_an_empty_extraction_recalls_nothing():
    got = extraction.score(BODY, {'mentions': [], 'statements': [], 'relationships': [], 'skipped': {}}, GOLD)

    assert got['recall'] == 0.0 and got['reference']['precision'] == {'mentions': None, 'statements': None, 'relationships': None}   # 낸 항목이 없으면 정밀도는 정의되지 않는다


def test_evaluate_records_only_the_gate_metrics_and_keeps_the_reference_in_the_metadata():
    recall, quote_ok = extraction.evaluate(INPUT, OUTPUT, GOLD)

    assert (recall.name, quote_ok.name) == ('recall', 'quote_ok') and extraction.METRICS == ('recall', 'quote_ok')
    assert recall.value == pytest.approx(7 / 9) and quote_ok.value == pytest.approx(7 / 8)
    assert recall.metadata['precision'] == {'mentions': pytest.approx(2 / 3), 'statements': pytest.approx(2 / 3), 'relationships': 1.0}
    assert (recall.metadata['kind_match'], recall.metadata['direction'], recall.metadata['label']) == (0.5, 0.0, 1.0)
    assert '대상 0.67' in recall.comment and '관계 1.00' in recall.comment   # 종류별 재현율을 항목 로그에서 바로 본다
    assert 'INVALID_OR_AMBIGUOUS_QUOTE 1' in quote_ok.comment   # 뺀 항목의 코드별 건수(원문은 없다)


def test_evaluate_without_skipped_items_has_no_quote_comment():
    assert extraction.evaluate(INPUT, {**OUTPUT, 'skipped': {}}, GOLD)[1].comment is None


BAD_GOLD = [None, 'x', {}, {'mentions': []}, {**GOLD, 'mentions': [{'name': '김 첨지'}]}, {**GOLD, 'statements': [{'quote': Q1, 'core': 'yes'}]},
            {**GOLD, 'mentions': [{**mention('김 첨지'), 'core': 'yes'}]},   # core는 진짜 불리언이어야 한다(문자열은 맞춰 읽지 않는다)
            {**GOLD, 'relationships': [{'source': '치삼', 'target': '김 첨지', 'label': '친구', 'core': 1}]},
            {**GOLD, 'relationships': [{'source': '치삼', 'core': True}]},
            {'mentions': [mention('김 첨지', core=False)], 'statements': [], 'relationships': []}]   # core 정답이 하나도 없으면 재현율이 정의되지 않는다


@pytest.mark.parametrize('expected', BAD_GOLD)
def test_an_item_without_a_usable_answer_table_fails_before_scoring(expected):
    with pytest.raises(EvaluationFailure) as error:
        extraction.evaluate(INPUT, OUTPUT, expected)

    assert error.value.status == 422


@pytest.mark.parametrize('bad', [{}, {'number': 1, 'title': 't'}, {'body': 3}, None])
def test_evaluate_needs_the_manuscript_body_of_the_item_input(bad):
    with pytest.raises(EvaluationFailure) as error:
        extraction.evaluate(bad, OUTPUT, GOLD)

    assert error.value.status == 422


def proposal(**changes):
    return {'mentions': [{'id': 'm1', 'name': '김 첨지', 'kind': 'character', 'quote': Q1}],
            'statements': [{'id': 's1', 'kind': 'event', 'certainty': 'asserted', 'subjects': ['m1'], 'knowers': ['m1'], 'document': 'memory',
                            'occurredEpisode': 1, 'knownFromEpisode': 1, 'quote': Q1}], 'relationships': [], **changes}


def test_generate_runs_the_service_extract_with_the_version_body_and_model_and_returns_the_verified_extraction(monkeypatch):
    seen = []
    monkeypatch.setattr(service.agent, 'extract', lambda episode, instructions=None, model=None: seen.append((episode, instructions, model)) or proposal())

    got = extraction.generate('평가할 버전 본문', INPUT, 'gpt-evaluated')

    [(episode, instructions, model)] = seen
    assert (episode.number, episode.title, episode.body, instructions, model) == (1, '운수 좋은 날', BODY, '평가할 버전 본문', 'gpt-evaluated')
    assert set(got) == {'mentions', 'statements', 'relationships', 'skipped'}   # 원문(source)·evidence는 trace에 되풀이하지 않는다
    assert [m['name'] for m in got['mentions']] == ['김 첨지'] and got['statements'][0]['quote'] == Q1 and got['skipped'] == {}


def test_generate_keeps_the_service_verification_so_an_ungrounded_item_is_counted_not_kept(monkeypatch):
    data = proposal()
    data['mentions'].append({'id': 'm2', 'name': '치삼', 'kind': 'character', 'quote': '원문에 없는 문장이다.'})
    monkeypatch.setattr(service.agent, 'extract', lambda episode, instructions=None, model=None: data)

    got = extraction.generate('본문', INPUT)

    assert [m['name'] for m in got['mentions']] == ['김 첨지'] and got['skipped'] == {'INVALID_OR_AMBIGUOUS_QUOTE': 1}


def test_a_failed_extraction_stays_a_failure_with_only_the_fixed_code_instead_of_an_empty_result(monkeypatch):
    def fail(episode, instructions=None, model=None):
        raise PreprocessingFailure('MODEL_TIMEOUT', 504)
    monkeypatch.setattr(service.agent, 'extract', fail)

    with pytest.raises(PreprocessingFailure) as error:   # 항목 실패(점수 없음)다. 코드는 고정 문자열이라 원문이 실리지 않는다
        extraction.generate('본문', INPUT)

    assert str(error.value) == 'MODEL_TIMEOUT' and BODY not in str(error.value)


@pytest.mark.parametrize('bad', [{}, {'number': 1, 'title': 't'}, {'number': 0, 'title': 't', 'body': 'b'}, {'number': 1, 'title': 't', 'body': 3}, None])
def test_an_item_without_the_model_input_never_reaches_the_model(monkeypatch, bad):
    def never(*_, **__):
        raise AssertionError('모델을 부르면 안 된다')
    monkeypatch.setattr(service.agent, 'extract', never)

    with pytest.raises(EvaluationFailure) as error:
        extraction.generate('본문', bad)

    assert error.value.status == 422
