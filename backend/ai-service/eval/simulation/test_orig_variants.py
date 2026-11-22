"""후보 입력 구성(orig_variants): 말투 예시(V1), 금지 목록 장면 관련분만(V2), 관계 장면 관련분만(V3). 입력만 바꾸는 순수 함수다."""

import orig_variants as ov


class Corp:
    def people(self, work):
        return [{'id': 'h', 'title': '해리', 'aliases': ['해리 포터'], 'reveal': 1}, {'id': 'r', 'title': '론', 'aliases': [], 'reveal': 1}]

    def episodes(self):
        eps = [('w#1', 1, '"기차는 언제 떠나니?" 해리가 물었다. "곧 떠나." 론이 대답했다.\n"우린 늦었어, 서두르자." 해리가 외쳤다.\n비가 내리는 오후의 역은 사람들로 붐볐고 기차 소리가 길게 울렸다. 아이들은 짐을 끌며 달렸다.'),
               ('w#2', 2, '"저 편지는 누구에게 온 거야?" 론이 해리에게 물었다.\n"내가 먼저 말했잖아, 해리가 해야 해." 헤르미온느가 말했다.\n"그래, 알겠어. 내가 읽어 볼게." 해리가 대답했다.'),
               ('w#3', 3, '"미래의 대사다." 해리가 말했다.')]
        return [{'id': i, 'work': 'w', 'n': n, 'base': n - 1, 'text': t} for i, n, t in eps]


ITEM = {'work': 'w', 'base': 2, 'speaker': '해리', 'speaker_id': 'h', 'cast': ['해리', '론'], 'context': [{'by': '론', 'text': '"기차는 어디서 타니?"'}, {'by': '해리', 'text': '"역으로 가자."'}], 'gold': '"가자."'}


def test_voice_lines_only_the_speakers_tagged_lines_before_base_ranked_by_scene():
    lines = ov.voice_lines(Corp(), ITEM, k=5)
    assert lines == ['"기차는 언제 떠나니?"', '"우린 늦었어, 서두르자."', '"그래, 알겠어. 내가 읽어 볼게."']   # 해리가 한 대사만(론·헤르미온느의 대사와 3화(기준 회차 뒤)는 빠진다), 회차 순서
    assert ov.voice_lines(Corp(), ITEM, k=1) == ['"기차는 언제 떠나니?"']                                           # 장면(기차·역)과 비슷한 줄이 먼저 남는다
    assert ov.voice_lines(Corp(), {**ITEM, 'base': 0}, k=5) == []


def test_style_paragraphs_are_whole_narration_before_base():
    paras = ov.style_paragraphs(Corp(), ITEM, k=3)
    assert len(paras) == 1 and paras[0].startswith('비가 내리는 오후의 역')


def test_v1_act_adds_voice_doc_and_skips_when_too_few():
    asked, extra = ov.v1_act({'known': [{'ref': 'a', 'label': 'x', 'text': 't'}]}, {}, ITEM, Corp())
    assert asked['known'][-1]['ref'] == 'manuscript:voice' and asked['known'][-1]['text'].count('\n') == 2
    same, _ = ov.v1_act({'known': []}, {}, {**ITEM, 'base': 1}, Corp())   # 예시가 3줄 미만이면 입력을 그대로 둔다
    assert same == {'known': []}


def test_v1_narrate_sets_style_for_narration_and_voice_for_monologue():
    data, _ = ov.v1_narrate({'style': [], 'known': []}, {}, {**ITEM, 'kind': 'narration'}, Corp())
    assert data['style'][0]['title'].startswith('나레이터 문체 예시') and data['known'] == []
    data, _ = ov.v1_narrate({'style': [], 'known': []}, {}, {**ITEM, 'kind': 'monologue'}, Corp())
    assert data['known'][0]['ref'] == 'manuscript:voice' and data['style'] == []


def test_v3_keeps_same_pair_and_scene_relations_and_caps():
    known = [{'ref': 'card:h#identity', 'label': '정체', 'text': '해리 소개'}] + [{'ref': f'relation:{i}', 'label': '관계', 'text': t} for i, t in
             enumerate(['해리의 친구: 론 — 기차에서 만났다', '해리의 적: 말포이', '해리의 선생: 덤블도어 — 역으로 간다', '해리의 이모: 페투니아', '해리의 부모: 제임스'])] + [{'ref': 'manuscript:x', 'label': '조회', 'text': '발췌'}]
    asked, _ = ov.v3_relations({'known': known}, {}, ITEM, Corp(), cap=2)
    refs = [d['ref'] for d in asked['known']]
    assert refs == ['card:h#identity', 'relation:0', 'relation:2', 'manuscript:x']   # 관계 아닌 항목은 그대로, 관계는 같은 인물 쌍(론)·장면과 겹치는 순 2개


def test_v2_keeps_forbidden_docs_most_like_paragraph_and_scene():
    extra = {'forbidden': [{'ref': f'card:x#ep0{i}', 'label': '기억', 'text': t, 'owner': 'x'} for i, t in enumerate(['기차를 타고 떠난다', '전혀 다른 숲 이야기', '역에서 편지를 읽는다', '먼 바다의 일'])], 'voices': []}
    _, got = ov.v2_forbidden({}, extra, {**ITEM, 'gold': '"편지를 읽으러 역으로 가자."'}, Corp(), cap=2)
    assert [d['text'] for d in got['forbidden']] == ['기차를 타고 떠난다', '역에서 편지를 읽는다'] and got['voices'] == []   # 문단·직전 줄과 겹치는 순, 원래 순서
