"""해리 포터 회차 원고 만들기 단위 테스트: 합성 글로 쪽 번호·중복 줄·쪽 머리글 제거, 장 머리 인식, 묶음 나누기·꼬리 자르기를 확인한다. 원문은 쓰지 않는다."""

import hp_episodes as e

LONG = '해리는 성으로 걸어 들어가며 오늘 있었던 일을 천천히 떠올렸다.'


def test_page_markers_and_symbol_lines_are_dropped_but_short_dialogue_stays():
    lines = ['? 54 ?', "'』", '◎-7◎◎', '@ff', LONG, '"싫어."', '단지-']
    assert e.clean(lines, '소망의 거울', 1) == [LONG, '"싫어."', '단지-']


def test_repeated_long_lines_from_page_overlap_are_kept_once():
    other = '론이 스웨터를 머리에서부터 뒤집어써 입으며 투덜거렸다.'
    assert e.clean([LONG, other, LONG, '"응."', '"응."'], '퀴디치', 1) == [LONG, other, '"응."', '"응."']


def test_running_headers_with_ocr_typos_are_dropped():
    lines = ['소맘의 거을', LONG, '눠 킥 포터 와 마법 사의 돌', '소망와 거 을', '크리스마스가 다가오고 있었다.']
    assert e.clean(lines, '소망의 거울', 1) == [LONG, '크리스마스가 다가오고 있었다.']


def test_heading_line_gives_the_title_and_is_removed_from_the_body():
    assert e.heading(['', '제 11장  결투클럽', LONG]) == ('결투클럽', [LONG])
    assert e.heading(['12。엄브리지 교수', LONG]) == ('엄브리지 교수', [LONG])
    assert e.heading(['챕터 30 : 그럽', LONG]) == ('그럽', [LONG])
    assert e.heading(['마지 아줌마의 큰 실수', LONG]) == ('마지 아줌마의 큰 실수', [LONG])
    assert e.heading([LONG, LONG]) == ('', [LONG, LONG])


def test_number_only_heading_takes_the_title_from_the_next_short_line():
    assert e.heading(['제9장', '벽면에 쓰여진 경고', LONG]) == ('벽면에 쓰여진 경고', [LONG])
    assert e.heading(['제 2장', LONG]) == ('', [LONG])


def test_heading_titles_drop_notes_and_english_when_korean_is_there():
    assert e.heading(['Chapter 4 : Number Twelve, Grimmauld Place 그림몰드 가의 12번지', LONG])[0] == '그림몰드 가의 12번지'
    assert e.heading(['챕터24.오클루맨시(마음읽힘방어법-_-대충 이렇게 해석하면될듯;)', LONG])[0] == '오클루맨시'
    assert e.heading(['37장 잃어버린 예언 (The Lost Prophecy) 페이지 725(영국판)', LONG])[0] == '잃어버린 예언'
    assert e.heading(['챕터 제목 : [Chapter 33 : Fight and Flight]', LONG])[0] == 'Fight and Flight'


def test_table_of_contents_titles_are_the_most_common_spelling_per_chapter():
    lines = ['차례', '제12장 패드로누스', '제 12장 패드로누스', '제12장  패그로누스.11', '제13장 그리핀도르대 래번클로 .40', '제 14장 해리가 말했다.']
    assert e.toc_titles(lines) == {12: '패드로누스', 13: '그리핀도르대 래번클로'}


def test_merged_units_are_cut_at_the_given_lines_and_tails_are_trimmed():
    units = {'b1-02-03': [f'줄{i}' for i in range(10)], 'b1-04': ['가', '나', '목차']}
    parts = e.split_units(units, {'b1-02-03': [(2, 0, 4), (3, 5, None)]}, {'b1-04': 2})
    assert parts == {(1, 2): ['줄0', '줄1', '줄2', '줄3'], (1, 3): ['줄5', '줄6', '줄7', '줄8', '줄9'], (1, 4): ['가', '나']}


def test_a_chapter_split_across_two_units_is_joined_in_unit_order():
    units = {'b1-10': ['a', 'b', 'c'], 'b1-11-12': ['d', 'e', 'f']}
    parts = e.split_units(units, {'b1-10': [(10, 0, 2), (11, 2, None)], 'b1-11-12': [(11, 0, 1), (12, 1, None)]}, {})
    assert parts[(1, 11)] == ['c', 'd'] and parts[(1, 12)] == ['e', 'f']


def test_line_breaks_inside_a_sentence_are_joined_into_one_paragraph():
    assert e.paragraphs(['리스마스가 다가오고 있었다. 12월 중순의 어느 날 아', '침,호그와트는 눈으로 덮였다.', '"좋아."', '그가 말했다.']) == [
        '리스마스가 다가오고 있었다. 12월 중순의 어느 날 아침,호그와트는 눈으로 덮였다.', '"좋아."', '그가 말했다.']
    paragraph = '가' * 70   # 한 줄이 한 문단인 원문은 마침표가 빠져도 다음 줄과 잇지 않는다
    assert e.paragraphs([paragraph, '다음 문단이다.']) == [paragraph, '다음 문단이다.']


def test_chap_n_heading_is_recognized():
    assert e.heading(['chap2.부엉이 한 꾸러미', LONG]) == ('부엉이 한 꾸러미', [LONG])


def test_episode_file_has_the_title_line_then_a_blank_line_then_paragraphs():
    assert e.render('1권 1장 살아남은 아이', [LONG, LONG + '!']) == f'1권 1장 살아남은 아이\n\n{LONG}\n\n{LONG}!\n'
