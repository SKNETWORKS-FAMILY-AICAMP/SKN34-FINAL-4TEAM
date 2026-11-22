"""운영 LLMOps 등록 형식 내보내기(orig_export): 라이선스별 파일 분리, 항목 형식."""

import orig_export as oe

PD = {'id': 'public-1-0001', 'kind': 'dialogue', 'speaker': '길동', 'n': 3, 'gold': '"가자."', 'source': {'title': '홍길동전', 'author': '작자 미상', 'license': '저작권 만료', 'source': 'https://ko.wikisource.org/wiki/x', 'kind': 'classic'}}
SCP = {**PD, 'id': 'public-1-0002', 'source': {'title': '이야기', 'author': 'Raihorizon', 'license': 'CC BY-SA 3.0', 'source': 'https://scpko.wikidot.com/babel', 'kind': 'scp'}}


def test_split_by_license_separates_scp_from_expired_works():
    free, scp = oe.split_by_license([PD, SCP, {**PD, 'source': {**PD['source'], 'kind': 'modern'}}])
    assert [i['id'] for i in free] == ['public-1-0001', 'public-1-0001'] or len(free) == 2
    assert [i['id'] for i in scp] == ['public-1-0002']


def test_expected_output_per_set():
    assert oe.expected_output('1', PD) == '"가자."' and oe.expected_output('3n', PD) == '"가자."'
    assert oe.expected_output('2', {**PD, 'kind': 'dialogue'}) == 'dialogue: 길동' and oe.expected_output('2', {**PD, 'kind': 'narration', 'speaker': ''}) == 'narration'
    assert oe.expected_output('4', {'label': 'pass'}) == '통과' and oe.expected_output('4', {'label': 'reject'}) == '거절'


def test_record_has_the_existing_dataset_shape_and_license_metadata():
    rec = oe.record('1', SCP, 'sim.orig.scp-1-01', {'set': 'dialogue', 'data': {'x': 1}})
    assert set(rec) == {'id', 'input', 'expectedOutput', 'metadata'} and rec['id'] == 'sim.orig.scp-1-01'
    assert rec['metadata']['criteria'].strip() and rec['metadata']['license'] == 'CC BY-SA 3.0'
    assert rec['metadata']['source'] == {'work': '이야기', 'author': 'Raihorizon', 'origin': 'https://scpko.wikidot.com/babel', 'license': 'CC BY-SA 3.0', 'episode': 3}


def test_pick_is_even_and_capped():
    items = [{'id': str(i)} for i in range(10)]
    assert [i['id'] for i in oe.pick(items, 4)] == ['0', '2', '5', '7'] and len(oe.pick(items[:3], 5)) == 3
