"""화자·독백 판별 실행(orig_align): 두 경로의 판별에서 같은 턴만 확정하고 실패한 청크는 판별 못 한 것으로 센다."""

import json

import orig_align as oa
import orig_turns as ot
from llm import LlmFailure


class FakeLlm:
    def __init__(self, speakers, fail_chunk=None):
        self.speakers, self.fail_chunk, self.calls = speakers, fail_chunk, 0

    def ask(self, kind, instructions, input, *, schema=None, max_output_tokens=4000):
        self.calls += 1
        request = json.loads(input)
        if self.fail_chunk is not None and request['turns'][0]['i'] == self.fail_chunk:
            raise LlmFailure('x')
        return ot.Labels(labels=[ot.Label(i=t['i'], speaker=self.speakers.get(t['i'], '') if t['kind'] == 'dialogue' else '', monologue='') for t in request['turns']])


TEXT = '\n'.join(f'"말{n}번째 대사입니다."' for n in range(6)) + '\n그는 창밖을 오래 바라보았다.'


def test_align_keeps_agreement_and_counts_chunks():
    a = FakeLlm({0: '해리', 1: '론', 2: '해리', 3: '론', 4: '해리', 5: '론'})
    b = FakeLlm({0: '해리', 1: '해리', 2: '해리', 3: '론', 4: '', 5: '론'})
    got = oa.align_episode(TEXT, ['해리', '론'], False, a, b, size=4, workers=2)
    status = {t['i']: (t['status'], t['speaker']) for t in got['turns']}
    assert status[0] == ('agreed', '해리') and status[1] == ('unlabeled', '') and status[2] == ('agreed', '해리') and status[4] == ('unlabeled', '')
    assert status[6] == ('agreed', '') and got['chunks'] == 2 and got['failedChunks'] == 0   # 지문은 둘 다 독백이 아니라고 하면 확정이다
    assert a.calls == 2 and b.calls == 2


def test_failed_chunk_is_unlabeled_and_counted():
    a = FakeLlm({i: '해리' for i in range(6)}, fail_chunk=4)
    b = FakeLlm({i: '해리' for i in range(6)})
    got = oa.align_episode(TEXT, ['해리', '론'], False, a, b, size=4, workers=1)
    assert got['failedChunks'] == 1
    assert [t['status'] for t in got['turns']] == ['agreed'] * 4 + ['unlabeled'] * 3   # 두 번째 청크(4~6번)는 모두 판별 못 한 것


def test_agreement_summary_counts_dialogue_and_narration():
    turns = [{'kind': 'dialogue', 'status': 'agreed'}, {'kind': 'dialogue', 'status': 'unlabeled'}, {'kind': 'narration', 'status': 'agreed', 'monologue': '해리'}, {'kind': 'narration', 'status': 'agreed', 'monologue': ''}]
    assert oa.agreement(turns) == {'dialogue': 2, 'dialogueAgreed': 1, 'narration': 2, 'narrationAgreed': 2, 'monologue': 1}
