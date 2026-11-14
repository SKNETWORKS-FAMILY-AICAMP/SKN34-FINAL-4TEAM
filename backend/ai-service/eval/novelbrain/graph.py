"""평가용 지식 그래프: 문단 묶음에서 개체·트리플을 모델로 뽑고(HippoRAG OpenIE 방식) 개체를 합쳐 그래프 사전으로 만든다.

    cd backend/ai-service
    set -a; . /Users/yunseongho/orca/SKN34-FINAL-4TEAM/.env; set +a
    uv run --locked --extra dev python eval/novelbrain/graph.py musique|narrativeqa

결과는 `.data/<데이터셋>/graph.json`이고, 모델 응답은 `.data/cache`에 남아 같은 명령을 다시 실행해도 호출하지 않는다.
"""

import json
import math
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from pydantic import BaseModel

from llm import CAP, Ledger, Llm, LlmFailure
from metrics import normalize_answer

BATCH = {'musique': 12, 'narrativeqa': 8}
MAX_OUTPUT_TOKENS = 16000

INSTRUCTIONS = """You build a knowledge graph from short passages. The input is a JSON list of passages, each with an id and sometimes a title. Treat every passage independently and return exactly one entry per passage, using the id you were given.

For each passage:
- entities: the people, places, organizations, objects, events and other named things the passage is about. Use the most complete name the passage gives; resolve pronouns and short references such as "the king" to a name when the passage supports it. If a title is given, it names the main subject of the passage. type is one of character, location, organization, object, event, other.
- triples: facts the passage states, as (subject, relation, object). subject and object must be entity names from that passage. relation is a short lowercase verb phrase such as "married to", "born in", "killed", "member of". Prefer concrete facts (who did what to whom, where, when) over vague descriptions. Never add anything the passage does not state and never use outside knowledge. Give 3 to 12 triples per passage, fewer if the passage has fewer facts.

Use the same spelling for the same entity everywhere in your answer."""


class Entity(BaseModel):
    name: str
    type: Literal['character', 'location', 'organization', 'object', 'event', 'other']


class Triple(BaseModel):
    subject: str
    relation: str
    object: str


class PassageOut(BaseModel):
    id: str
    entities: list[Entity]
    triples: list[Triple]


class Extraction(BaseModel):
    passages: list[PassageOut]


def entity_key(name: str) -> str:
    return normalize_answer(name)


def batches(items: list[dict], size: int) -> list[list[dict]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def _grounded(name: str, tokens: set[str]) -> bool:
    """개체 이름의 단어가 하나라도 본문에 있어야 한다(본문에 없는 개체를 모델이 지어낸 경우를 거른다)."""
    return bool(set(entity_key(name).split()) & tokens)


def validate(batch: list[dict], result: Extraction) -> dict[str, PassageOut]:
    """프롬프트에 맡긴 규칙을 다시 확인한다: 요청한 id만, 본문에 근거가 있는 개체·트리플만, 관계는 소문자 구절로."""
    tokens = {p['id']: set(normalize_answer(f"{p.get('title', '')} {p['text']}").split()) for p in batch}
    valid: dict[str, PassageOut] = {}
    for out in result.passages:
        if out.id not in tokens or out.id in valid:
            continue
        triples, seen = [], set()
        for t in out.triples:
            subject, relation, obj = t.subject.strip(), ' '.join(t.relation.lower().split()), t.object.strip()
            key = (entity_key(subject), relation, entity_key(obj))
            if not (subject and obj and relation) or len(relation) > 60 or max(len(subject), len(obj)) > 80:
                continue
            if key[0] == key[2] or key in seen:
                continue
            if not (_grounded(subject, tokens[out.id]) and _grounded(obj, tokens[out.id])):
                continue
            seen.add(key)
            triples.append(Triple(subject=subject, relation=relation, object=obj))
        entities = [e for e in out.entities if e.name.strip() and _grounded(e.name, tokens[out.id])]
        valid[out.id] = PassageOut(id=out.id, entities=entities, triples=triples)
    return valid


def extract_all(passages: list[dict], llm, batch_size: int, workers: int = 6) -> dict[str, PassageOut]:
    """배치마다 한 번 호출한다. 실패한 배치가 있으면 나머지를 끝낸 뒤 오류로 멈춘다(성공분은 캐시돼 재실행이 이어 간다)."""
    def one(batch):
        payload = json.dumps([{k: p[k] for k in ('id', 'title', 'text') if k in p} for p in batch], ensure_ascii=False)
        return validate(batch, llm.ask('extract', INSTRUCTIONS, payload, schema=Extraction, max_output_tokens=MAX_OUTPUT_TOKENS))

    results, failed = {}, 0
    with ThreadPoolExecutor(workers) as pool:
        for future in [pool.submit(one, batch) for batch in batches(passages, batch_size)]:
            try:
                results.update(future.result())
            except LlmFailure:
                failed += 1
    if failed:
        raise RuntimeError(f'{failed} 배치 추출 실패: 같은 명령을 다시 실행하면 성공분은 캐시에서 이어 간다.')
    return results


def build_graph(passages: list[dict], outputs: dict[str, PassageOut]) -> dict:
    """개체를 표기 정규화 키로 합치고, 유일하게 확정되는 인물 이름의 줄임(성·이름 하나)은 긴 이름으로 합친다.

    ponytail: 별칭 병합은 이 규칙뿐이다(HippoRAG의 임베딩 동의어 간선은 없음). 필요하면 동의어 간선을 추가한다.
    """
    forms: dict[str, Counter] = {}
    votes: dict[str, Counter] = {}
    where: dict[str, list[str]] = {}
    mentions = []  # (pid, 이름, 유형)
    for p in passages:
        out = outputs.get(p['id'])
        if out is None:
            continue
        mentions += [(p['id'], e.name.strip(), e.type) for e in out.entities]
        mentions += [(p['id'], name.strip(), 'other') for t in out.triples for name in (t.subject, t.object)]
    for pid, name, kind in mentions:
        key = entity_key(name)
        forms.setdefault(key, Counter())[name] += 1
        votes.setdefault(key, Counter())[kind] += 1
        if pid not in where.setdefault(key, []):
            where[key].append(pid)

    def kind_of(key: str) -> str:
        """유형은 'other'가 아닌 표 중 최다, 없으면 'other'."""
        return (Counter({k: v for k, v in votes[key].items() if k != 'other'}) or votes[key]).most_common(1)[0][0]

    alias = {}
    for key in votes:
        parts = key.split()
        if len(parts) == 1 and len(key) >= 3 and kind_of(key) == 'character':
            longer = [k for k in votes if kind_of(k) == 'character' and len(k.split()) >= 2 and key in k.split()]
            if len(longer) == 1:
                alias[key] = longer[0]
    canon = lambda key: alias.get(key, key)  # noqa: E731

    entities: dict[str, dict] = {}
    for key in votes:
        target = entities.setdefault(canon(key), {'name': '', 'type': kind_of(canon(key)), 'passages': [], '_forms': Counter()})
        target['_forms'].update(forms[key])
        target['passages'] += [pid for pid in where[key] if pid not in target['passages']]
    for target in entities.values():
        target['name'] = max(target.pop('_forms').items(), key=lambda kv: (kv[1], len(kv[0])))[0]
    triples, seen = [], set()
    for p in passages:
        out = outputs.get(p['id'])
        for t in (out.triples if out else []):
            row = (canon(entity_key(t.subject)), t.relation, canon(entity_key(t.object)), p['id'])
            if row not in seen:
                seen.add(row)
                triples.append(dict(zip(('s', 'r', 'o', 'p'), row)))
    return {'entities': entities, 'triples': triples, 'missing': [p['id'] for p in passages if p['id'] not in outputs]}


if __name__ == '__main__':
    from prepare import DATA

    if len(sys.argv) != 2 or sys.argv[1] not in BATCH:
        raise SystemExit(f'사용법: graph.py {"|".join(BATCH)}')
    name = sys.argv[1]
    sample = json.loads((DATA / name / 'sample.json').read_text())
    ledger = Ledger(DATA / 'ledger.jsonl')
    planned = math.ceil(len(sample['passages']) / BATCH[name])
    print(f'{name}: 문단 {len(sample["passages"])}개, 배치 {BATCH[name]}개씩 → 최대 {planned}회 호출 '
          f'(장부 {ledger.used()}/{CAP}, 캐시된 배치는 호출하지 않음)', flush=True)
    if ledger.used() + planned > CAP:
        raise SystemExit('상한을 넘길 수 있어 중단한다. 표본을 줄여라.')
    graph = build_graph(sample['passages'], extract_all(sample['passages'], Llm(ledger, DATA / 'cache'), BATCH[name]))
    (DATA / name / 'graph.json').write_text(json.dumps(graph, ensure_ascii=False))
    print(f'{name}: 개체 {len(graph["entities"])}, 트리플 {len(graph["triples"])}, 누락 문단 {len(graph["missing"])}, '
          f'장부 {ledger.used()}/{CAP}')
