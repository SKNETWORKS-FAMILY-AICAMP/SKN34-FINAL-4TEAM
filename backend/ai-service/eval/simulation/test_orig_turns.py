"""원문 턴 정렬(orig_turns): 따옴표 대사·지문 자르기, 판별 요청·병합, 직전 줄·장면 인물 만들기."""

import orig_turns as ot


def kinds(turns):
    return [(t['kind'], t['text']) for t in turns]


def test_split_turns_dialogue_tag_and_narration():
    text = '밤이 깊었다.\n"가자." 그가 말했다. "어디로?"\n그녀는 한참을 망설이다가 창밖의 어두운 골목을 오래 바라보았고, 이윽고 고개를 끄덕였다.'
    turns = ot.split_turns(text)
    assert kinds(turns) == [('narration', '밤이 깊었다.'), ('dialogue', '"가자."'), ('dialogue', '"어디로?"'),
                            ('narration', '그녀는 한참을 망설이다가 창밖의 어두운 골목을 오래 바라보았고, 이윽고 고개를 끄덕였다.')]
    assert [t['i'] for t in turns] == [0, 1, 2, 3]
    assert turns[1]['tag'] == '그가 말했다.' and turns[2]['tag'] == '그가 말했다.'   # 두 대사 사이의 짧은 지문은 앞 대사의 꼬리표이고 다음 대사도 같은 문단의 꼬리표를 본다
    assert turns[0]['whole'] and not turns[1].get('whole')
    assert [t['par'] for t in turns] == [0, 1, 1, 2]


def test_split_turns_adjacent_quotes_pair_up():
    """줄바꿈 없이 붙은 두 사람의 대사('?""물론이죠.')도 따옴표를 짝지어 각각 한 턴으로 센다."""
    turns = ot.split_turns('"괜찮을까?""물론이죠." 해리가 대답했다.')
    assert kinds(turns) == [('dialogue', '"괜찮을까?"'), ('dialogue', '"물론이죠."')]
    assert turns[1]['tag'] == '해리가 대답했다.'


def test_split_turns_other_quote_marks_and_unbalanced():
    turns = ot.split_turns('“저기요.” 하고 불렀다.\n「네?」\n그는 "끝나지 않는 말을 했다.')
    assert [t['text'] for t in turns if t['kind'] == 'dialogue'] == ['"저기요."', '"네?"']
    assert turns[-1]['kind'] == 'narration' and '끝나지 않는' in turns[-1]['text']   # 짝 없는 따옴표는 지문으로 둔다


def test_split_turns_long_piece_between_quotes_is_narration():
    long = '그는 한참 동안 말없이 서서 먼 산을 바라보다가 천천히 돌아서서 마당을 가로질러 걸어갔고 대문 앞에서 멈추었다.'
    turns = ot.split_turns('"그래." ' + long + ' "그럼."')
    assert kinds(turns) == [('dialogue', '"그래."'), ('narration', long), ('dialogue', '"그럼."')]
    assert not turns[1]['whole']


def test_label_request_chunks_and_before_context():
    turns = ot.split_turns('\n'.join(f'"말{n}."' for n in range(7)))
    chunks = ot.label_chunks(turns, ['해리', '론'], first_person=False, size=3, before=2)
    assert [len(c['turns']) for c in chunks] == [3, 3, 1]
    assert [b['i'] for b in chunks[1]['before']] == [1, 2] and chunks[0]['before'] == []
    assert chunks[0]['names'] == ['해리', '론'] and chunks[0]['turns'][0] == {'i': 0, 'kind': 'dialogue', 'text': '"말0."', 'tag': ''}


def label(i, speaker='', monologue=''):
    return ot.Label(i=i, speaker=speaker, monologue=monologue)


def test_read_labels_drops_unknown_names_and_bad_indexes():
    turns = ot.split_turns('"가."\n그는 속으로 생각했다.')
    out = ot.Labels(labels=[label(0, '해리'), label(1, '', '해리'), label(9, '론'), label(0, '론')])
    got = ot.read_labels(out, turns, ['해리', '론'])
    assert got == {0: ('해리', ''), 1: ('', '해리')}   # 범위 밖 번호·같은 번호의 두 번째 답은 버린다
    bad = ot.read_labels(ot.Labels(labels=[label(0, '드래곤')]), turns, ['해리'])
    assert bad == {0: ('', '')}   # 목록에 없는 이름은 「모름」


def test_merge_labels_keeps_only_agreement():
    a = {0: ('해리', ''), 1: ('론', ''), 2: ('', '해리'), 3: ('', '')}
    b = {0: ('해리', ''), 1: ('해리', ''), 2: ('', '해리'), 3: ('', '론')}
    turns = [{'i': i, 'kind': k} for i, k in enumerate(['dialogue', 'dialogue', 'narration', 'narration'])]
    merged = ot.merge_labels(turns, a, b)
    assert merged[0] == {'status': 'agreed', 'speaker': '해리', 'monologue': ''}
    assert merged[1]['status'] == 'unlabeled'
    assert merged[2] == {'status': 'agreed', 'speaker': '', 'monologue': '해리'}
    assert merged[3]['status'] == 'unlabeled'   # 독백 여부가 갈린 지문
    only = ot.merge_labels(turns, a, None)       # 한쪽 경로가 실패하면 그 청크는 모두 판별 못 한 것
    assert all(v['status'] == 'unlabeled' for v in only.values())


def aligned(*rows):
    """(kind, text, speaker, monologue) 행 → 판별을 붙인 턴 목록."""
    out = []
    for i, (kind, text, speaker, mono) in enumerate(rows):
        out.append({'i': i, 'kind': kind, 'text': text, 'tag': '', 'par': i, 'speaker': speaker, 'monologue': mono, 'status': 'agreed' if speaker or mono or kind == 'narration' else 'unlabeled'})
    return out


def test_context_lines_names_and_limits():
    turns = aligned(('narration', '비가 왔다.', '', ''), ('dialogue', '"안녕."', '해리', ''), ('dialogue', '"응."', '', ''), ('narration', '속마음이다.', '', '해리'), ('dialogue', '"정답"', '론', ''))
    turns[2]['status'] = 'unlabeled'
    lines = ot.context_lines(turns, 4, k=4, limit=1000)
    assert [(l['by'], l['kind']) for l in lines] == [('나레이션', 'narration'), ('해리', 'dialogue'), ('화자 미상', 'dialogue'), ('나레이션', 'monologue')]
    assert ot.context_lines(turns, 4, k=2, limit=1000)[0]['text'] == '"응."'
    short = ot.context_lines(turns, 4, k=4, limit=len('속마음이다.') + len('"응."'))
    assert [l['text'] for l in short] == ['"응."', '속마음이다.']   # 글자 수 상한이 넘으면 오래된 줄부터 뺀다
    assert ot.context_lines(turns, 0, k=4, limit=1000) == []


def test_first_person_narrator_line_is_named_na():
    turns = aligned(('dialogue', '"가자."', '나', ''), ('dialogue', '"싫어."', '점순', ''))
    assert [l['by'] for l in ot.context_lines(turns, 2, k=2, limit=100)] == ['나', '점순']


def test_cast_around_orders_by_frequency_and_includes_gold():
    turns = aligned(*[('dialogue', f'"{n}"', s, '') for n, s in enumerate(['해리', '론', '해리', '헤르미온느', '해리', '론', '론', '드레이코'])])
    assert ot.cast_around(turns, 3, window=2) == ['헤르미온느', '론', '해리']   # 앞뒤 2턴 안의 화자: 정답 화자가 먼저, 나머지는 많이 나온 순(같으면 먼저 나온 순)
    assert ot.cast_around(turns, 7, window=2, cap=2) == ['드레이코', '론']      # 상한 안에서도 정답 화자는 남는다
    assert ot.cast_around(turns, 3, window=2, only={'헤르미온느', '해리'}) == ['헤르미온느', '해리']   # 카드가 없는 이름은 only로 거른다


def test_person_of_text():
    assert ot.person_of('나는 그 앞에 서서 내가 할 말을 생각했다. 나는 고개를 숙였다.') == 'first'
    assert ot.person_of('그는 문을 열었다. 그녀는 웃었다. 그가 말했다.') == 'third'
