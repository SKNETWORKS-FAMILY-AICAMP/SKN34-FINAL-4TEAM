"""원고 검색 v1용 E5-small 로컬 실행과 Q&A 답변의 인용 대조. 색인·검색 범위는 Content가 소유한다."""

import hashlib
import os
from functools import lru_cache
from pathlib import Path

from app.manuscript import agent
from app.manuscript.errors import ManuscriptFailure
from app.manuscript.models import AnswerRequest, AnswerResponse, EmbeddingRequest, EmbeddingResponse

MODEL = 'intfloat/multilingual-e5-small'
REVISION = '614241f622f53c4eeff9890bdc4f31cfecc418b3'
ONNX_FILE = 'model_qint8_avx512_vnni.onnx'
FILES = {
    ONNX_FILE: 'dd476dd0c2514e9b9be83aeb3853fac0763e0bdf4a71645407587d77c48a2d88',
    'tokenizer.json': '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
}


class E5Encoder:
    def __init__(self, directory: Path):
        import numpy
        import onnxruntime
        from tokenizers import Tokenizer

        for name, expected in FILES.items():
            with (directory / name).open('rb') as artifact:
                if hashlib.file_digest(artifact, 'sha256').hexdigest() != expected:
                    raise RuntimeError('Unexpected manuscript model artifact')
        self.numpy = numpy
        self.tokenizer = Tokenizer.from_file(str(directory / 'tokenizer.json'))
        self.tokenizer.enable_padding(pad_id=1, pad_token='<pad>')
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = 4
        self.session = onnxruntime.InferenceSession(
            str(directory / ONNX_FILE), options, providers=['CPUExecutionProvider'],
        )

    def encode(self, texts: list[str]) -> list[list[float]]:
        """토큰 길이를 확인하고 padding을 제외한 평균을 L2 정규화한다."""
        np = self.numpy
        tokens = self.tokenizer.encode_batch(texts)
        if len(tokens[0].ids) > 512:
            raise ValueError('E5 input exceeds 512 tokens')
        mask = np.array([token.attention_mask for token in tokens], dtype=np.int64)
        states, *_ = self.session.run(None, {
            'input_ids': np.array([token.ids for token in tokens], dtype=np.int64),
            'attention_mask': mask,
            'token_type_ids': np.array([token.type_ids for token in tokens], dtype=np.int64),
        })
        pooled = np.einsum('bsh,bs->bh', states, mask) / mask.sum(axis=1, keepdims=True)
        vectors = pooled / np.linalg.norm(pooled, axis=1, keepdims=True)
        if vectors.shape != (len(texts), 384) or not np.isfinite(vectors).all():
            raise RuntimeError('Invalid E5 result')
        return vectors.tolist()


@lru_cache(maxsize=1)
def get_encoder() -> E5Encoder:
    """설정된 로컬 모델을 최초 요청 때 검증하고 연다."""
    directory = os.environ.get('MANUSCRIPT_EMBEDDING_MODEL_DIR')
    if not directory:
        raise RuntimeError('Manuscript model directory missing')
    return E5Encoder(Path(directory))


def embed(data: EmbeddingRequest) -> EmbeddingResponse:
    """문단 또는 질문에 E5 접두어를 붙여 같은 리비전으로 변환한다."""
    try:
        vectors = get_encoder().encode([f'{data.kind}: {text}' for text in data.texts])
    except ValueError:
        raise ManuscriptFailure(422, '원고 임베딩 입력 한도 초과') from None
    except Exception:
        raise ManuscriptFailure(503, '로컬 원고 임베딩을 실행할 수 없습니다.') from None
    return EmbeddingResponse(model=MODEL, revision=REVISION, vectors=vectors)


def answer(data: AnswerRequest) -> AnswerResponse:
    """모든 주장이 전달한 발췌 id만 인용할 때 답변을 돌려준다. 어긋나면 보정하지 않고 502다."""
    result = agent.answer(data)
    ids = {excerpt.id for excerpt in data.excerpts}
    if not all(claim.sourceIds and set(claim.sourceIds) <= ids for claim in result.claims):
        raise ManuscriptFailure(502, 'Q&A 답변의 출처를 확인할 수 없습니다.')
    return result
