"""채점기 어댑터: Ragas(Q&A RAG)와 DeepEval GEval을 부르고 0~1 점수를 돌려준다. 라이브러리는 평가할 때만 import한다(--extra eval).

채점 입력(질문·응답·참조)은 오류·로그에 넣지 않는다. 라이브러리 예외는 입력을 담을 수 있어 고정 문구 실패로 바꾸고 예외 이름만 남긴다.
채점 모델은 EVALUATION_JUDGE_MODEL이고 비어 있으면 업무 Agent와 같은 OPENAI_MODEL이다(키는 OPENAI_API_KEY). Ragas·GEval·시뮬레이션 루브릭 채점이 모두 같은 설정이다.
"""

import json
import logging
import os

from openai import AsyncOpenAI
from pydantic import BaseModel

from app.evaluation.errors import EvaluationFailure
from app.evaluation.rubric import parse_grade

# 평가 라이브러리의 익명 사용 통계를 끄고 디스크 쓰기를 막는다(컨테이너는 읽기 전용이고 채점 입력이 밖으로 나가면 안 된다).
for _name, _value in (('DEEPEVAL_TELEMETRY_OPT_OUT', '1'), ('DEEPEVAL_FILE_SYSTEM', 'READ_ONLY'), ('RAGAS_DO_NOT_TRACK', 'true')):
    os.environ.setdefault(_name, _value)

logger = logging.getLogger(__name__)
SCORING_FAILED = '평가 채점에 실패했습니다.'
NOT_INSTALLED = '평가 라이브러리(ragas·deepeval, --extra eval)가 설치되어 있지 않습니다.'
TIMEOUT = 120  # 채점 모델 호출 한 번의 제한 시간(초)


def require_model() -> tuple[str, str]:
    """채점 모델 설정(API 키, 모델). 모델은 EVALUATION_JUDGE_MODEL이고 비면 OPENAI_MODEL이다. 없으면 503."""
    key, model = os.environ.get('OPENAI_API_KEY'), os.environ.get('EVALUATION_JUDGE_MODEL', '').strip() or os.environ.get('OPENAI_MODEL')
    if not key or not model:
        raise EvaluationFailure(503, '평가 모델 설정이 필요합니다.')
    return key, model


def _score(value) -> float:
    if not isinstance(value, (int, float)) or not 0 <= value <= 1:  # NaN도 걸린다. 어긋난 점수는 보정하지 않고 실패로 둔다
        raise EvaluationFailure(502, SCORING_FAILED)
    return float(value)


async def ragas_scores(question: str, contexts: list[str], answer: str) -> dict[str, float]:
    """Ragas faithfulness(응답이 문맥에 근거하는 정도)와 context precision(문맥이 이 응답에 쓸모 있었는지)의 0~1 점수."""
    key, model = require_model()
    try:
        from openai import AsyncOpenAI
        from ragas.llms import llm_factory
        from ragas.metrics.collections import ContextPrecisionWithoutReference, Faithfulness

        llm = llm_factory(model, client=AsyncOpenAI(api_key=key, timeout=TIMEOUT, max_retries=0), max_tokens=4096)
        arguments = {'user_input': question, 'response': answer, 'retrieved_contexts': contexts}
        faithfulness = await Faithfulness(llm=llm).ascore(**arguments)
        precision = await ContextPrecisionWithoutReference(llm=llm).ascore(**arguments)
    except ImportError:
        raise EvaluationFailure(503, NOT_INSTALLED) from None
    except Exception as error:  # 외부 라이브러리 경계: 예외 메시지에 입력이 실릴 수 있어 이름만 남긴다
        logger.warning('Ragas 채점 실패: %s', type(error).__name__)
        raise EvaluationFailure(502, SCORING_FAILED) from None
    return {'faithfulness': _score(faithfulness.value), 'context_precision': _score(precision.value)}


async def geval(criteria: str, input_text: str, output: str, expected: str | None = None) -> tuple[float, str]:
    """DeepEval GEval 한 번: 응답(output)이 criteria를 만족하는 정도의 0~1 점수와 채점 이유. expected가 있으면 함께 비교한다."""
    key, model = require_model()
    try:
        from deepeval.metrics import GEval
        from deepeval.models import OpenAIModel
        from deepeval.test_case import LLMTestCase, SingleTurnParams

        params = [SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT] + ([SingleTurnParams.EXPECTED_OUTPUT] if expected else [])
        # 모델 이름이 DeepEval의 알려진 목록에 없어도 되도록 단가는 0으로 준다.
        judge = OpenAIModel(model=model, api_key=key, cost_per_input_token=0.0, cost_per_output_token=0.0)
        metric = GEval(name='geval', criteria=criteria, evaluation_params=params, model=judge, async_mode=True, verbose_mode=False)
        await metric.a_measure(LLMTestCase(input=input_text, actual_output=output, expected_output=expected), _show_indicator=False)
    except ImportError:
        raise EvaluationFailure(503, NOT_INSTALLED) from None
    except Exception as error:  # 외부 라이브러리 경계: 예외 메시지에 입력이 실릴 수 있어 이름만 남긴다
        logger.warning('GEval 채점 실패: %s', type(error).__name__)
        raise EvaluationFailure(502, SCORING_FAILED) from None
    return _score(metric.score), metric.reason or ''


async def rubric_grade(instructions: str, payload: dict, schema: type[BaseModel]) -> dict:
    """시뮬레이션 루브릭 채점 한 번(원문 평가의 judge와 같은 호출: Responses API 구조화 출력, 자동 재시도 없음). 점수(1~5)와 시점 위반 id 목록 dict를 돌려준다.
    호출 실패·불완전·잘린 JSON·범위 밖 점수·정답표에 없는 id는 고치지 않고 채점 실패(502)다."""
    key, model = require_model()
    try:
        async with AsyncOpenAI(api_key=key, timeout=TIMEOUT, max_retries=0) as client:   # 항목마다 새 클라이언트라 호출 뒤 닫는다
            response = await client.responses.parse(
                model=model, store=False, max_output_tokens=1500, instructions=instructions, input=json.dumps(payload, ensure_ascii=False), text_format=schema)
        out = response.output_parsed if response.status == 'completed' else None
    except Exception as error:  # 외부 SDK 경계: 예외 메시지에 입력이 실릴 수 있어 이름만 남긴다
        logger.warning('루브릭 채점 실패: %s', type(error).__name__)
        raise EvaluationFailure(502, SCORING_FAILED) from None
    grade = parse_grade(out, [fact['id'] for fact in payload['facts']]) if out is not None else None
    if grade is None:
        raise EvaluationFailure(502, SCORING_FAILED)
    return grade
