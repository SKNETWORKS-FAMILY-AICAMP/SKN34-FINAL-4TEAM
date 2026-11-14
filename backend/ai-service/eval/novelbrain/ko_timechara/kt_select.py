"""KoTimeChara 작품 고르기: 수집 소설 폴더를 읽기만 해서 후보를 거르고(호출 0회) 장르가 다양한 완결작과 저작권이 끝난 고전을 고른다.

원문은 `.data/ko_timechara/`에만 쓴다(git 무시). 원본 폴더는 수정·이동·삭제하지 않는다.

    cd backend/ai-service
    uv run --locked --extra dev python eval/novelbrain/ko_timechara/kt_select.py scan <소설 폴더>   # 후보 선별 → candidates.json(집계만 문서에 쓴다)
    uv run --locked --extra dev python eval/novelbrain/ko_timechara/kt_select.py prepare [--works=N]   # 장르별로 N편(기본 12)을 고르고 앞쪽 25화·고전 회차를 works/에 저장
"""

import hashlib
import json
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

from kt_common import KT, SEED
from kt_text import clean_wikitext, decode_bytes, epub_text, group_paragraphs, modernize_hangul, split_episodes

HEAD_BYTES = 1_500_000      # 후보 선별은 앞부분만 읽는다(앞쪽 25화면 충분하다)
EPISODES = 25               # 웹소설은 작품마다 앞쪽 25화
MIN_MEDIAN, MIN_EPISODE = 2500, 800
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
    처음 12편은 편수를 늘려도 같은 작품·같은 id(w01~w12)이고, 늘린 작품은 w13부터 붙는다(이미 만든 추출·질문·캐시를 그대로 쓴다)."""
    candidates = json.loads((KT / 'candidates.json').read_text())
    folder, rows, ready = Path(candidates['folder']), candidates['rows'], {}
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
    base, by_name = choose(rows, SEED), lambda r: (r['genre'], r['file'])
    for number, row in enumerate(sorted(base, key=by_name) + sorted((r for r in picked if r not in base), key=by_name), 1):
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


if __name__ == '__main__':
    if sys.argv[1:2] == ['scan'] and len(sys.argv) == 3:
        scan(Path(sys.argv[2]))
    elif sys.argv[1:2] == ['prepare']:
        prepare(int(next((a.split('=')[1] for a in sys.argv[2:] if a.startswith('--works=')), 12)))
    else:
        raise SystemExit('사용법: kt_select.py scan <소설 폴더> | prepare [--works=N]')
