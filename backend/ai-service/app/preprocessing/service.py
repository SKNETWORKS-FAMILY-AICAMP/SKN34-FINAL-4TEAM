"""회차 원고 전처리 로직 — **후속 작업자가 채울 자리**(#344, docs/design/manuscript-preprocessing-contract.md "처리 흐름").

그래프(`graph.py`)가 아래 세 함수를 순서대로 부른다. Celery·접수 API·Content 호출·진행 갱신·실패 처리는 이미 있으므로
여기서는 원문 → 적재 payload 변환만 구현한다. 작성 방법:

- 모델 호출은 `agent.py`를 새로 만들어 LangChain `ChatOpenAI(model=OPENAI_MODEL, max_retries=0)`
  `.with_structured_output(<Pydantic>, method='json_schema', strict=True)`로 한다. 지시문은 `prompt.py`, 응답 DTO는 `models.py`.
  원고는 지시가 아니라 데이터로만 보낸다(`HumanMessage(payload.model_dump_json())`).
- 모델이 낸 인용·참조·병합은 여기서 다시 검증하고, 어긋나면 보정하지 말고 `PreprocessingFailure('<고정 코드>')`를 올린다.
  예외 메시지·로그에 원고·모델 응답을 넣지 않는다. 재시도·fallback을 두지 않는다.
- 테스트는 `tests/preprocessing/`에서 모델을 monkeypatch 대역으로 바꿔 단위로만 돌린다(실제 OpenAI 호출 금지).
"""
from app.preprocessing.models import EpisodeText, LoadPayload


def extract(episode: EpisodeText) -> object:
    """1단계 회차별 추출(회차마다 병렬로 불린다). 그 회차의 사건·묘사·호칭(회차 안에서만 쓰는 임시 ID)·원문 인용을 돌려준다.

    인용이 원문에 정확히 한 번 있는지 확인하고, 아니면 예외를 올린다(그래프가 그 회차를 실패로 모은다).
    반환 값은 그래프 state에 회차 번호별로 쌓여 `resolve`·`organize`에 그대로 넘어간다.
    """
    raise NotImplementedError('#344 후속: 회차별 추출')


def resolve(extractions: dict[int, object]) -> object:
    """2단계 정체 정리(작품당 1회). 호칭을 같은 대상끼리 묶어 정식 key를 준다.

    동명이인은 분리하고 별칭은 병합하되 같은 이름만으로 병합하지 않는다. 정체가 나중에 밝혀지면 몇 화부터 같은 대상인지 기록한다.
    """
    raise NotImplementedError('#344 후속: 정체 정리')


def organize(identities: object, extractions: dict[int, object]) -> LoadPayload:
    """3~5단계 사건·인물·설정 정리. 1·2단계 결과만 읽어 계약의 `cards[]`·`relations[]`(models.LoadPayload)를 만든다.

    인물 카드는 DEC-47 문서(본문=IDENTITY, characterDocs의 SOUL·MEMORY·memory/NN회차, 각 3,000자 이하),
    `revealFromEpisode`=첫 등장 회차, 관계는 `fromEpisode` 시점별(DEC-51). N화 상태에 N화 이후 정보를 넣지 않는다.
    """
    raise NotImplementedError('#344 후속: 사건·인물·설정 정리')
