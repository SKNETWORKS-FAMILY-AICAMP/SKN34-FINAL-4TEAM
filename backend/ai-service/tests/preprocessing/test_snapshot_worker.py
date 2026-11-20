from app.preprocessing import worker
from app.preprocessing.models import JobRequest


def test_duplicate_delivery_never_extracts_or_loads(monkeypatch):
    calls = []
    def callback(job, action, data):
        calls.append(action)
        return {"claimed": False}
    monkeypatch.setattr(worker, "callback", callback)
    worker.run(JobRequest(jobId="job", workId="work", episodes=[1]))
    assert calls == ["claim"]


def test_pending_load_recovers_without_model(monkeypatch):
    calls = []
    def callback(job, action, data):
        calls.append((action, data))
        if action == "claim":
            return {"claimed": True, "token": "lease", "loading": True}
        assert action == "load"
        return {"status": "completed"}
    monkeypatch.setattr(worker, "callback", callback)
    worker.run(JobRequest(jobId="job", workId="work", episodes=[1]))
    assert calls[-1] == ("load", {"token": "lease"})


def test_only_missing_episodes_are_called_and_the_worker_does_not_load_after_failure(monkeypatch):
    from app.manuscript_extraction.errors import PreprocessingFailure
    raw = {"number": 2, "title": "둘", "body": "원문"}
    seen = []
    def callback(job, action, data):
        seen.append((job, action, data))
        if action == "claim":
            return {"claimed": True, "loading": False, "token": "one", "missing": [raw]}
        assert action == "failed"
        return {"saved": True}
    def extract(ep):
        assert ep.number == 2
        raise PreprocessingFailure("MODEL_TIMEOUT")
    monkeypatch.setattr(worker, "callback", callback)
    monkeypatch.setattr(worker.service, "extract", extract)
    worker.run(JobRequest(jobId="job", workId="work", episodes=[1, 2]))
    assert seen == [("job","claim",{"workId":"work"}),
                    ("job","failed",{"token":"one","episodes":[2],"reason":"MODEL_TIMEOUT"})]
