import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.comment_feedback.router import router


pytestmark = pytest.mark.integration


class FixedModel:
    threshold = 0.5

    def probability(self, text):
        assert text == "즐겁게 읽었습니다."
        return 0.5


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INTERNAL_TOKEN", "unit-test")
    app = FastAPI()
    app.include_router(router)
    app.state.feedback_classifier = FixedModel()
    return TestClient(app)


def post(client, text, token="unit-test"):
    return client.post("/internal/v1/comments/feedback", json={"text": text},
                       headers={"X-Internal-Token": token})


def test_strict_threshold(client):
    response = post(client, " 즐겁게 읽었습니다. ")
    assert response.status_code == 200
    assert response.json() == {"feedbackProbability": 0.5, "isFeedback": False,
                               "threshold": 0.5, "modelVersion": "service-binary-v13-5097-epoch3"}


@pytest.mark.parametrize("text", ["", "   ", "가" * 501, "😀" * 251, "가\x00나", None, 123])
def test_invalid_input(client, text):
    assert post(client, text).status_code == 422


def test_authentication(client):
    assert post(client, "댓글", "invalid").status_code == 403


def test_unavailable(client):
    client.app.state.feedback_classifier = None
    assert post(client, "댓글").status_code == 503



def test_inference_failure(client, monkeypatch):
    def fail(_):
        raise RuntimeError("internal details")

    monkeypatch.setattr(client.app.state.feedback_classifier, "probability", fail)
    response = post(client, "본문")
    assert response.status_code == 503
    assert "internal details" not in response.text


def test_invalid_config(monkeypatch, tmp_path):
    from app.comment_feedback.service import load_classifier

    monkeypatch.setenv("FEEDBACK_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("FEEDBACK_THRESHOLD", "nan")
    assert load_classifier() is None
    monkeypatch.setenv("FEEDBACK_THRESHOLD", "0.50")
    (tmp_path / "manifest.json").write_text("{}")
    assert load_classifier() is None

def test_final_batch_keeps_threshold_equality_negative(client):
    class Binary:
        threshold = 0.9904975295066833
        def probabilities(self, texts):
            return [self.threshold, 1.]
    class Primary:
        def labels(self, texts):
            assert texts == ["두번째"]
            return ["plot"]
    client.app.state.feedback_classifier = Binary()
    client.app.state.feedback_primary = Primary()
    response = client.post("/internal/v1/comments/feedback/batch", headers={"X-Internal-Token":"unit-test"},
        json={"items":[{"id":"1","text":"첫번째"},{"id":"2","text":"두번째"}]})
    assert response.status_code == 200
    assert [(r["id"],r["isFeedback"],r["primaryAspect"]) for r in response.json()] == [("1",False,None),("2",True,"plot")]

def test_batch_rejects_duplicate_ids(client):
    body = {"items":[{"id":"a", "text":"문장"}]*2}
    assert client.post("/internal/v1/comments/feedback/batch",json=body,
                       headers={"X-Internal-Token":"unit-test"}).status_code == 422


def test_positive_batch_requires_loaded_g2(client):
    client.app.state.feedback_classifier.probabilities = lambda texts: [1.0]
    client.app.state.feedback_primary = None
    body = {"items":[{"id":"a", "text":"문장"}]}
    assert client.post("/internal/v1/comments/feedback/batch",json=body,
                       headers={"X-Internal-Token":"unit-test"}).status_code == 503
    assert post(client,"즐겁게 읽었습니다.").status_code == 200


def test_frozen_class_mapping():
    from app.comment_feedback.service import PrimaryClassifier
    model = object.__new__(PrimaryClassifier)
    class Scores:
        def argmax(self, axis):
            assert axis == 1
            return range(8)

    model._scores = lambda texts, classes: Scores()
    assert model.labels(["문장"] * 8) == ["plot","logic","character","style","typo","schedule","overall_work","other"]
