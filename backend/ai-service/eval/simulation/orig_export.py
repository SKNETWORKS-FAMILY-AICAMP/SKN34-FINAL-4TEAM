"""운영 LLMOps 등록 형식 내보내기(평가 전용): 공개 세트의 ① 대사와 ③ 나레이션·독백 중 저작권 만료·자유 이용 문항을 지시문별 평가 세트 jsonl(simulation.act·simulation.narrate)로 쓴다.

app/evaluation/datasets/ 바로 아래에 두면 seed.load()가 Langfuse Dataset으로 등록하고 운영 회귀 평가가 읽는다. 항목은 id·input(서비스가 그 호출에 보내는 값 그대로)·expectedOutput(원작의 다음 글)·
metadata(license·source·judge)다. metadata.judge가 원문 평가와 같은 채점 입력이다: 인물·직전 장면(모델 입력의 장면은 줄여 있어 채점용 전체 장면을 따로 둔다)·시점 위반 정답표(그 인물이 아직 모르는 사실).
고전·근대 소설(저작권 만료)과 SCP(CC BY-SA 3.0)는 한 파일에 섞이고 항목마다 metadata.source·license에 출처와 라이선스가 있다.

--pool(자동 개선 #823): 게이트 세트가 고르지 않은 나머지 문항을 app/evaluation/datasets/optimize/(seed가 Dataset optimize.<세트>로 등록하는 하위 폴더, #868)에 train·val로 내보낸다.
게이트 세트는 그대로 두고(바꾸면 기준 Run을 다시 만든다) 풀과 한 문항도 겹치지 않아, 게이트 세트가 최적화가 한 번도 보지 못한 검증 세트가 된다.
"""

from orig_common import SEED  # noqa: F401,I001

SETS = {'simulation.act': ('1',), 'simulation.narrate': ('3n', '3m')}   # 평가 세트 이름 → 원문 평가 세트 키: 지시문 character_simulation.act·narrate마다 하나(대사 / 나레이션·독백)


def split_by_license(items: list[dict]) -> tuple[list[dict], list[dict]]:
    """(저작권 만료 고전·근대 소설 문항, SCP 문항)."""
    return [i for i in items if i['source']['kind'] != 'scp'], [i for i in items if i['source']['kind'] == 'scp']


def record(item: dict, record_id: str, model_input: dict, facts: list[dict]) -> dict:
    """평가 세트 한 줄. metadata.source에 작품·저자·출처 URL·라이선스·회차를 남기고 metadata.license에도 라이선스를 적는다. metadata.judge는 채점 입력(character·scene·facts)이다."""
    source = item['source']
    return {'id': record_id, 'input': model_input, 'expectedOutput': item['gold'],
            'metadata': {'license': source['license'],
                         'source': {'work': source['title'], 'author': source['author'], 'origin': source['source'], 'license': source['license'], 'episode': item['n']},
                         'judge': {'character': item['speaker'], 'scene': [{'by': line['by'], 'text': line['text']} for line in item['context']],
                                   'facts': [{'id': fact['id'], 'text': fact['text']} for fact in facts]}}}


def dataset_rows(name: str, picked: list[tuple[dict, dict, list[dict]]]) -> list[dict]:
    """평가 세트 한 파일의 줄: (문항, 모델 입력, 정답표)를 순서대로 id <이름>-01부터 붙인다."""
    return [record(item, f'{name}-{n:02d}', model_input, facts) for n, (item, model_input, facts) in enumerate(picked, 1)]


VAL = 20   # 자동 개선 풀의 val 문항 수 상한: 기본 호출 상한 150에서 기준 본문의 val 평가가 호출의 큰 몫을 쓰지 않게 작게 둔다
VAL_SHARE = 0.4   # 풀이 작으면 val은 풀의 이 비율까지만(나머지는 train)


def leftover(free: list[dict], scp: list[dict], per_set: int) -> list[dict]:
    """게이트 세트(pick)가 고르지 않은 나머지 문항: 저작권 만료 문항 먼저, SCP 다음(원래 순서). 자동 개선 풀이 된다."""
    gate = {item['id'] for item in [*pick(free, per_set), *pick(scp, per_set)]}
    return [item for item in [*free, *scp] if item['id'] not in gate]


def pool_rows(name: str, picked: list[tuple[dict, dict, list[dict]]]) -> list[dict]:
    """자동 개선 풀 한 파일의 줄: 게이트 세트와 같은 모양에 metadata.split(train·val)을 더하고 id는 <이름>.opt-001부터다.
    val은 풀 전체에서 같은 간격으로 min(VAL, 풀의 VAL_SHARE)개를 뽑아 라이선스·종류 묶음이 풀에 있는 비율대로 섞인다."""
    size = min(VAL, round(len(picked) * VAL_SHARE))
    val = {n * len(picked) // size for n in range(size)} if size else set()
    rows = []
    for n, (item, model_input, facts) in enumerate(picked):
        row = record(item, f'{name}.opt-{n + 1:03d}', model_input, facts)
        row['metadata']['split'] = 'val' if n in val else 'train'
        rows.append(row)
    return rows


def pick(items: list[dict], n: int) -> list[dict]:
    """같은 간격으로 n개(모자라면 전부, 한 번씩)."""
    n = min(n, len(items))
    return [items[i * len(items) // n] for i in range(n)]
