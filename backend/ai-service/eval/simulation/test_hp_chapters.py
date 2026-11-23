"""해리 포터 번역본 장 나누기 단위 테스트: 합성 글로 머리 형식·목차·잘못 잡힌 줄·제목 줄·못 나누는 구간의 규칙을 확인한다. 원문은 쓰지 않는다."""

import pytest

import hp_chapters as h


def body(n: int, size: int = 60) -> list[str]:
    """장 본문 대역: 줄 n개(줄마다 size자)."""
    return [f'{n}번째 장의 본문 줄 {i} ' + '가' * size for i in range(40)]


def chapter(heading: str | None, n: int) -> list[str]:
    return ([heading] if heading else []) + body(n)


def split(files, total, epilogue=False):
    return h.split_book(files, total, epilogue)


def test_files_are_read_in_the_order_of_their_number_or_roman_numeral():
    names = ['해.리.포.터.와.혼.혈.왕.자 Ⅱ.txt', '해.리.포.터.와.혼.혈.왕.자.Ⅰ.txt', '해.리.포.터.와.혼.혈.왕.자 Ⅳ.txt', '해.리.포.터.와.혼.혈.왕.자 Ⅲ.txt']
    assert sorted(names, key=h.file_order)[0].endswith('.Ⅰ.txt') and [h.file_order(n) for n in sorted(names, key=h.file_order)] == [1, 2, 3, 4]
    assert [h.file_order(n) for n in ('[5부]해리포터와불사조의기사단10.txt', '[5부]해리포터와불사조의기사단2.txt', '해리포터와_마법사의돌.txt')] == [10, 2, 0]


def test_chapters_are_split_at_their_headings_and_every_chapter_gets_its_own_unit():
    lines = [*chapter('제 1장 살아남은 아이', 1), *chapter('제2장 사라진 유리창', 2), *chapter('제 3 장 이상한 편지들', 3)]
    result = split([lines], 3)
    assert [u.chapters for u in result.units] == [(1,), (2,), (3,)] and result.missing == [] and set(result.found.values()) == {'heading'}
    assert '1번째 장' in result.units[0].text and '2번째 장' not in result.units[0].text and result.units[1].text.startswith('제2장 사라진 유리창')


def test_a_table_of_contents_at_the_top_is_not_taken_for_chapters():
    toc = ['제 1장 살아남은 아이', '제 2장 사라진 유리창', '제 3장 이상한 편지들']
    lines = [*toc, '', *chapter('제 1장 살아남은 아이', 1), *chapter('제 2장 사라진 유리창', 2), *chapter('제 3장 이상한 편지들', 3)]
    result = split([lines], 3)
    assert [u.chapters for u in result.units] == [(1,), (2,), (3,)] and result.units[0].text.startswith('제 1장 살아남은 아이') and '1번째 장' in result.units[0].text


def test_the_heading_right_after_a_table_of_contents_is_a_chapter_because_its_number_starts_over():
    toc = [f'제 {n}장 제목{n}' for n in range(1, 5)]
    result = split([[*toc, *chapter('제 1장 제목1', 1), *chapter('제 2장 제목2', 2), *chapter('제 3장 제목3', 3), *chapter('제 4장 제목4', 4)]], 4)
    assert [u.chapters for u in result.units] == [(1,), (2,), (3,), (4,)]


def test_a_numbered_list_inside_a_chapter_does_not_block_the_real_headings():
    # 본문 속 '6. …' 줄이 잘못 잡혀도, 장 번호가 이어지는 가장 긴 열을 고르므로 진짜 4·5·6장 머리를 잃지 않는다.
    lines = [*chapter('제 1장 가', 1), *chapter('제 2장 나', 2), '6. 확인되지 않은 목격에 의하면 마법사들이 현재', *body(2), *chapter('제 3장 다', 3),
             *chapter('제 4장 라', 4), *chapter('제 5장 마', 5), *chapter('제 6장 바', 6)]
    result = split([lines], 6)
    assert [u.chapters for u in result.units] == [(1,), (2,), (3,), (4,), (5,), (6,)] and '6. 확인되지' in result.units[1].text  # 잘못 잡힌 줄은 2장 본문에 남는다


@pytest.mark.parametrize('heading, n', [
    ('Chapter 3 : The Advance guard 최초의 수호자', 3), ('CHAPTER.23', 23), ('챕터 32 : Out of the Fire', 32), ('[Chapter 33 : Fight and Flight]', 33),
    ('<Chapter 36> : The Only one He ever feared', 36), ('37장 잃어버린 예언 (The Lost Prophecy) 페이지 725(영국판)', 37), ('7。마법부', 7),
    ('16. 호그스헤드 안에서', 16), ('19.사자와 뱀', 19), ('20 해그리드의 이야기', 20), ("Snape's worst memory - chapter28", 28)])
def test_every_heading_format_seen_in_the_text_is_read_with_its_number(heading, n):
    lines = [*chapter(None, 0), *chapter(heading, n)]
    assert [(c.n, c.line) for c in h.candidates(lines, 38)] == [(n, len(body(0)))]


def test_lines_that_only_start_with_a_number_inside_a_sentence_or_are_too_long_are_not_headings():
    lines = ['"11 인치, 핵은 불사조의 깃털, 4년 동안 사용되었습니다." 그가 말했다.', '10분쯤후, 플리트윅교수는, "파킨슨, 팬시-', '50명쯤 되는 켄타우르스들이 화살을 들고', '3 ' + '가' * 90]
    assert h.candidates(lines, 38) == []


def test_chapters_whose_heading_is_missing_are_merged_with_the_chapter_before_and_dated_to_the_last_of_them():
    lines = [*chapter('제 1장 가', 1), *chapter('제 2장 나', 2), *chapter(None, 3), *chapter(None, 4), *chapter('제 5장 마', 5)]
    result = split([lines], 5)
    assert [u.chapters for u in result.units] == [(1,), (2, 3, 4), (5,)] and result.missing == [3, 4]
    assert [u.ordinal_chapter for u in result.units] == [1, 4, 5]  # 묶음의 사건은 마지막 장(4장)의 것으로 센다: 미래 정보가 앞 장으로 새지 않는다
    assert '2번째 장' in result.units[1].text and '3번째 장' in result.units[1].text and '4번째 장' in result.units[1].text


def test_chapters_before_the_first_heading_form_their_own_leading_unit_after_the_table_of_contents():
    toc = ['제 1장 가', '제 2장 나', '제 3장 다']
    lines = [*toc, '', *chapter(None, 1), *chapter(None, 2), *chapter('제 3장 다', 3)]
    result = split([lines], 3)
    assert [u.chapters for u in result.units] == [(1, 2), (3,)] and result.missing == [1, 2]
    assert result.units[0].text.startswith('1번째 장') and '제 1장 가' not in result.units[0].text


def test_a_missing_heading_is_found_by_its_title_line_from_the_table_of_contents_even_with_spaces_or_noise():
    toc = ['제 1장 퀴디치', '제 2장 소망의 거울', '제 3장 금지된 숲']
    lines = [*toc, '', *chapter('제 1장 퀴디치', 1), *chapter('소 망 의 거 울', 2), *chapter('금지된 숲', 3)]
    result = split([lines], 3)
    assert [u.chapters for u in result.units] == [(1,), (2,), (3,)] and result.found == {1: 'heading', 2: 'title', 3: 'title'}
    noisy = [*toc, '', *chapter('제 1장 퀴디치', 1), *chapter('소망와 거을', 2), *chapter('금지된 숲', 3)]  # 비슷한 정도(0.8)에 못 미치면 찾지 않는다
    assert split([noisy], 3).missing == [2]
    fuzzy = [*toc, '', *chapter('제 1장 퀴디치', 1), *chapter('소맘의 거울', 2), *chapter('금지된 숲', 3)]
    assert split([fuzzy], 3).found[2] == 'title'


def test_a_title_line_is_only_looked_for_between_the_neighbouring_headings():
    toc = ['제 1장 퀴디치', '제 2장 소망의 거울', '제 3장 금지된 숲']
    lines = [*toc, '', *chapter('제 1장 퀴디치', 1), *chapter('제 3장 금지된 숲', 3), '소망의 거울', *body(9)]  # 3장 뒤에 나온 제목은 2장 머리가 아니다
    assert split([lines], 3).missing == [2]


def test_the_epilogue_is_the_chapter_after_the_last_one_only_for_the_last_book():
    lines = [*chapter('제 1장 가', 1), *chapter('제 2장 나', 2), *chapter('에필로그', 0)]
    assert [u.chapters for u in split([lines], 2, epilogue=True).units] == [(1,), (2,), (3,)]
    assert [u.chapters for u in split([lines], 2).units] == [(1,), (2,)]  # 다른 권은 에필로그를 따로 세지 않는다


def test_chapter_numbers_beyond_the_last_chapter_are_ignored_and_files_are_joined_in_order():
    first = [*chapter('제 1장 가', 1), *chapter('제 2장 나', 2)]
    second = [*chapter('제 3장 다', 3), *chapter('제 9장 라', 9)]
    result = split([first, second], 3)
    assert [u.chapters for u in result.units] == [(1,), (2,), (3,)] and '9번째 장' in result.units[2].text  # 9장 머리는 장 번호 밖이라 3장 안에 남는다


def test_windows_cut_a_long_text_at_line_boundaries_within_the_limit():
    text = '\n'.join(['가' * 30] * 10)
    parts = h.windows(text, 100)
    assert all(len(p) <= 100 for p in parts) and '\n'.join(parts) == text and len(parts) == 4
    assert h.windows('가' * 500, 100) == ['가' * 500]  # 한 줄이 한도보다 길면 그 줄 하나로 둔다
