"""CPU 서비스 실측. 합성 입력만 사용하며 학습·평가 데이터는 읽지 않는다."""
import json
import os
import statistics
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient
import platform
import subprocess

def peak_mib():
    if os.name == "nt":
        size = subprocess.check_output(["powershell.exe","-NoProfile","-Command",
            f"(Get-Process -Id {os.getpid()}).PeakWorkingSet64"], text=True)
        return int(size.strip()) / 2**20
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
from app.comment_feedback.router import router
from app.comment_feedback.service import CLASSES, load_classifier, load_primary

texts = ["다음 회차도 자주 올려주세요.", "이 문장은 맞춤법이 틀렸어요.",
         "캐릭터의 감정 변화가 설득력 있게 묘사됐어요.", "잘 읽고 갑니다!",
         "주인공의 행동이 앞 장면과 맞지 않아요.", "설정이 서로 모순됩니다.",
         "문장이 너무 길어서 읽기가 어려워요.", "이번 전투 전개는 긴장감이 넘쳤어요."]
started = time.perf_counter()
app = FastAPI()
app.include_router(router)
binary = app.state.feedback_classifier = load_classifier()
primary = app.state.feedback_primary = load_primary()
assert binary and primary
loaded = time.perf_counter() - started
labels = primary.labels(texts)
assert labels == [primary.labels([text])[0] for text in texts]
os.environ["INTERNAL_TOKEN"] = "local-synthetic-only"
headers = {"X-Internal-Token": os.environ["INTERNAL_TOKEN"]}
with TestClient(app) as client:
    single = [client.post("/internal/v1/comments/feedback", headers=headers,
                          json={"text": t}).json() for t in texts]
    times = []
    for _ in range(5):
        start = time.perf_counter()
        response = client.post("/internal/v1/comments/feedback/batch",headers=headers,
                               json={"items":[{"id":str(i),"text":t} for i,t in enumerate(texts)]})
        response.raise_for_status()
        times.append(time.perf_counter()-start)
    rows = response.json()
    for i, row in enumerate(rows):
        assert row["id"] == str(i)
        assert row["isFeedback"] == single[i]["isFeedback"]
        assert abs(row["feedbackProbability"] - single[i]["feedbackProbability"]) < 1e-5
        assert row["primaryAspect"] == (labels[i] if row["isFeedback"] else None)
print(json.dumps(dict(classes=CLASSES, batch=len(texts), labels=labels, positives=sum(x["isFeedback"] for x in rows),
                      modelLoadSeconds=loaded,batchSeconds=times,medianSeconds=statistics.median(times),
                      platform=platform.platform(), peakMiB=peak_mib())))
