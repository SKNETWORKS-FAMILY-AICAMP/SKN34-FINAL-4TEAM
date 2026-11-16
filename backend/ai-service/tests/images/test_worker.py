from app.images import worker

def test_duplicate_delivery_skips_paid_call(monkeypatch):
    monkeypatch.setattr(worker, "report", lambda *a: {"claimed": False})
    monkeypatch.setattr(worker.agent, "generate", lambda *a: (_ for _ in ()).throw(AssertionError("called")))
    worker.execute.run("job")

def test_lost_completion_does_not_regenerate(monkeypatch):
    calls=[]
    def report(job,action,body=None):
        calls.append(action)
        if action=="claim": return {"claimed":True,"input":{"purpose":"work_cover","prompt":"scene"}}
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
        return {"claimed":True,"input":{"purpose":"work_cover","prompt":"scene"}} if action=="claim" else {}
    monkeypatch.setattr(worker,"report",report)
    monkeypatch.setattr(worker.agent,"generate",lambda _:b"image")
    monkeypatch.setattr(worker.service,"validate_image",lambda *a:None)
    monkeypatch.setattr(worker.service,"upload",lambda *a:(_ for _ in ()).throw(OSError()))
    worker.execute.run("job")
    assert calls==["claim","progress","failed"]
