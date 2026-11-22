"""운영 LLMOps 등록 형식 내보내기(평가 전용, app/evaluation 실행 경로는 바꾸지 않는다): 공개 세트 ①~④ 중 저작권 만료·자유 이용 문항을
기존 평가 세트 jsonl 형식(id·input·expectedOutput·metadata.source·metadata.criteria)으로 쓴다. 고전·근대 소설(저작권 만료)과 SCP(CC BY-SA 3.0)는 파일을 나눈다.

app/evaluation/datasets/ 바로 아래의 *.jsonl은 seed.load()가 전부 읽고 기존 시험이 정확히 네 세트를 기대하므로, 이 파일들은 하위 폴더 simulation/에 둔다(다음 작업이 옮기거나 연결한다).
"""

from orig_common import SEED  # noqa: F401,I001

CRITERIA = {
    '1': '응답의 대사(큰따옴표 안)가 정답(원작에서 그 인물이 실제로 한 다음 대사)과 말투(어휘·어미·호칭·말의 길이)와 의도(말하려는 방향)가 같으면 높은 점수를 준다. '
         '인물이 입력의 known·scene에 없는 사실(미래 사건·다른 인물만 아는 비밀)을 말하거나 아는 듯 행동하면 낮은 점수를 준다.',
    '2': '응답이 정답과 같은 턴 종류(대사·나레이션·독백)를 고르고, 대사·독백이면 같은 인물을 고르면 높은 점수를 준다. 종류나 인물이 다르면 낮은 점수를 준다.',
    '3n': '응답의 지문이 정답(원작의 다음 지문 한 문단)과 문체(시점·시제·문장 호흡·묘사 방식)와 정보(장면·사건)가 같으면 높은 점수를 주고, 입력에 없는 사건을 지어내거나 기준 회차 뒤의 사실을 쓰면 낮은 점수를 준다.',
    '3m': '응답의 독백이 정답(원작의 독백 한 문단)과 문체(인물의 말투와 생각의 결)와 정보가 같으면 높은 점수를 주고, 그 인물이 알 수 없는 사실을 쓰면 낮은 점수를 준다.',
    '4': '응답이 정답(통과 또는 거절)과 같으면 높은 점수를 준다. 문단이 인물이 아직 알 수 없는 사실을 말하면 거절이고 원작 그대로의 대사는 통과다.',
}


def split_by_license(items: list[dict]) -> tuple[list[dict], list[dict]]:
    """(저작권 만료 고전·근대 소설 문항, SCP 문항)."""
    return [i for i in items if i['source']['kind'] != 'scp'], [i for i in items if i['source']['kind'] == 'scp']


def expected_output(key: str, item: dict) -> str:
    """①·③: 정답 줄, ②: 「종류: 화자」(나레이션은 종류만), ④: 통과·거절."""
    if key == '2':
        return item['kind'] if item['kind'] == 'narration' else f"{item['kind']}: {item['speaker']}"
    if key == '4':
        return '통과' if item['label'] == 'pass' else '거절'
    return item['gold']


def record(key: str, item: dict, record_id: str, model_input: dict) -> dict:
    """평가 세트 한 줄. metadata.source에 작품·저자·출처 URL·라이선스·회차를 남기고 metadata.license에도 라이선스를 적는다."""
    source = item['source']
    return {'id': record_id, 'input': model_input, 'expectedOutput': expected_output(key, item),
            'metadata': {'criteria': CRITERIA[key], 'license': source['license'],
                         'source': {'work': source['title'], 'author': source['author'], 'origin': source['source'], 'license': source['license'], 'episode': item['n']}}}


def pick(items: list[dict], n: int) -> list[dict]:
    """같은 간격으로 n개(모자라면 전부)."""
    return [items[i * len(items) // n] for i in range(min(n, len(items)))]
