"""hp_traits: SOUL·GOAL 다시 쓰기의 기록 고르기·요청·금지 낱말(정해 둔 것 + 뒤 회차에만 나오는 고유명사) 검사. 모델·원문 없음."""

import json

import hp_build as b
import hp_traits as t


def rec(**fields):
    return b.Record(1, '1권 1장', **{'looks': '', 'personality': '', 'speech': '', 'situation': '', 'wants': '', 'memory': '', **fields})


def test_only_personality_speech_and_wants_are_given_once_each_in_story_order():
    records = [rec(situation='학교에 입학했다', memory='편지를 받았다', looks='마른 몸'), rec(personality='용감하다'), rec(speech='짧게 말한다', wants='친구를 지킨다'),
               rec(personality='용감하다'), rec(personality='용감하다', speech='짧게 말한다', wants='친구를 지킨다')]
    assert t.trait_entries(records) == [{'personality': '용감하다', 'speech': '', 'wants': ''}, {'personality': '', 'speech': '짧게 말한다', 'wants': '친구를 지킨다'},
                                        {'personality': '용감하다', 'speech': '짧게 말한다', 'wants': '친구를 지킨다'}]   # 처지·그 장의 일·외모는 후반 정보를 싣기 쉬워 빠지고 같은 내용은 한 번


def test_a_long_list_is_sampled_evenly_keeping_the_first_and_the_last():
    entries = list(range(200))
    picked = t.sample(entries, 10)
    assert len(picked) == 10 and picked[0] == 0 and picked[-1] == 199 and picked == sorted(picked) and len(set(picked)) == 10
    assert t.sample(entries[:5], 10) == entries[:5] and t.sample(entries, 10) == picked


def test_the_request_has_the_name_the_aliases_and_the_records_and_names_the_avoid_words_only_on_a_retry():
    entries = [{'personality': '용감하다', 'speech': '', 'wants': ''}]
    instructions, data = t.trait_request('해리', ['꼬마'], entries)
    assert json.loads(data) == {'name': '해리', 'aliases': ['꼬마'], 'records': entries}
    assert '변하지 않는' in instructions and '정체' in instructions and '죽음' in instructions and '결말' in instructions and '지어내지' in instructions and '권·장 번호' in instructions
    again = t.trait_request('해리', ['꼬마'], entries, avoid={'호크룩스', '릴리'})[1]
    assert json.loads(again)['avoid'] == ['릴리', '호크룩스'] and t.trait_request('해리', ['꼬마'], entries)[1] == data   # 같은 입력은 같은 요청(캐시), avoid는 정렬


def test_nouns_that_appear_only_after_the_middle_episode_are_late_and_the_persons_own_names_never_are():
    nouns = {'고드릭스', '호그와트', '스네이프', '스네이프 교수', '아즈카반', '릴리'}
    texts = {1: '호그와트에서 수업', 2: '호그와트 입학', 3: '스네이프 교수가 말했다', 4: '아즈카반 이야기', 5: '고드릭스의 기억을 보았다', 6: '아즈카반으로 갔다', 7: '호그와트로 돌아왔다', 8: '고드릭스와 릴리를 떠올렸다'}
    assert t.late_nouns(texts, nouns, {'스네이프', '스네이프 교수'}) == {'고드릭스'}   # 아즈카반은 앞(4화)에도 나오고 호그와트는 처음부터 나오며 두 글자 릴리는 뽑지 않는다
    assert t.late_nouns(texts, nouns, {'고드릭스'}) == set()   # 자기 이름은 금지어가 아니다
    assert t.late_nouns({1: '고드릭스', 2: '고드릭스', 3: '고드릭스'}, nouns, set()) == set() and t.late_nouns({}, nouns, set()) == set()   # 기억이 적으면 뽑지 않는다
    assert t.late_nouns(texts, {'교수님이'}, {'스네이프 교수'}) == set() and t.late_nouns({1: '가나다', 2: '가', 3: '가', 4: '가', 5: '가나다라'}, {'가나다', '가나다라'}, {'가나다라마'}) == set()   # 자기 이름 안의 낱말은 뺀다


def test_forbidden_words_are_the_global_list_plus_the_persons_own_list_plus_late_nouns_minus_the_persons_names():
    own = {'스네이프', '스네이프 교수'}
    words = t.forbidden_words('Severus Snape', own, {'나중에나오는이름', '스네이프'})
    assert {'호크룩스', '죽음의 성물', '릴리', '이중', '충성', '나중에나오는이름'} <= words and '스네이프' not in words   # 인물별 목록은 영어 이름의 낱말로 찾는다
    assert '볼드모트' not in words and '스캐버스' in t.forbidden_words('Peter Pettigrew', {'웜테일'}, set())
    assert '볼드모트' in t.forbidden_words('Professor Quirrell', {'퀴렐'}, set()) and '볼드모트' in t.forbidden_words('Quirinus Quirrell', {'퀴렐'}, set())   # 호칭(Professor)을 떼고 성으로 찾는다
    assert '릴리' not in t.forbidden_words('Harry Potter', {'해리'}, set()) and '사망' not in t.forbidden_words('Aberforth Dumbledore', {'애버포스'}, set())   # 다른 사람의 목록은 섞이지 않는다
    assert '호크룩스' not in t.forbidden_words('Someone', {'호크룩스'}, set()) and all(len(w) >= 2 for w in t.forbidden_words('Albus Dumbledore', set(), {'가'}))


def test_caught_reports_every_forbidden_word_found_in_the_text_sorted():
    assert t.caught('그는 호크룩스와 릴리를 모른다. 호크룩스 둘', {'릴리', '호크룩스', '충성'}) == ['릴리', '호크룩스']
    assert t.caught('한결같이 용감하다', {'릴리', '호크룩스'}) == [] and t.caught('', {'릴리'}) == []


def test_every_listed_spoiler_word_has_two_or_more_characters_so_a_stray_syllable_cannot_flag_a_document():
    assert all(len(w) >= 2 for w in t.GLOBAL_SPOILERS) and all(len(w) >= 2 for words in t.PERSON_SPOILERS.values() for w in words)
    assert {'호크룩스', '죽음의 성물'} <= set(t.GLOBAL_SPOILERS) and {'Severus Snape', 'Quirrell', 'Peter Pettigrew', 'Alastor Moody', 'Albus Dumbledore', 'Harry Potter'} <= set(t.PERSON_SPOILERS)
