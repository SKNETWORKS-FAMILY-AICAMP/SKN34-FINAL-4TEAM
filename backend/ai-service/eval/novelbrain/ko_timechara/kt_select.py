"""KoTimeChara 작품 고르기: 수집 소설 폴더를 읽기만 해서 후보를 거르고(호출 0회) 장르가 다양한 완결작과 저작권이 끝난 고전을 고른다.

원문은 `.data/ko_timechara/`에만 쓴다(git 무시). 원본 폴더는 수정·이동·삭제하지 않는다.

    cd backend/ai-service
    uv run --locked --extra dev python eval/novelbrain/ko_timechara/kt_select.py scan <소설 폴더>   # 후보 선별 → candidates.json(집계만 문서에 쓴다)
    uv run --locked --extra dev python eval/novelbrain/ko_timechara/kt_select.py prepare [--works=N]   # 장르별로 N편(기본 12)을 고르고 앞쪽 25화·고전 회차를 works/에 저장
    uv run --locked --extra dev python eval/novelbrain/ko_timechara/kt_select.py add [--works=20] [--prefix=n] [--seed=N]   # 이미 쓴 작품과 겹치지 않는 새 웹소설을 works/<접두어>NN/에 더한다(기존 작품·candidates.json은 안 바꾼다, 호출 0)
"""

import hashlib
import json
import re
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

from kt_common import KT, ROUNDS, SEED
from kt_text import clean_wikitext, decode_bytes, epub_text, group_paragraphs, modernize_hangul, split_episodes

HEAD_BYTES = 1_500_000      # 후보 선별은 앞부분만 읽는다(앞쪽 25화면 충분하다)
EPISODES = 25               # 웹소설은 작품마다 앞쪽 25화
MIN_MEDIAN, MIN_EPISODE = 2500, 800
MAX_MEDIAN = 12_000         # 회차 글자 중앙값이 이보다 큰 작품은 뺀다(추출 출력 한도·비용이 다른 회차 구성이라 한 작품만 튄다)
# 장르별 기본 선정 수(합 12 = 처음 평가한 구성비). 장르는 제목·앞부분의 낱말로 추정한다.
QUOTA = {'현대판타지': 3, '판타지': 2, '무협': 2, '대체역사': 2, '로맨스판타지': 2, '현대로맨스': 1}
GENRE_WORDS = {
    '무협': ('무림', '강호', '문파', '내공', '무공', '사부', '장문인', '마교', '혈교', '검객', '협객', '천하제일', '비급'),
    '대체역사': ('조선', '고려', '임진왜란', '대한제국', '이순신', '삼국지', '왕세자', '사극', '왜구', '광해', '세종', '정조', '병자호란', '독립군', '일제'),
    '로맨스판타지': ('영애', '황후', '후작', '악녀', '빙의', '남주', '여주', '황태자', '폐하', '공녀', '아가씨', '대공', '백작', '시녀', '공작'),
    '현대판타지': ('헌터', '던전', '게이트', '각성', '스킬', '랭커', '길드', '능력자', '아카데미', '레벨', '시스템'),
    '판타지': ('마법', '용사', '마왕', '왕국', '기사단', '엘프', '마탑', '드래곤', '마나', '영주', '검사', '제국'),
    '현대로맨스': ('대표님', '회장님', '재벌', '계약연애', '연애', '결혼', '이혼', '남편', '약혼', '비서', '상무'),
}
# 저작권이 끝난 고전소설: (한국어 위키문헌 문서 제목, 회차 수, 글자 상한). 같은 작품의 다른 판본은 하나만 쓴다.
CLASSICS = (('구운몽', 12, 80_000), ('일설 춘향전', 14, 100_000), ('심청전', 10, 60_000), ('박씨전', 10, 50_000),
            ('홍길동전 (36장 완판본)', 10, 40_000))
WIKISOURCE = 'https://ko.wikisource.org/w/api.php?'


def classify_genre(title: str, head: str) -> str:
    """제목의 장르 낱말(낱말당 20점)과 앞부분의 장르 낱말 밀도(1만 자당)로 장르를 추정한다. 근거가 없으면 '기타'."""
    best, top = '기타', 3.0
    for genre, words in GENRE_WORDS.items():
        score = 20 * sum(w in title for w in words) + sum(head.count(w) for w in words) * 10_000 / max(len(head), 1)
        if score > top:
            best, top = genre, score
    return best


def screen(name: str, text: str) -> tuple[dict | None, str]:
    """후보 하나를 거른다: (통계 행 또는 None, 이유). 미완결·회차 나누기 실패·너무 짧은 회차는 버린다."""
    if '미완' in name:
        return None, 'unfinished'
    try:
        pattern, episodes = split_episodes(text, min_episodes=EPISODES)
    except ValueError:
        return None, 'no_chain'
    lengths = [len(e['text']) for e in episodes[:EPISODES]]
    if statistics.median(lengths) < MIN_MEDIAN or min(lengths[:-1] or lengths) < MIN_EPISODE:
        return None, 'short_episodes'
    return {'pattern': pattern, 'chain': len(episodes), 'median_chars': int(statistics.median(lengths)),
            'genre': classify_genre(name, text[:60_000]), 'completed': '완' in name}, 'ok'


def _order(row: dict, seed: int) -> str:
    return hashlib.sha1(f'{seed}:{row["file"]}'.encode()).hexdigest()


def quota_for(works: int) -> dict[str, int]:
    """기본 구성비(QUOTA)를 지키며 works편(12 이상)으로 늘린 장르별 정원(최대 잉여법, 나머지가 같으면 QUOTA 순서). 늘려도 장르마다 해시 순서 앞쪽의 작품은 그대로 남는다."""
    total = sum(QUOTA.values())
    out = {genre: count * works // total for genre, count in QUOTA.items()}
    for genre in sorted(QUOTA, key=lambda g: -(QUOTA[g] * works % total))[:works - sum(out.values())]:
        out[genre] += 1
    return out


def choose(rows: list[dict], seed: int, quota: dict[str, int] = QUOTA) -> list[dict]:
    """장르별 정원만큼 고른다(고정 시드의 해시 순서). 장르가 모자라면 남은 후보에서 채워 총수를 지킨다."""
    picked = []
    for genre, count in quota.items():
        picked += sorted((r for r in rows if r['genre'] == genre), key=lambda r: _order(r, seed))[:count]
    short = sum(quota.values()) - len(picked)
    if short > 0:
        left = sorted((r for r in rows if r not in picked and r['genre'] != '기타'), key=lambda r: _order(r, seed))
        picked += left[:short]
    return picked


def prepare_classic(raw: str, count: int, cap_chars: int) -> list[dict]:
    """위키문헌 위키텍스트 → 틀·링크 제거 → 아래아 현대화 → 글자 상한(줄 경계) → 문단 순서를 지킨 count개 회차."""
    text = modernize_hangul(clean_wikitext(raw))
    if len(text) > cap_chars:
        text = text[:cap_chars].rsplit('\n', 1)[0]
    return group_paragraphs(text, count)


# ---- 파일 읽기·실행(실제 폴더가 필요해 단위 테스트하지 않는다) ----

def read_head(path: Path, limit: int = HEAD_BYTES) -> str | None:
    """txt(앞 limit바이트)·epub(zipfile+태그 제거)만 읽는다. zip·7z·rar·스캔본·만화 등은 None."""
    kind = path.suffix.lower()
    try:
        if kind == '.epub':
            return epub_text(path)[:limit]
        if kind != '.txt':
            return None
        with path.open('rb') as file:
            raw = file.read(limit)
    except (OSError, zipfile.BadZipFile, ValueError, KeyError):
        return None
    for cut in range(4):   # 읽다가 잘린 끝 글자는 버리고 엄격하게 해석한다
        try:
            return decode_bytes(raw[:len(raw) - cut])
        except ValueError:
            continue
    return None


def scan(folder: Path) -> None:
    files = sorted(p for p in folder.iterdir() if p.is_file())
    rows, reasons = [], Counter()
    for number, path in enumerate(files, 1):
        text = read_head(path)
        row, reason = (None, 'format') if text is None else screen(path.stem, text)
        reasons[reason] += 1
        if row:
            rows.append({'file': path.name, 'ext': path.suffix.lower(), 'size': path.stat().st_size, **row})
        if number % 200 == 0:
            print(f'{number}/{len(files)} 통과 {len(rows)} {dict(reasons)}', flush=True)
    KT.mkdir(parents=True, exist_ok=True)
    (KT / 'candidates.json').write_text(json.dumps({'folder': str(folder), 'scanned': len(files), 'reasons': reasons, 'rows': rows},
                                                   ensure_ascii=False))
    print(f'전체 {len(files)}개 중 통과 {len(rows)}개 {dict(reasons)}')
    print('통과 후보의 장르:', dict(Counter(r['genre'] for r in rows)))


def fetch_classic(title: str, dest: Path, tries: int = 5) -> None:
    """위키문헌 문서의 위키텍스트를 한 번 내려받는다(낮은 속도, 429면 기다린다). 이미 받았으면 건너뛴다."""
    if dest.exists():
        return
    url = WIKISOURCE + urllib.parse.urlencode({'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main',
                                               'format': 'json', 'titles': title, 'redirects': 1})
    request = urllib.request.Request(url, headers={'User-Agent': 'research-fetch/1.0 (classic text download; low rate)'})
    for attempt in range(tries):
        try:
            page = next(iter(json.load(urllib.request.urlopen(request, timeout=60))['query']['pages'].values()))
            dest.write_text(page['revisions'][0]['slots']['main']['*'], encoding='utf-8')
            time.sleep(8)
            return
        except urllib.error.HTTPError as error:
            if error.code != 429:
                raise
            time.sleep(30 * (attempt + 1))
    raise SystemExit('위키문헌이 요청을 막았다. 잠시 뒤 다시 실행하라.')


def save_work(work_id: str, kind: str, genre: str, source: str, pattern: str, episodes: list[dict]) -> None:
    folder = KT / 'works' / work_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'work.json').write_text(json.dumps({'id': work_id, 'kind': kind, 'genre': genre, 'source': source, 'pattern': pattern,
                                                  'episodes': episodes}, ensure_ascii=False))


def prepare(works: int = 12) -> None:
    """후보에서 장르별로 works편을 고르고(앞쪽 25화를 못 나누는 작품은 버리고 다음 후보로 교체), 고전을 받아 회차로 묶어 works/에 저장한다.
    이미 만든 작품의 id는 편수를 늘려도 그대로다: 확대 차수(ROUNDS)마다 그 차수에 새로 들어온 작품에 (장르, 파일) 순으로 이어 번호를 붙인다."""
    candidates = json.loads((KT / 'candidates.json').read_text())
    folder, rows, ready = Path(candidates['folder']), [r for r in candidates['rows'] if r['median_chars'] <= MAX_MEDIAN], {}
    quota = quota_for(works)
    while True:
        picked = choose(rows, SEED, quota)
        for row in picked:
            if row['file'] not in ready:
                text = read_head(folder / row['file'], 4_000_000)
                try:
                    pattern, episodes = split_episodes(text or '', min_episodes=EPISODES)
                    ready[row['file']] = (pattern, episodes[:EPISODES])
                except ValueError:
                    rows = [r for r in rows if r['file'] != row['file']]
                    print('회차 나누기 실패로 교체:', row['genre'])
                    break
        else:
            break
    by_name, ordered = (lambda r: (r['genre'], r['file'])), []
    for count in [n for n in ROUNDS if n < works] + [works]:
        ordered += sorted((r for r in choose(rows, SEED, quota_for(count)) if r not in ordered), key=by_name)
    for number, row in enumerate(ordered, 1):
        pattern, episodes = ready[row['file']]
        save_work(f'w{number:02d}', 'web', row['genre'], 'collection', pattern, episodes)
    raw_dir = KT / 'classics_raw'
    raw_dir.mkdir(parents=True, exist_ok=True)
    for number, (title, count, cap) in enumerate(CLASSICS, 1):
        fetch_classic(title, raw_dir / f'{title}.txt')
        episodes = prepare_classic((raw_dir / f'{title}.txt').read_text(encoding='utf-8'), count, cap)
        save_work(f'c{number:02d}', 'classic', '고전', f'ko.wikisource.org/{title}', 'paragraph_groups', episodes)
    for path in sorted((KT / 'works').glob('*/work.json')):
        work = json.loads(path.read_text())
        chars = [len(e['text']) for e in work['episodes']]
        print(f"{work['id']} {work['kind']:7s} {work['genre']:8s} 회차 {len(chars):2d} 회차당 글자 중앙값 {int(statistics.median(chars)):6d} 합계 {sum(chars):7d}")


# ---- add: 이미 쓴 작품과 겹치지 않는 새 작품 고르기 ----

ADD_SEED = 20261126   # 처음 선정(SEED 58)과 다른 고정 시드: 같은 후보 풀에서 다른 순서로 뽑는다
_RANGE = re.compile(r'(?<!\d)\d+\s*[-~_]\s*\d+|(?<!\w)-\s*\d+')   # 파일 이름의 회차 범위(1-270·1_300·001-322·-210)
_BRACKETS = re.compile(r'\[[^\]]*\]|\([^)]*\)|<[^>]*>|【[^】]*】')
_STATUS = {'완', '完', '완결', '텍완', '연재중', '미완', '외전', '외포', '본편', '번외', '합본', '개정판', '무삭제'}


def flat(text: str) -> str:
    return ' '.join(text.split())


def normalize_title(name: str) -> str:
    """파일 이름 → 같은 작품의 다른 판본·분권이 같아지는 제목 열쇠: 회차 범위부터 뒤(범위·완결 표시·필명)와 괄호 태그, 끝의 완결·외전·N부 표시를 떼고 한글·영문·숫자만 남긴다."""
    text = re.sub(r'\.(txt|epub)$', '', unicodedata.normalize('NFKC', name).casefold())
    head = _RANGE.split(text, maxsplit=1)[0].split('@')[0]

    def key(part: str) -> str:
        tokens = [t for t in re.split(r'[\s_+]+', part) if t]
        while tokens and (tokens[-1] in _STATUS or re.fullmatch(r'\d+[부권]', tokens[-1])):
            tokens.pop()
        return re.sub(r'[^0-9a-z가-힣]', '', ''.join(tokens))

    return key(_BRACKETS.sub(' ', head)) or key(head)   # 제목이 대괄호 안에만 있으면 괄호를 풀어 쓴다


def snippets(work: dict) -> list[str]:
    """작품 본문 조각: 회차 1·5의 앞 100자(공백을 접음). 판본이 달라 회차 제목 줄이 달라도 본문은 같다. 100자가 안 되는 회차는 쓰지 않는다."""
    return [part for part in (flat(e['text'])[:100] for e in work['episodes'] if e['number'] in (1, 5)) if len(part) == 100]


def find_sources(works: dict[str, dict], rows: list[dict], read) -> dict[str, list[dict]]:
    """작품(id → work.json)마다 그 본문 조각이 모두 앞부분에 든 후보 파일들(판본이 여럿이면 모두, 없으면 빈 목록). work.json의 source는 'collection'뿐이라
    출처 파일 이름이 없어 본문으로 찾는다. read(row)는 후보의 앞부분 글(못 읽으면 None)이고 파일은 한 번만 읽는다."""
    keys = {wid: snippets(work) for wid, work in works.items()}
    found: dict[str, list[dict]] = {wid: [] for wid in works}
    for row in rows:
        text = flat(read(row) or '')
        for wid, parts in keys.items():
            if parts and all(part in text for part in parts):
                found[wid].append(row)
    return found


def pick_new(rows: list[dict], seed: int, quota: dict[str, int], load, excluded=frozenset()) -> tuple[list[dict], dict, dict]:
    """add의 고르기: 회차 글자가 긴 후보와 제외한 제목(excluded 열쇠)의 후보를 빼고, 같은 제목 열쇠는 시드 순서로 앞선 하나만 남긴 풀에서 장르별 정원만큼 시드 순서로 고른다.
    load(row)가 (패턴, 회차 목록) 또는 None(회차를 못 나눔·이미 쓴 작품과 같은 본문)을 돌려주고, None인 후보는 풀에서 빼 다음 후보로 바꾼다(prepare와 같은 교체)."""
    pool, keys = [], set()
    for row in sorted((r for r in rows if r['median_chars'] <= MAX_MEDIAN), key=lambda r: _order(r, seed)):
        key = normalize_title(row['file'])
        if key not in excluded and key not in keys:
            keys.add(key)
            pool.append(row)
    stats = {'pool': dict(Counter(r['genre'] for r in pool)), 'replaced': 0}
    ready: dict = {}
    while True:
        picked = choose(pool, seed, quota)
        for row in picked:
            if row['file'] not in ready:
                loaded = load(row)
                if loaded is None:
                    pool = [r for r in pool if r['file'] != row['file']]
                    stats['replaced'] += 1
                    break
                ready[row['file']] = loaded
        else:
            return picked, {r['file']: ready[r['file']] for r in picked}, stats


def numbered(picked: list[dict], prefix: str) -> dict[str, dict]:
    """id(접두어 + 두 자리 번호) → 후보 행. (장르, 파일) 가나다 순으로 번호를 붙인다(prepare와 같은 규칙)."""
    return {f'{prefix}{n:02d}': row for n, row in enumerate(sorted(picked, key=lambda r: (r['genre'], r['file'])), 1)}


def save_new_works(root: Path, works: dict[str, dict]) -> int:
    """root/<id>/work.json을 새로 쓰고 새로 쓴 수를 돌려준다. 같은 내용이 이미 있으면 건너뛰고, 다른 작품이 이미 있으면 아무것도 쓰기 전에 멈춘다(기존 작품 폴더를 덮지 않는다)."""
    paths = {wid: root / wid / 'work.json' for wid in works}
    for wid, path in paths.items():
        if path.exists() and json.loads(path.read_text()) != works[wid]:
            raise SystemExit(f'{wid}에 다른 작품이 이미 있다: 덮어쓰지 않는다.')
    fresh = [wid for wid, path in paths.items() if not path.exists()]
    for wid in fresh:
        paths[wid].parent.mkdir(parents=True, exist_ok=True)
        paths[wid].write_text(json.dumps(works[wid], ensure_ascii=False))
    return len(fresh)


def add(count: int, prefix: str, seed: int = ADD_SEED) -> None:
    """이미 쓴 작품과 겹치지 않는 웹소설 count편을 works/<접두어>NN/work.json(앞쪽 25화)으로 더한다. candidates.json과 접두어가 다른 기존 작품 폴더는 읽기만 한다.
    제외: 기존 웹소설의 출처 파일과 같은 제목 열쇠인 후보(다른 판본·분권)·고전 제목·본문 조각이 기존 작품과 겹치는 후보. 정원은 quota_for(count). 같은 명령은 같은 작품을 다시 낸다."""
    if not re.fullmatch(r'[a-z]', prefix) or prefix in ('w', 'c'):
        raise SystemExit('--prefix는 기존 id 접두어(w·c)가 아닌 영문 소문자 한 글자다.')
    candidates = json.loads((KT / 'candidates.json').read_text())
    folder, rows = Path(candidates['folder']), candidates['rows']
    existing = {p.parent.name: json.loads(p.read_text()) for p in sorted((KT / 'works').glob('*/work.json')) if not p.parent.name.startswith(prefix)}
    web = {wid: work for wid, work in existing.items() if work['kind'] == 'web'}
    read = lambda row: read_head(folder / row['file'], 4_000_000)  # noqa: E731
    sources = find_sources(web, [r for r in rows if r['median_chars'] <= MAX_MEDIAN], read)
    excluded = {normalize_title(r['file']) for found in sources.values() for r in found} | {normalize_title(title) for title, *_ in CLASSICS}
    seen = [part for work in web.values() for part in snippets(work)]
    print(f"기존 웹소설 {len(web)}편 중 출처 파일을 찾은 작품 {sum(bool(f) for f in sources.values())}편(파일 {sum(len(f) for f in sources.values())}개) · 제외할 제목 {len(excluded)}개", flush=True)

    def load(row: dict):
        text = read(row)
        try:
            pattern, episodes = split_episodes(text or '', min_episodes=EPISODES)
        except ValueError:
            print('회차 나누기 실패로 교체:', row['genre'])
            return None
        if any(part in flat(' '.join(e['text'] for e in episodes[:EPISODES])) for part in seen):
            print('기존 작품과 본문이 겹쳐 교체:', row['genre'])
            return None
        return pattern, episodes[:EPISODES]

    quota = quota_for(count)
    picked, ready, stats = pick_new(rows, seed, quota, load, excluded)
    if len(picked) != count:
        raise SystemExit(f'후보가 모자라 {len(picked)}편만 골랐다.')
    ids = numbered(picked, prefix)
    works = {wid: {'id': wid, 'kind': 'web', 'genre': row['genre'], 'source': 'collection', 'pattern': ready[row['file']][0],
                   'episodes': ready[row['file']][1]} for wid, row in ids.items()}
    wrote = save_new_works(KT / 'works', works)
    record = {'seed': seed, 'works': count, 'quota': quota, 'candidates': len(rows), 'excluded_titles': len(excluded), **stats,
              'sources_found': {wid: len(found) for wid, found in sources.items()},
              'picked': {wid: {'file': row['file'], 'genre': row['genre'], 'pattern': row['pattern'], 'chain': row['chain'], 'median_chars': row['median_chars']}
                         for wid, row in ids.items()}}
    (KT / f'add-{prefix}.json').write_text(json.dumps(record, ensure_ascii=False, indent=1))   # 파일 이름이 들어 있어 .data(git 무시)에만 둔다
    print(f'새로 쓴 작품 {wrote}편(이미 같은 것이 있어 건너뜀 {count - wrote}편) · 풀 {stats["pool"]} · 교체 {stats["replaced"]}회')
    for wid, work in works.items():
        chars = [len(e['text']) for e in work['episodes']]
        print(f"{wid} web     {work['genre']:8s} 회차 {len(chars):2d} 회차당 글자 중앙값 {int(statistics.median(chars)):6d} 합계 {sum(chars):7d}")


if __name__ == '__main__':
    if sys.argv[1:2] == ['scan'] and len(sys.argv) == 3:
        scan(Path(sys.argv[2]))
    elif sys.argv[1:2] == ['prepare']:
        prepare(int(next((a.split('=')[1] for a in sys.argv[2:] if a.startswith('--works=')), 12)))
    elif sys.argv[1:2] == ['add']:
        options = dict(a.removeprefix('--').split('=', 1) for a in sys.argv[2:] if a.startswith('--') and '=' in a)
        add(int(options.get('works', 20)), options.get('prefix', 'n'), int(options.get('seed', ADD_SEED)))
    else:
        raise SystemExit('사용법: kt_select.py scan <소설 폴더> | prepare [--works=N] | add [--works=N] [--prefix=n] [--seed=N]')
