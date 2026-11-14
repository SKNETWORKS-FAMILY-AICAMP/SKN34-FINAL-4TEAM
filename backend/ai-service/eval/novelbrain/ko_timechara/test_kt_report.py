"""데이터 구성 집계 단위 테스트: 작품 제목·원문 없이 분포만 낸다."""

from kt_report import describe_questions, describe_works


def work(kind, genre, lengths):
    return {'kind': kind, 'genre': genre, 'episodes': [{'number': i + 1, 'text': '가' * n} for i, n in enumerate(lengths)]}


def test_describe_works_counts_genres_and_summarizes_lengths_without_titles():
    out = describe_works({'w01': work('web', '무협', [100, 300, 200]), 'w02': work('web', '판타지', [50] * 2), 'c01': work('classic', '고전', [400, 600])})
    assert out['works'] == 3 and out['genres'] == {'무협': 1, '판타지': 1, '고전': 1}
    assert out['by_kind']['web'] == {'works': 2, 'episodes': 5, 'episodes_per_work': {'min': 2, 'max': 3},
                                     'chars_per_episode': {'min': 50, 'median': 100, 'max': 300}, 'total_chars': 700}
    assert out['by_kind']['classic']['chars_per_episode']['median'] == 500
    assert 'w01' not in str(out)


def row(work_id, kind, genre, data_type, style, character):
    return {'work': work_id, 'kind': kind, 'genre': genre, 'data_type': data_type, 'question_generation': style, 'character': character}


def test_describe_questions_counts_by_type_kind_genre_style_and_work():
    rows = [row('w01', 'web', '무협', 'future', 'fact-structured', 'a'), row('w01', 'web', '무협', 'past-only', 'fact-freeform', 'a'),
            row('w02', 'web', '판타지', 'future', 'fact-freeform', 'b'), row('c01', 'classic', '고전', 'past-absence', 'fact-structured', 'c')]
    out = describe_questions(rows)
    assert out['total'] == 4 and out['by_type'] == {'future': 2, 'past-only': 1, 'past-absence': 1}
    assert out['by_kind'] == {'web': 3, 'classic': 1} and out['by_genre'] == {'무협': 2, '판타지': 1, '고전': 1}
    assert out['by_style'] == {'fact-structured': 2, 'fact-freeform': 2} and out['per_work'] == {'min': 1, 'max': 2}
    assert out['characters'] == 3
