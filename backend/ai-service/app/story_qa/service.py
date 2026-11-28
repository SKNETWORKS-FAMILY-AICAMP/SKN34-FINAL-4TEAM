"""원고 검색 v1용 E5-small 로컬 실행, Q&A의 세계관 근거(Content MCP, #490)와 답변의 인용 대조. 원고 색인·검색 범위는 Content가 소유한다."""

import hashlib
import os
from functools import lru_cache
from pathlib import Path

from app import agent_runtime, tracing
from app.content_mcp import service as content_mcp
from app.novelbrain.models import world_snapshot
from app.novelbrain.service import bm25_rank, episode_settings
from app.story_qa import agent
from app.story_qa.errors import StoryQaFailure
from app.story_qa.models import QUOTE_LIMIT, AnswerRequest, AnswerResponse, EmbeddingRequest, EmbeddingResponse, Excerpt

MODEL = 'intfloat/multilingual-e5-small'
REVISION = '614241f622f53c4eeff9890bdc4f31cfecc418b3'
ONNX_FILE = 'model_qint8_avx512_vnni.onnx'
FILES = {
    ONNX_FILE: 'dd476dd0c2514e9b9be83aeb3853fac0763e0bdf4a71645407587d77c48a2d88',
    'tokenizer.json': '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
}
NO_WORLD = '이 작품에 연결된 세계관이 없어 설정·관계는 확인하지 못했어요. 작품 관리의 세계관 탭에서 원고로 세계관을 만들거나 내 세계관을 연결할 수 있어요.'
NO_SETTINGS = '기준 회차까지 공개된 세계관 설정·관계에서 질문에 쓸 근거를 찾지 못했어요.'
BAD_WORLD = 'Content 세계관 응답을 확인할 수 없습니다.'
# shortcut: 시연 규모라 공개 카드·관계를 모두 보내고 8건이 넘을 때만 질문과 BM25로 맞는 8건을 고른다. 세계관이 커져 누락이 잦으면 NovelBrain recall로 바꾼다.
WORLD_EXCERPTS = 8


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
        raise StoryQaFailure(422, '원고 임베딩 입력 한도 초과') from None
    except Exception:
        raise StoryQaFailure(503, '로컬 원고 임베딩을 실행할 수 없습니다.') from None
    return EmbeddingResponse(model=MODEL, revision=REVISION, vectors=vectors)


def answer(data: AnswerRequest) -> AnswerResponse:
    """모든 주장이 전달한 발췌 id만 인용할 때 답변을 돌려준다. 어긋나면 보정하지 않고 502다.

    추적: retrieval(Content가 검색·재대조해 보낸 근거) → 모델 생성(agent) → evidence_check(인용 대조).
    질문·답변과 원고 인용 본문을 남기고 설정·관계 발췌는 참조만 남긴다(tracing.excerpts).
    """
    with tracing.observe('story_context.qa', as_type='chain', input={'question': data.question},
                         metadata={'historyTurns': len(data.history)}) as qa:
        # Neo4j·Elasticsearch 조회와 원문 재대조는 Content가 이미 했다. 받은 근거를 그대로 남긴다.
        with tracing.observe('retrieval', as_type='retriever', metadata={'provider': 'content'},
                             output=tracing.excerpts(data.excerpts)):
            pass
        # 모델은 긴 UUID id(card:<uuid> 등)를 옮겨 적다 틀린다(#548). 짧은 별칭 e1·e2…로 보내고 답을 실제 id로 되돌린다.
        alias = {f'e{n}': excerpt.id for n, excerpt in enumerate(data.excerpts, 1)}
        result = agent.answer(data.model_copy(update={'excerpts': [
            excerpt.model_copy(update={'id': short}) for short, excerpt in zip(alias, data.excerpts)]}))
        with tracing.observe('evidence_check', as_type='evaluator') as check:
            cited = {i for claim in result.claims for i in claim.sourceIds}
            check.update(metadata={'citedIds': sorted(alias.get(i, i) for i in cited), 'invalidIds': sorted(cited - alias.keys()),
                                   'claims': len(result.claims), 'gaps': len(result.gaps)})
            if not all(claim.sourceIds and set(claim.sourceIds) <= alias.keys() for claim in result.claims):
                raise agent_runtime.output_problem(StoryQaFailure(502, 'Q&A 답변의 출처를 확인할 수 없습니다.'))
        result = result.model_copy(update={'claims': [
            claim.model_copy(update={'sourceIds': [alias[i] for i in claim.sourceIds]}) for claim in result.claims]})
        qa.update(output=result.model_dump())
        return result


def world_excerpts(work_id: str, episode: int, question: str) -> tuple[list[Excerpt], list[str]]:
    """작품의 세계관(연결 → Fork 상속)을 기준 회차 시점으로 읽어 그 회차까지 공개된 카드·관계를 Q&A 발췌로 바꾼다. 발췌와 gaps를 돌려준다.

    Review와 같은 공용 읽기·거르기를 쓴다. 세계관이 없거나 쓸 근거가 없으면 빈 발췌와 이유(gaps)이고, 읽기 실패는 숨기지 않고 올린다.
    MCP 도구·인자는 Content가 확인한 작품·회차로 여기서 고정하며 모델에 도구를 노출하지 않는다. AI는 설정·관계를 쓰지 않는다.
    """
    # 추적에는 고른 카드·관계의 참조만 남기고 본문은 넣지 않는다(tracing.excerpts).
    with tracing.observe('world_read', as_type='retriever', metadata={'provider': 'content_mcp', 'episode': episode}) as span:
        if (read := content_mcp.linked_world(work_id, episode)) is None:
            span.update(metadata={'gaps': ['NO_WORLD']})
            return [], [NO_WORLD]
        try:
            world = world_snapshot(read, episode)
        except ValueError:
            raise StoryQaFailure(502, BAD_WORLD) from None
        settings = [s for s in episode_settings(world, episode) if s['text'].strip()]
        if len(settings) > WORLD_EXCERPTS:
            by_ref = {s['ref']: s for s in settings}
            ranked = bm25_rank(question, [(s['ref'], f"{s['title']}\n{s['text']}") for s in settings])
            settings = [by_ref[ref] for ref, _ in ranked[:WORLD_EXCERPTS]]
        # shortcut: 긴 카드는 앞 QUOTE_LIMIT자만 보낸다. 긴 카드 뒷부분 누락이 보이면 문단 단위로 고른다.
        excerpts = [Excerpt(id=s['ref'], episode=episode, quote=s['text'][:QUOTE_LIMIT], title=s['title'][:256],
                            kind='relationship' if s['type'] == 'relation' else 'setting') for s in settings]
        span.update(output=tracing.excerpts(excerpts), metadata={'gaps': [] if excerpts else ['NO_SETTINGS']})
        return excerpts, [] if excerpts else [NO_SETTINGS]
