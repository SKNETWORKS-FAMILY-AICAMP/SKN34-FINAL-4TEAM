import run

NOW = [0.0]


class Target:
    def __init__(self):
        self.prepared = 0

    def prepare(self, mode):
        self.prepared += 1

    def generate(self, case, mode):
        NOW[0] += run.REPREPARE_S + 1   # 사례 하나가 갱신 주기보다 오래 걸린다
        return {'ok': True}


def test_generate_prepares_again_once_the_login_is_older_than_the_refresh_window(tmp_path, monkeypatch):
    monkeypatch.setattr(run.common, 'DATA', tmp_path)
    monkeypatch.setattr(run.time, 'time', lambda: NOW[0])
    target = Target()
    run.generate(target, 't', 'G', {'a': {}, 'b': {}}, 1, run.common.Ledger(tmp_path / 'cost.jsonl'))
    assert target.prepared == 2   # 토큰(30분)이 끝나기 전에 다시 로그인한다
    assert len((tmp_path / 'runs' / 't-G.jsonl').read_text(encoding='utf-8').splitlines()) == 2


def test_capture_cost_counts_only_this_process_even_when_another_worker_writes_the_shared_ledger(tmp_path, monkeypatch):
    monkeypatch.setattr(run.common, 'DATA', tmp_path)
    ledger = run.common.Ledger(tmp_path / 'cost.jsonl')

    class Other(Target):
        def generate(self, case, mode):
            with (tmp_path / 'cost.jsonl').open('a', encoding='utf-8') as f:   # 다른 워커가 같은 장부에 쓴 줄
                f.write('{"usd": 5.0, "tag": "other"}\n')
            ledger.charge((1_000_000, 0, 0), 'm', 'responses')               # 이 프로세스 몫 0.2달러
            return {'ok': True}

    run.generate(Other(), 't', 'G', {'a': {}}, 1, ledger)
    row = run.common.jsonl(tmp_path / 'runs' / 't-G.jsonl')[0]
    assert row['usd_generate'] == 0.2
