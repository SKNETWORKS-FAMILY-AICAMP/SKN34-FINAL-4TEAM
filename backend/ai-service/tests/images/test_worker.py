from unittest.mock import Mock
from app.images.models import ClaimResponse
from app.images import worker

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
