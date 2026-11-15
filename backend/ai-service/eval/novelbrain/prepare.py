"""평가 데이터 준비: 공개 원천을 `.data/`로 받고 표본을 고정한다. 원문·색인은 저장소에 두지 않는다(.gitignore).

    cd backend/ai-service
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/prepare.py musique|narrativeqa|timechara|e5

각 단계는 이미 받은 파일을 다시 받지 않는다. 원천의 개정·라이선스는 아래 상수와 docs/evaluation/novelbrain.md에 있다.
"""

import csv
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from metrics import normalize_answer

DATA = Path(__file__).resolve().parent / '.data'
SEED = 58
UA = {'User-Agent': 'research-fetch/1.0'}

MUSIQUE = ('https://huggingface.co/datasets/bdsaglam/musique/resolve/'
           '22873a405dd809893b22ada0b499299fb612d2df/musique_ans_v1.0_dev.jsonl')  # CC BY 4.0
NARRATIVEQA = 'https://raw.githubusercontent.com/google-deepmind/narrativeqa/904246f6d1fe99a99a08a03501fe3e619af2cee5/'  # Apache-2.0
TIMECHARA_HF = 'https://huggingface.co/datasets/ahnpersie/timechara/resolve/07b061f124b3c6820e9f2991a34bf538b6bebec6/valid.json'  # CC BY-NC 4.0, gated
TIMECHARA_GH = 'https://raw.githubusercontent.com/ahnjaewoo/timechara/c0032b88a869b163035c71cb602ef5e5bb8c00d0/'  # 코드 MIT
TIMECHARA_CHROMA = 'https://drive.usercontent.google.com/download?id=1ye55y2hE20tQES1Co1iI5Eq28xJ-WCFv&export=download&confirm=t'
E5_BASE = 'https://huggingface.co/intfloat/multilingual-e5-small/resolve/614241f622f53c4eeff9890bdc4f31cfecc418b3/onnx/'


# ---- 순수 로직(단위 테스트 대상) ----

def _sentences(paragraph: str) -> list[str]:
    return re.split(r'(?<=[.!?])\s+', paragraph)


def _split_long(paragraph: str, target: int, max_words: int) -> list[str]:
    """max_words를 넘는 문단을 문장 경계에서 target어 안팎으로 나눈다. 한 문장이 max_words를 넘으면 단어로 자른다."""
    pieces, current, count = [], [], 0
    for sentence in _sentences(paragraph):
        words = sentence.split()
        if len(words) > max_words:
            if current:
                pieces.append(' '.join(current))
                current, count = [], 0
            pieces += [' '.join(words[i:i + max_words]) for i in range(0, len(words), max_words)]
            continue
        if current and count + len(words) > target:
            pieces.append(' '.join(current))
            current, count = [], 0
        current.append(sentence)
        count += len(words)
    if current:
        pieces.append(' '.join(current))
    return pieces


def chunk_words(text: str, target: int = 200, max_words: int = 260) -> list[str]:
    """문단 경계를 지키며 target어쯤에서 끊는다. 모든 단어가 순서대로 한 번씩 남고 청크는 max_words를 넘지 않는다."""
    units = []
    for paragraph in re.split(r'\n\s*\n', text):
        paragraph = ' '.join(paragraph.split())
        if paragraph:
            units += [paragraph] if len(paragraph.split()) <= max_words else _split_long(paragraph, target, max_words)
    chunks, current, count = [], [], 0
    for unit in units:
        size = len(unit.split())
        if current and count + size > max_words:
            chunks.append('\n'.join(current))
            current, count = [], 0
        current.append(unit)
        count += size
        if count >= target:
            chunks.append('\n'.join(current))
            current, count = [], 0
    if current:
        chunks.append('\n'.join(current))
    return chunks


def clean_gutenberg(raw: str, start_marker: str, end_marker: str) -> str:
    """구텐베르크 머리말·꼬리말을 뗀다. 지금 파일의 *** START/END *** 표식을 먼저 보고,
    없으면 NarrativeQA documents.csv(2015년판)의 story_start/story_end를 쓴다."""
    modern_start = re.search(r'\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*', raw)
    modern_end = re.search(r'\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK', raw)
    if modern_start and modern_end and modern_end.start() > modern_start.end():
        return raw[modern_start.end():modern_end.start()].strip()
    start, end = raw.find(start_marker), raw.rfind(end_marker)
    if start < 0 or end < 0 or end <= start:
        raise ValueError('구텐베르크 시작·끝 표식을 찾을 수 없다.')
    return raw[raw.find('\n', start) + 1:raw.rfind('\n', 0, end)].strip()


def gold_chunks(chunks: dict[str, str], answers: list[str], max_hits: int = 10, min_chars: int = 4) -> set[str] | None:
    """NarrativeQA는 정답 근거가 없어 '정규화한 답이 토큰 경계에서 그대로 들어 있는 청크'를 근거로 추정한다.

    일치가 없거나(추상적 답) max_hits를 넘거나(너무 흔함) 답이 너무 짧으면 None: 지표에서 뺀다.
    """
    needles = [f' {normalize_answer(a)} ' for a in answers if len(normalize_answer(a)) >= min_chars]
    if not needles:
        return None
    found = {cid for cid, text in chunks.items()
             if any(needle in f' {normalize_answer(text)} ' for needle in needles)}
    return found if 0 < len(found) <= max_hits else None


def stratified_sample(rows: list[dict], key, n: int, seed: int) -> list[dict]:
    """층 크기에 비례해 n개를 결정적으로 뽑는다(최대 잔여법). 같은 seed면 같은 표본."""
    strata: dict = {}
    for row in sorted(rows, key=lambda r: r['id']):
        strata.setdefault(key(row), []).append(row)
    quota = {s: n * len(v) / len(rows) for s, v in strata.items()}
    counts = {s: int(q) for s, q in quota.items()}
    for s in sorted(strata, key=lambda s: (-(quota[s] - counts[s]), str(s)))[:n - sum(counts.values())]:
        counts[s] += 1
    picked = []
    for s in sorted(strata, key=str):
        picked += random.Random(f'{seed}-{s}').sample(strata[s], counts[s])
    return picked


# ---- 내려받기·표본 고정 ----

def fetch(url: str, dest: Path, token: str | None = None) -> Path:
    if dest.exists() and dest.stat().st_size:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    headers = dict(UA, **({'Authorization': f'Bearer {token}'} if token else {}))
    tmp = dest.with_suffix(dest.suffix + '.part')
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=600) as response, tmp.open('wb') as out:
        while block := response.read(1 << 20):
            out.write(block)
    tmp.rename(dest)
    return dest


def hf_token() -> str:
    """캐시 토큰을 우선한다(셸에 남은 오래된 HF_TOKEN이 가리지 않게). 값은 출력하지 않는다."""
    path = Path.home() / '.cache/huggingface/token'
    return path.read_text().strip() if path.exists() else os.environ['HF_TOKEN']


def pid_for(title: str, text: str) -> str:
    return 'm' + hashlib.sha1(f'{title}\n{text}'.encode()).hexdigest()[:12]


def prepare_musique(n: int = 100) -> None:
    """공개 dev(answerable) 중 홉 수에 비례해 n문항. 말뭉치는 그 문항들의 문단을 합친 풀(HippoRAG 방식)이다."""
    path = fetch(MUSIQUE, DATA / 'musique/musique_ans_v1.0_dev.jsonl')
    rows = [json.loads(line) for line in path.open(encoding='utf-8')]
    picked = stratified_sample(rows, key=lambda r: int(r['id'][0]), n=n, seed=SEED)
    passages, questions = {}, []
    for row in picked:
        gold = []
        for paragraph in row['paragraphs']:
            pid = pid_for(paragraph['title'], paragraph['paragraph_text'])
            passages[pid] = {'id': pid, 'title': paragraph['title'], 'text': paragraph['paragraph_text']}
            if paragraph['is_supporting']:
                gold.append(pid)
        questions.append({'id': row['id'], 'question': row['question'], 'answer': row['answer'],
                          'aliases': row['answer_aliases'], 'hops': int(row['id'][0]), 'gold': gold})
    out = {'dataset': 'musique', 'seed': SEED, 'passages': list(passages.values()), 'questions': questions}
    (DATA / 'musique/sample.json').write_text(json.dumps(out, ensure_ascii=False))
    print(f'musique: {len(questions)} questions, {len(passages)} unique passages')


def prepare_narrativeqa(n: int = 100, max_chunks: int = 800, min_words: int = 12000, max_story_words: int = 40000) -> None:
    """test 구텐베르크 작품 중 추출 비용 대비 '정답이 본문에 그대로 있는' 질문이 많은 작품부터 골라 n문항을 만든다."""
    base = DATA / 'narrativeqa'
    for name in ('documents.csv', 'qaps.csv'):
        fetch(NARRATIVEQA + name, base / name)
    docs = [r for r in csv.DictReader((base / 'documents.csv').open(newline='', encoding='utf-8'))
            if r['set'] == 'test' and r['kind'] == 'gutenberg' and min_words <= int(r['story_word_count']) <= max_story_words]
    qas: dict[str, list[dict]] = {}
    for row in csv.DictReader((base / 'qaps.csv').open(newline='', encoding='utf-8')):
        qas.setdefault(row['document_id'], []).append(row)
    candidates = []
    for doc in sorted(docs, key=lambda r: r['document_id']):
        try:
            raw = fetch(doc['story_url'], base / 'stories' / f"{doc['document_id']}.txt").read_text(encoding='utf-8', errors='replace')
            chunks = chunk_words(clean_gutenberg(raw, doc['story_start'], doc['story_end']))
        except (ValueError, OSError, urllib.error.URLError):
            print('skip', doc['wiki_title'])
            continue
        time.sleep(1)
        by_id = {f"n{doc['document_id'][:8]}_{i:04d}": text for i, text in enumerate(chunks)}
        eligible = []
        for qa in qas.get(doc['document_id'], []):
            gold = gold_chunks(by_id, [qa['answer1'], qa['answer2']])
            if gold:
                eligible.append({'id': f"{doc['document_id'][:8]}:{len(eligible)}", 'story': doc['document_id'][:8],
                                 'question': qa['question'], 'answers': [qa['answer1'], qa['answer2']], 'gold': sorted(gold)})
        candidates.append({'doc': doc, 'chunks': by_id, 'eligible': eligible})
    candidates.sort(key=lambda c: (-len(c['eligible']) / max(len(c['chunks']), 1), c['doc']['document_id']))
    stories, total_chunks, total_eligible = [], 0, 0
    for cand in candidates:
        if total_eligible >= n or total_chunks + len(cand['chunks']) > max_chunks:
            continue
        stories.append(cand)
        total_chunks += len(cand['chunks'])
        total_eligible += len(cand['eligible'])
    pool = sorted((q for s in stories for q in s['eligible']), key=lambda q: q['id'])
    questions = random.Random(SEED).sample(pool, min(n, len(pool)))
    out = {'dataset': 'narrativeqa', 'seed': SEED,
           'stories': [{'id': s['doc']['document_id'][:8], 'title': s['doc']['wiki_title'],
                        'words': int(s['doc']['story_word_count']), 'chunks': len(s['chunks'])} for s in stories],
           'passages': [{'id': pid, 'story': s['doc']['document_id'][:8], 'text': text}
                        for s in stories for pid, text in s['chunks'].items()],
           'questions': questions, 'eligible_pool': len(pool)}
    (base / 'sample.json').write_text(json.dumps(out, ensure_ascii=False))
    print(f"narrativeqa: {len(questions)} questions from {len(stories)} stories, {total_chunks} chunks (pool {len(pool)})")


def prepare_timechara() -> None:
    """검증 600건(gated: HF 약관 동의·로그인 필요, 비상업 연구 한정), 공개 채점 프롬프트·성격 설명, rag-cutoff Chroma."""
    base = DATA / 'timechara'
    fetch(TIMECHARA_HF, base / 'valid.json', token=hf_token())
    for name in ('utils.py', 'data/spatiotemporal_consistency_evaluation_prompt.txt',
                 'data/personality_consistency_evaluation_prompt.txt'):
        fetch(TIMECHARA_GH + name, base / name)
    for character in ('hermione_granger', 'ronald_weasley', 'harry_potter', 'frodo_baggins', 'gandalf', 'aragorn',
                      'samwise_gamgee', 'legolas', 'bella_swan', 'edward_cullen', 'jacob_black', 'katniss_everdeen',
                      'peeta_mellark', 'gale_hawthorne'):
        fetch(f'{TIMECHARA_GH}data/personality/{character}_personality.txt', base / f'data/personality/{character}_personality.txt')
    archive = fetch(TIMECHARA_CHROMA, DATA / 'timechara-chroma-zip/chroma_db_files.zip')
    target = DATA / 'timechara-chroma'
    if not target.exists():
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(target)  # zipfile은 절대경로·.. 구성요소를 제거한다
    print('timechara: valid.json, prompts, personalities, chroma ready')


def prepare_e5() -> None:
    """운영과 같은 고정 리비전·SHA-256의 E5-small ONNX를 받는다(.env에 MANUSCRIPT_EMBEDDING_MODEL_DIR가 없어서)."""
    from app.manuscript.service import FILES

    for name, digest in FILES.items():
        path = fetch(E5_BASE + name, DATA / 'e5-small' / name)
        with path.open('rb') as artifact:
            if hashlib.file_digest(artifact, 'sha256').hexdigest() != digest:
                raise SystemExit(f'{name} 해시가 고정값과 다르다.')
    print('e5: ready')


if __name__ == '__main__':
    steps = {'musique': prepare_musique, 'narrativeqa': prepare_narrativeqa, 'timechara': prepare_timechara, 'e5': prepare_e5}
    if len(sys.argv) != 2 or sys.argv[1] not in steps:
        raise SystemExit(f'사용법: prepare.py {"|".join(steps)}')
    steps[sys.argv[1]]()
