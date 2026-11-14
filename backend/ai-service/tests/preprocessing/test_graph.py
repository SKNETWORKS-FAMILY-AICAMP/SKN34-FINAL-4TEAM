"""전처리 그래프(LangGraph): 정상 경로는 load까지 가고, 한 회차라도 실패하면 fail에서 멈춘다. 로직·Content는 대역이다."""
import pytest

from app.preprocessing import graph, service
from app.preprocessing.errors import REASONS

from .stubs import JOB, content_double, episode, logic_double, payload


def test_the_graph_reaches_load_with_every_episode_extracted(monkeypatch):
    remote = content_double(monkeypatch)
    logic = logic_double(monkeypatch)
    graph.run(JOB, [1, 2, 3])
    assert [p['stage'] for p in remote.progress] == ['extracting', 'resolving', 'organizing', 'loading']
    assert sorted(remote.reads) == [1, 2, 3]                                     # Send: 회차마다 한 번
    assert logic.resolved == [{1: 1, 2: 2, 3: 3}] and logic.organized == ['identities']
    assert remote.loads == [(JOB, payload())]


def test_failed_episodes_go_to_fail_and_nothing_after_resolve_runs(monkeypatch):
    remote = content_double(monkeypatch)
    logic = logic_double(monkeypatch, failing={2, 3})
    final = graph.run(JOB, [1, 2, 3])
    assert final['failed'] == [2, 3] and 'identities' not in final
    assert remote.progress[-1] == {'stage': 'extracting', 'done': 1, 'total': 3, 'failedEpisodes': [2, 3],
                                   'failed': REASONS['extracting']}
    assert logic.resolved == [] and remote.loads == []


def test_the_logic_is_left_for_the_follow_up_work():
    with pytest.raises(NotImplementedError):
        service.extract(episode(1))
