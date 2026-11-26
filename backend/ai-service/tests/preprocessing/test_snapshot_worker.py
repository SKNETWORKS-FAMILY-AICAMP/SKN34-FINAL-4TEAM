import importlib
import logging
from threading import Barrier
from types import SimpleNamespace

import httpx
import pytest

from app.manuscript_extraction.errors import PreprocessingFailure
from app.preprocessing import worker
from app.preprocessing.models import JobRequest

from traced import attrs, named, status_of

REQUEST = JobRequest(jobId="job", workId="work", episodes=[1, 2])
RAW = {"number": 2, "title": "둘", "body": "원문"}


def rejected(status):
    request = httpx.Request("POST", "http://content/internal")
    return httpx.HTTPStatusError("rejected", request=request, response=httpx.Response(status, request=request))


def content(monkeypatch, failing=None, loading=False, prepared=False, missing=(RAW,), known=None):
    """Content 대역. 호출을 (action, data)로 모으고, failing={action: 예외 또는 data→예외·None}인 호출은 그 예외를 던진다."""
    calls = []
    def callback(job, action, data):
        calls.append((action, data))
        error = (failing or {}).get(action)
        error = error(data) if callable(error) else error
        if error:
            raise error
        if action == "claim":
            return {"claimed": True, "loading": loading, "token": "lease", "missing": list(missing)}
        if action == "structure-input":
            return {"prepared": prepared, "results": [], **({"knownCharacters": known} if known else {})}
        return {}
    monkeypatch.setattr(worker, "callback", callback)
    return calls


def dumped(value):
    return SimpleNamespace(model_dump=lambda mode: value)


def model(monkeypatch, extract=None, resolve=None, organize=None):
    monkeypatch.setattr(worker.service, "extract", extract or (lambda ep: dumped({"number": ep.number})))
    monkeypatch.setattr(worker.service, "resolve", resolve or (lambda rows: dumped({"identity": True})))
    monkeypatch.setattr(worker.service, "organize", organize or (lambda identity, rows: dumped({"payload": True})))


def raises(error):
    def fail(*args):
        raise error
    return fail


def test_duplicate_delivery_never_extracts_or_loads(monkeypatch):
    calls = []
    def callback(job, action, data):
        calls.append(action)
        return {"claimed": False}
    monkeypatch.setattr(worker, "callback", callback)
    worker.run(JobRequest(jobId="job", workId="work", episodes=[1]))
    assert calls == ["claim"]


def test_pending_load_recovers_without_model(monkeypatch):
    calls = content(monkeypatch, loading=True)
    worker.run(JobRequest(jobId="job", workId="work", episodes=[1]))
    assert calls[-1] == ("load", {"token": "lease"}) and [action for action, _ in calls] == ["claim", "load"]


def test_a_finished_job_runs_every_stage_in_order_and_its_trace_is_a_success(monkeypatch, spans):
    calls = content(monkeypatch)
    model(monkeypatch)
    worker.run(REQUEST)
    assert status_of(spans()[0]) == "success"
    assert calls == [("claim", {"workId": "work"}), ("result", {"token": "lease", "result": {"number": 2}}), ("structure-input", {"token": "lease"}),
                     ("structure", {"token": "lease", "identity": {"identity": True}, "payload": {"payload": True}}), ("load", {"token": "lease"})]


@pytest.mark.parametrize("failed_episode", [None, 2])
def test_extracts_four_at_a_time_and_saves_results_before_finishing(monkeypatch, spans, failed_episode):
    raws = [{"number": n, "title": "t", "body": "원문"} for n in range(1, 6)]
    calls = content(monkeypatch, missing=raws)
    first_batch = Barrier(4, timeout=5)

    def extract(episode):
        with worker.tracing.observe("test.extract"):
            if episode.number <= 4:
                first_batch.wait()
            else:
                assert [data["result"]["number"] for action, data in calls if action == "result"] == [
                    n for n in range(1, 5) if n != failed_episode
                ]
            if episode.number == failed_episode:
                raise PreprocessingFailure("MODEL_TIMEOUT")
            return dumped({"number": episode.number})

    model(monkeypatch, extract=extract)
    worker.run(REQUEST)

    saved = [data["result"]["number"] for action, data in calls if action == "result"]
    assert saved == [n for n in range(1, 6) if n != failed_episode]
    if failed_episode is None:
        assert [action for action, _ in calls][-3:] == ["structure-input", "structure", "load"]
    else:
        assert calls[-1] == ("failed", {"token": "lease", "episodes": [failed_episode], "reason": "AI_TIMEOUT"})
        assert "structure-input" not in [action for action, _ in calls]
    [root] = named(spans, "manuscript_extraction")
    extractions = named(spans, "test.extract")
    assert len(extractions) == len(raws)
    assert all(span.parent == root.context for span in extractions)


def test_the_existing_characters_of_an_update_reach_resolve_and_organize_and_an_initial_build_is_called_without_them(monkeypatch):
    known = [{"ref": "0:k1", "name": "치삼", "aliases": []}]
    content(monkeypatch, known=known)
    seen = []
    model(monkeypatch, resolve=lambda rows, known: seen.append(("resolve", known)) or dumped({"identity": True}),
          organize=lambda identity, rows, known: seen.append(("organize", known)) or dumped({"payload": True}))
    worker.run(REQUEST)
    assert seen == [("resolve", known), ("organize", known)]


def test_a_prepared_structure_skips_the_model_and_goes_to_load(monkeypatch):
    calls = content(monkeypatch, prepared=True)
    model(monkeypatch, resolve=raises(AssertionError("must not run")))
    worker.run(REQUEST)
    assert [action for action, _ in calls] == ["claim", "result", "structure-input", "load"]


def test_only_missing_episodes_are_called_and_the_worker_does_not_load_after_failure(monkeypatch):
    seen = content(monkeypatch)
    def extract(ep):
        assert ep.number == 2
        raise PreprocessingFailure("MODEL_TIMEOUT")
    model(monkeypatch, extract=extract)
    worker.run(REQUEST)
    assert seen == [("claim", {"workId": "work"}), ("failed", {"token": "lease", "episodes": [2], "reason": "AI_TIMEOUT"})]


@pytest.mark.parametrize("code, reason", [
    ("MODEL_TIMEOUT", "AI_TIMEOUT"), ("MODEL_UNAVAILABLE", "AI_RESPONSE_UNCONFIRMED"),
    ("MODEL_NOT_CONFIGURED", "AI_REQUEST_REJECTED"), ("MODEL_INPUT_TOO_LARGE", "AI_REQUEST_REJECTED"),
    ("MODEL_OUTPUT_INCOMPLETE", "AI_OUTPUT_INVALID"), ("INVALID_MODEL_OUTPUT", "AI_OUTPUT_INVALID"),
    ("INVALID_EXTRACTION", "AI_OUTPUT_INVALID"), ("NO_VERIFIED_MENTION", "AI_OUTPUT_INVALID")])
def test_an_extraction_failure_is_reported_with_the_contract_reason_and_the_detail_only_in_the_log(monkeypatch, caplog, code, reason):
    calls = content(monkeypatch)
    model(monkeypatch, extract=raises(PreprocessingFailure(code)))
    with caplog.at_level(logging.ERROR):
        worker.run(REQUEST)
    assert calls[-1] == ("failed", {"token": "lease", "episodes": [2], "reason": reason}) and code in caplog.text


@pytest.mark.parametrize("stage", ["resolve", "organize"])
@pytest.mark.parametrize("code, reason", [("NO_SETTINGS_FOUND", "NO_SETTINGS_FOUND"), ("IDENTITY_INPUT_MISMATCH", "AI_OUTPUT_INVALID")])
def test_a_structure_failure_is_reported_for_no_episode(monkeypatch, stage, code, reason):
    calls = content(monkeypatch)
    model(monkeypatch, **{stage: raises(PreprocessingFailure(code))})
    worker.run(REQUEST)
    assert calls[-1] == ("failed", {"token": "lease", "episodes": [], "reason": reason}) and "structure" not in [a for a, _ in calls]


def test_an_unexpected_exception_fails_that_episode_and_logs_only_its_class(monkeypatch, caplog):
    calls = content(monkeypatch)
    model(monkeypatch, extract=raises(KeyError("원고 본문 비밀")))
    with caplog.at_level(logging.ERROR):
        worker.run(REQUEST)
    assert calls[-1] == ("failed", {"token": "lease", "episodes": [2], "reason": "AI_OUTPUT_INVALID"})
    assert "KeyError" in caplog.text and "비밀" not in caplog.text


def test_an_unexpected_exception_while_structuring_is_a_failure_too(monkeypatch):
    calls = content(monkeypatch)
    model(monkeypatch, resolve=raises(RuntimeError("boom")))
    worker.run(REQUEST)
    assert calls[-1] == ("failed", {"token": "lease", "episodes": [], "reason": "AI_OUTPUT_INVALID"})


@pytest.mark.parametrize("action, episodes", [("result", [2]), ("structure", []), ("load", [])])
def test_a_content_rejection_is_a_recorded_failure_instead_of_a_stuck_job(monkeypatch, action, episodes):
    calls = content(monkeypatch, failing={action: rejected(422)})
    model(monkeypatch)
    worker.run(REQUEST)
    assert calls[-1] == ("failed", {"token": "lease", "episodes": episodes, "reason": "CONTENT_REJECTED"})
    assert [a for a, _ in calls].count(action) == 1  # 같은 거절을 다시 보내지 않는다


@pytest.mark.parametrize("error", [rejected(503), httpx.ReadTimeout("slow")])
def test_a_content_outage_is_not_recorded_as_a_failure_and_stays_resumable(monkeypatch, error):
    calls = content(monkeypatch, failing={"result": error})
    model(monkeypatch)
    with pytest.raises((httpx.HTTPStatusError, httpx.ReadTimeout)):
        worker.run(REQUEST)
    assert "failed" not in [action for action, _ in calls]


def test_a_rejected_result_reports_all_unsaved_episodes_and_stops_before_the_next_batch(monkeypatch):
    raws = [{"number": n, "title": "t", "body": "원문"} for n in range(1, 6)]
    calls = content(monkeypatch, missing=raws, failing={"result": lambda data: rejected(422) if data["result"]["number"] == 2 else None})
    asked = []
    model(monkeypatch, extract=lambda ep: asked.append(ep.number) or dumped({"number": ep.number}))
    worker.run(REQUEST)
    assert sorted(asked) == [1, 2, 3, 4]
    assert [data["result"]["number"] for action, data in calls if action == "result"] == [1, 2]
    assert calls[-1] == ("failed", {"token": "lease", "episodes": [2, 3, 4, 5], "reason": "CONTENT_REJECTED"})


def test_a_failed_extraction_and_a_later_rejection_are_both_reported(monkeypatch):
    raws = [{"number": n, "title": "t", "body": "원문"} for n in (1, 2, 3)]
    calls = content(monkeypatch, missing=raws, failing={"result": lambda data: rejected(422) if data["result"]["number"] == 3 else None})
    def extract(ep):
        if ep.number == 1:
            raise PreprocessingFailure("MODEL_TIMEOUT")
        return dumped({"number": ep.number})
    model(monkeypatch, extract=extract)
    worker.run(REQUEST)
    assert calls[-1] == ("failed", {"token": "lease", "episodes": [1, 3], "reason": "CONTENT_REJECTED"})


def test_a_failure_content_already_recorded_is_not_recorded_twice_and_does_not_raise(monkeypatch):
    # Content가 원고·연결 변경을 스스로 SOURCE_CHANGED로 기록하고 load를 4xx로 거절했다면 뒤따르는 failed 콜백은 409로 거절된다. 남길 것이 없으니 조용히 끝낸다.
    calls = content(monkeypatch, failing={"load": rejected(422), "failed": rejected(409)})
    model(monkeypatch)
    worker.run(REQUEST)
    assert [action for action, _ in calls].count("failed") == 1 and calls[-1][1]["reason"] == "CONTENT_REJECTED"


def test_the_run_is_one_trace_for_the_feature_and_is_marked_failed_when_the_job_fails(monkeypatch, spans):
    content(monkeypatch)
    model(monkeypatch, extract=raises(PreprocessingFailure("MODEL_TIMEOUT")))
    worker.run(REQUEST)
    [root] = spans()
    found = attrs(root)
    assert root.name == "manuscript_extraction" and found["langfuse.trace.tags"] == ["feature:manuscript_extraction"]
    assert found["session.id"] == "job" and found["langfuse.trace.metadata.work_id"] == "work"
    assert status_of(root) == "failed" and root.attributes["langfuse.observation.level"] == "ERROR"


def test_the_celery_task_validates_the_payload_and_runs_the_worker(monkeypatch):
    ran = []
    monkeypatch.setattr(worker, "run", ran.append)
    worker.run_job({"jobId": "job", "workId": "work", "episodes": [1, 2]})
    assert ran == [REQUEST]


def test_the_celery_task_is_the_contract_one_run_one_job_at_a_time_and_acked_after_the_run():
    assert (worker.run_job.name, worker.run_job.queue) == ("preprocessing.run", "preprocessing")
    conf = worker.celery.conf
    assert (conf.task_acks_late, conf.worker_prefetch_multiplier, conf.task_ignore_result) == (True, 1, True)


def test_the_broker_comes_from_ai_celery_broker_url(monkeypatch):
    monkeypatch.setenv("AI_CELERY_BROKER_URL", "amqp://user:pw@rabbitmq:5672//")
    try:
        assert importlib.reload(worker).celery.conf.broker_url == "amqp://user:pw@rabbitmq:5672//"
    finally:
        monkeypatch.undo()
        importlib.reload(worker)
