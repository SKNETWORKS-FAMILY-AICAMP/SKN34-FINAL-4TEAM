"""동결된 서비스 모델을 CPU에서 프로세스당 한 번 로딩한다."""
import hashlib
import json
import logging
import os
from pathlib import Path

VERSION = "service-binary-v13-5097-epoch3"
SOURCE_SHA = "ed51b206d2f7911a43a8c99e103df99d0b767347cada70767a7a8ce40e63bf94"
ONNX_SHA = "af98249ad25215141849b1de2c501744ada858b2f417d0f38bd87720b3e9725a"
TOKENIZER_SHA = "5f1b31bbd2e604c54feba7c7bb9d819394898d48015294eb6a2dd3ff717f7bb0"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


DEFAULT_THRESHOLD = "0.9904975295066833"
G2_VERSION = "kcelectra-g2-5129-8456e235"
CLASSES = ("plot", "logic", "character", "style", "typo", "schedule", "overall_work", "other")

class FeedbackClassifier:
    source_sha = SOURCE_SHA
    onnx_sha = ONNX_SHA
    def __init__(self, directory: Path, threshold: float):
        if not 0 <= threshold <= 1:
            raise ValueError("잘못된 임계값")
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        if (manifest["source"]["model.safetensors"] != self.source_sha
                or digest(directory / "tokenizer.json") != TOKENIZER_SHA
                or manifest["onnx_sha256"] != self.onnx_sha or digest(directory / "model.onnx") != self.onnx_sha):
            raise ValueError("모델 번들 무결성 오류")
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self.threshold = threshold
        self.tokenizer = Tokenizer.from_file(str(directory / "tokenizer.json"))
        self.tokenizer.enable_padding(pad_id=self.tokenizer.token_to_id("[PAD]"), pad_token="[PAD]")
        self.tokenizer.enable_truncation(max_length=256)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        self.session = ort.InferenceSession(str(directory / "model.onnx"), options,
                                            providers=["CPUExecutionProvider"])

    def _scores(self, texts, classes):
        import numpy as np
        encoded = self.tokenizer.encode_batch(texts)
        inputs = {key: np.asarray([getattr(item, attr) for item in encoded], dtype=np.int64)
                  for key, attr in (("input_ids","ids"),("attention_mask","attention_mask"),("token_type_ids","type_ids"))}
        logits = self.session.run(["logits"], inputs)[0]
        if logits.shape != (len(texts), classes) or not np.isfinite(logits).all():
            raise ValueError("잘못된 모델 출력")
        exp = np.exp(logits - logits.max(axis=1, keepdims=True))
        return exp / exp.sum(axis=1, keepdims=True)

    def probabilities(self, texts):
        return self._scores(texts, 2)[:,1].tolist()

    def probability(self, text):
        return self.probabilities([text])[0]


class PrimaryClassifier(FeedbackClassifier):
    source_sha = "8456e235a78aaf19ab018b9459bf9857394308057ce5ee9f8f87b793b256cd6c"
    onnx_sha = "e027db9ad3e08cfa607f65359e2f5d15b120fd934c7f5132b341e865ba103d5f"

    def labels(self, texts):
        return [CLASSES[index] for index in self._scores(texts, len(CLASSES)).argmax(axis=1)]


def load_primary():
    try:
        return PrimaryClassifier(Path(os.getenv("FEEDBACK_G2_DIR", "/app/models/primary-g2")), 0)
    except Exception as error:
        logging.getLogger(__name__).warning("G2 로딩 실패 (%s)", type(error).__name__)
        return None


def load_classifier():
    """로딩 실패는 이 기능에만 격리한다."""
    try:
        return FeedbackClassifier(Path(os.getenv("FEEDBACK_MODEL_DIR", "/app/models/service-binary-v13-5097")),
                                  float(os.getenv("FEEDBACK_THRESHOLD", DEFAULT_THRESHOLD)))
    except Exception as error:
        logging.getLogger(__name__).warning("피드백 분류기 로딩 실패 (%s)", type(error).__name__)
        return None
