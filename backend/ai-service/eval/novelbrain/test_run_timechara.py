"""TimeChara 실행기의 순수 로직 단위 테스트: 문맥 메시지·항목 회차·채점 흐름·집계. 실제 호출 없이 대역 모델을 쓴다."""

import pytest

from run_timechara import context_message, foreign_memory, item_episode, judge_personality, judge_spatiotemporal, paired, summarize

LOOKUP = {'chunk': {'harry_potter:12': 7}, 'event': {'e-abc': 9}, 'when': {'r-x': 4}}
SPATIAL = '{agent_name}|{question_0}|{answer_0}|{agent_fact_0}'
PERSONALITY = '{agent_name}|{question_0}|{response_0}|{agent_personality}'


class Judge:
    """채점 모델 대역: 입력에 든 사실 표지로 점수를 정하고 호출 수를 센다."""

    def __init__(self, scores):
        self.scores, self.calls = scores, []

    def ask(self, kind, instructions, input, max_output_tokens):
        self.calls.append(input)
        for marker, score in self.scores.items():
            if marker in input:
                return f'reasoning...\n{score}\n{score}'
        return 'no score here'


def test_context_message_follows_the_public_rag_cutoff_format():
    assert context_message('What?', []) == 'What?'
    assert context_message('What?', ['a', 'b']) == 'Context: a\n\nb\n***\nWhat?'


def test_item_episode_reads_the_source_chapter_of_each_item_kind():
    assert item_episode('manuscript:harry_potter:12', LOOKUP) == 7
    assert item_episode('card:e-abc', LOOKUP) == 9
    assert item_episode('card:c-harry#ep03', LOOKUP) == 3
    assert item_episode('relation:r-x', LOOKUP) == 4
    assert item_episode('card:c-harry#identity', LOOKUP) is None
    assert item_episode('card:c-harry#memory', LOOKUP) is None
    assert item_episode('relation:unknown', LOOKUP) is None


def test_foreign_memory_flags_other_characters_private_documents_only():
    assert foreign_memory('card:c-ron#ep03', 'c-harry') and foreign_memory('card:c-ron#soul', 'c-harry')
    assert not foreign_memory('card:c-harry#ep03', 'c-harry')
    assert not foreign_memory('card:c-ron#identity', 'c-harry') and not foreign_memory('card:e-abc', 'c-harry')


def row(data_type, temporal='T-fact', spatial='-'):
    return {'data_type': data_type, 'question': 'Q', 'temporal_label': temporal, 'spatial_label': spatial}


def test_future_and_past_only_are_judged_on_time_alone():
    for kind in ('future', 'past-only'):
        judge = Judge({'T-fact': 1})
        assert judge_spatiotemporal(judge, row(kind), 'R', 'Name', SPATIAL) == {'temporal': 1, 'spatial': None, 'score': 1}
        assert len(judge.calls) == 1


def test_absence_and_presence_ask_space_first_and_skip_time_when_space_fails():
    judge = Judge({'S-fact': 0, 'T-fact': 1})
    assert judge_spatiotemporal(judge, row('past-absence', spatial='S-fact'), 'R', 'Name', SPATIAL) == {
        'temporal': 0, 'spatial': 0, 'score': 0}
    assert len(judge.calls) == 1                       # 공개 evaluate.py처럼 공간이 0이면 시간은 묻지 않는다
    judge = Judge({'S-fact': 1, 'T-fact': 1})
    assert judge_spatiotemporal(judge, row('past-presence', spatial='S-fact'), 'R', 'Name', SPATIAL)['score'] == 1
    assert len(judge.calls) == 2


def test_unparseable_judgement_is_none_not_a_guess():
    result = judge_spatiotemporal(Judge({}), row('future'), 'R', 'Name', SPATIAL)
    assert result['score'] is None
    assert judge_personality(Judge({}), 'Q', 'R', 'Name', 'Brave.', PERSONALITY) is None


def test_personality_is_scored_one_to_seven():
    assert judge_personality(Judge({'Brave.': 6}), 'Q', 'R', 'Name', 'Brave.', PERSONALITY) == 6
    assert judge_personality(Judge({'Brave.': 9}), 'Q', 'R', 'Name', 'Brave.', PERSONALITY) is None


def record(config, data_type, score, personality=None, future=False, foreign=False):
    return {'config': config, 'data_type': data_type, 'score': score, 'personality': personality, 'future_ctx': future,
            'foreign_ctx': foreign}


def test_summarize_weights_types_like_the_benchmark_and_counts_failures():
    records = (
        [record('s2', 'future', s) for s in (1, 0, 1, 0)] + [record('s2', 'past-only', s) for s in (1, 1)]
        + [record('s2', 'past-absence', 0), record('s2', 'past-presence', 1)]
        + [record('s2', 'future', None)]
        + [record('s3', 'future', 1, personality=5, future=False)]
    )
    out = summarize(records)
    s2 = out['s2']
    assert s2['by_type']['future'] == {'n': 4, 'score': 0.5, 'ci': pytest.approx(s2['by_type']['future']['ci'])}
    assert s2['failed'] == 1
    # 가중 평균: future 1/3, past-only 1/3, absence 1/6, presence 1/6 → 0.5/3 + 1/3 + 0/6 + 1/6
    assert s2['weighted'] == pytest.approx(0.5 / 3 + 1 / 3 + 0 + 1 / 6)
    assert out['s3']['personality'] == 5 and out['s3']['by_type']['future']['n'] == 1


def test_summarize_reports_context_leak_rates_per_type():
    records = [record('s2', 'future', 1, future=True), record('s2', 'future', 1, future=False),
               record('s2', 'future', 1, future=True, foreign=True), record('s3', 'future', 1)]
    out = summarize(records)
    assert out['s2']['future_ctx'] == pytest.approx(2 / 3) and out['s2']['foreign_ctx'] == pytest.approx(1 / 3)
    assert out['s3']['future_ctx'] == 0


def test_paired_counts_discordant_questions_and_gives_an_exact_sign_test():
    def rec(idx, config, score):
        return {'idx': idx, 'config': config, 'score': score}
    records = [rec(i, 'a', x) for i, x in enumerate([1, 1, 0, 0])] + [rec(i, 'b', x) for i, x in enumerate([0, 1, 1, 0])]
    assert paired(records, 'a', 'b') == {'a_only': 1, 'b_only': 1, 'p': 1.0}
    records = [rec(i, 'a', 1) for i in range(9)] + [rec(i, 'b', 0 if i < 8 else 1) for i in range(9)] + [rec(20, 'a', 1), rec(20, 'b', None)]
    out = paired(records, 'a', 'b')                      # 한쪽이 실패(None)한 질문은 짝에서 뺀다
    assert (out['a_only'], out['b_only']) == (8, 0) and out['p'] == pytest.approx(2 * 1 / 2 ** 8)
