from unittest.mock import Mock
from urllib.error import HTTPError, URLError
from celery.exceptions import Reject
import pytest
from app.images.models import ClaimResponse
from app.images import moderation, worker


@pytest.mark.parametrize('error', [URLError('internal peer'), HTTPError('', 503, 'unavailable', {}, None)])
def test_unavailable_claim_requeues_before_any_model_call(monkeypatch, error):
    pause = Mock()
    generate = Mock()
    monkeypatch.setattr(worker, 'sleep', pause, raising=False)
    monkeypatch.setattr(worker, 'report', Mock(side_effect=error))
    monkeypatch.setattr(worker.agent, 'generate', generate)

    with pytest.raises(Reject) as rejected:
        worker.execute.run('job')

    assert rejected.value.requeue and worker.app.conf.task_acks_late
    assert 'internal peer' not in str(rejected.value)
    pause.assert_called_once()
    generate.assert_not_called()


def test_nonretryable_claim_response_does_not_requeue(monkeypatch):
    monkeypatch.setattr(worker, 'report', Mock(side_effect=HTTPError('', 404, 'missing', {}, None)))
    assert worker.execute.run('job') == {'status': 'interrupted'}

def test_duplicate_delivery_skips_paid_call(monkeypatch):
    monkeypatch.setattr(worker, "report", lambda *a: ClaimResponse(claimed=False))
    generate = Mock()
    monkeypatch.setattr(worker.agent, "generate", generate)
    worker.execute.run("job")
    generate.assert_not_called()

def test_lost_completion_does_not_regenerate(monkeypatch):
    calls=[]
    def report(job,action,body=None):
        calls.append(action)
        if action=="claim": return ClaimResponse.model_validate({"claimed":True,"input":{"purpose":"work_cover","prompt":"scene"}})
        if action=="complete": raise OSError("private error")
        return {}
    monkeypatch.setattr(worker,"report",report)
    generated=[]
    monkeypatch.setattr(worker.agent,"generate",lambda _: generated.append(1) or b"image")
    monkeypatch.setattr(worker.service,"validate_image",lambda *a:None)
    monkeypatch.setattr(moderation, "check_output", lambda _: None)
    monkeypatch.setattr(worker.service,"upload",lambda *a:"image-generations/job.png")
    assert worker.execute.run("job")=={"status":"interrupted"}
    assert len(generated)==1
    assert calls==["claim","progress","complete"]

def test_upload_failure_is_explicit(monkeypatch):
    calls=[]
    def report(job,action,body=None):
        calls.append(action)
        return ClaimResponse.model_validate({"claimed":True,"input":{"purpose":"work_cover","prompt":"scene"}}) if action=="claim" else {}
    monkeypatch.setattr(worker,"report",report)
    monkeypatch.setattr(worker.agent,"generate",lambda _:b"image")
    monkeypatch.setattr(worker.service,"validate_image",lambda *a:None)
    monkeypatch.setattr(moderation, "check_output", lambda _: None)
    monkeypatch.setattr(worker.service,"upload",lambda *a:(_ for _ in ()).throw(OSError()))
    worker.execute.run("job")
    assert calls==["claim","progress","failed"]


def test_unavailable_reference_does_not_fall_back_to_paid_text_generation(monkeypatch):
    calls = []

    def report(job, action, body=None):
        calls.append(action)
        if action == "claim":
            return ClaimResponse.model_validate({"claimed": True, "input": {
                "purpose": "work_cover", "prompt": "scene",
                "templateVersion": "cover-v3", "referenceRole": "style",
            }})

    monkeypatch.setattr(worker, "report", report)
    monkeypatch.setattr(worker, "read_reference", Mock(side_effect=OSError))
    generate = Mock()
    monkeypatch.setattr(worker.agent, "generate", generate)

    worker.execute.run("job")

    generate.assert_not_called()
    assert calls == ["claim", "failed"]


@pytest.mark.parametrize(("error", "stage"), [
    (moderation.OutputBlocked, "output_blocked"),
    (moderation.OutputModerationUnavailable, "moderation_unavailable"),
])
def test_unapproved_output_never_uploads_or_completes(monkeypatch, error, stage):
    calls = Mock()
    calls.report.side_effect = [ClaimResponse.model_validate({"claimed": True, "input": {
        "purpose": "work_cover", "prompt": "scene",
    }}), None]
    calls.generate.return_value = b"generated png"
    calls.check_output.side_effect = error
    monkeypatch.setattr(worker, "report", calls.report)
    monkeypatch.setattr(worker.agent, "generate", calls.generate)
    monkeypatch.setattr(worker.service, "validate_image", calls.validate_image)
    monkeypatch.setattr(moderation, "check_output", calls.check_output)
    monkeypatch.setattr(worker.service, "upload", calls.upload)

    worker.execute.run("job")

    assert [event[0] for event in calls.mock_calls] == ["report", "generate", "validate_image", "check_output", "report"]
    calls.check_output.assert_called_once_with(b"generated png")
    assert calls.report.call_args.args[1] == "failed"
    assert calls.report.call_args.args[2].stage == stage


def test_approved_output_uploads_only_after_check(monkeypatch):
    calls = Mock()
    calls.report.side_effect = [ClaimResponse.model_validate({"claimed": True, "input": {
        "purpose": "work_cover", "prompt": "scene",
    }}), None, None]
    calls.generate.return_value = b"generated png"
    calls.upload.return_value = "image-generations/job.png"
    monkeypatch.setattr(worker, "report", calls.report)
    monkeypatch.setattr(worker.agent, "generate", calls.generate)
    monkeypatch.setattr(worker.service, "validate_image", calls.validate_image)
    monkeypatch.setattr(moderation, "check_output", calls.check_output)
    monkeypatch.setattr(worker.service, "upload", calls.upload)

    worker.execute.run("job")

    assert [event[0] for event in calls.mock_calls] == ["report", "generate", "validate_image", "check_output", "report", "upload", "report"]
    calls.check_output.assert_called_once_with(b"generated png")
    calls.upload.assert_called_once_with("job", b"generated png")
