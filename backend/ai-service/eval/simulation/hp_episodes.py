"""해리 포터 장 나눈 글(`.data/hp/chapters`) → 회차 원고 `.data/hp/episodes/NNN.md`(첫 줄 제목, 빈 줄, 본문). 모델 호출 없음, 로컬 전용.

`hp_seed.py`(→ `seed._ensure_work`)가 이 폴더의 글을 회차 순서대로 저장·발행한다. 회차 번호는 `world.json`의 `ordinals`(권-장 → 회차)라
세계관의 회차별 관계·기억과 같은 회차에 붙는다.

`hp_chapters`가 머리를 못 찾아 묶은 장(9묶음)과 경계가 어긋난 1권 10·11장은 원문을 읽고 정한 줄 번호(`SPLITS`)로 나누고,
권 끝의 목차·출판 정보·독자 편지·역자 후기·인터뷰는 그 시작 줄(`TAIL_CUTS`)에서 자른다. 줄 번호는 `chapters/*.txt`(같은 원문에서 다시 만들면 같다) 기준이다.
OCR 원문의 쪽 번호·기호 줄·쪽 머리글(장·책 제목, 오탈자 포함)과 쪽이 겹쳐 두 번 들어간 긴 줄은 뺀다. 장의 머리 줄은 제목으로 쓰고 본문에서 뺀다.
줄바꿈이 문장 중간에 있으면(앞 줄이 문장 부호로 끝나지 않으면) 한 문단으로 잇는다(Content는 빈 줄로 문단을 나눠 색인한다).
5권 3장부터는 출판 번역본이 아닌 팬 번역이고 25~36장은 줄거리 요약이다(원문 그대로 두고 고치지 않는다).
"""

import difflib
import json
import re
import sys
from pathlib import Path

import hp_chapters

HERE = Path(__file__).resolve().parent
BASE = HERE / '.data' / 'hp'
HANGUL = re.compile(r'[가-힣]')
PUNCT = re.compile(r'[.?!"“”’‘\'…,]')
TERMINAL = re.compile(r'[.?!"”’\'…」』)\]~-]$')
HEADER_RATIO = 0.6   # 쪽 머리글: 장·책 제목과 이만큼 비슷한 짧은 줄
HEADER_MAX = 22      # 쪽 머리글은 이 글자 수 이하다
DUPLICATE_MIN = 20   # 쪽 겹침으로 두 번 들어간 줄로 보는 최소 길이
WRAP = 60            # 이보다 짧은 줄은 폭에 맞춘 줄바꿈일 수 있다(원문 줄 폭 30~50자)
CHAP = re.compile(r'(?i)^chap\s*\d+\s*[.:]\s*(\S.*)$')

# 묶음·경계 오류 파일 → (장, 시작 줄, 끝 줄(없으면 끝까지)). 원문을 읽고 정했다(장 첫 문장·구분자 `@ff`·장 머리 줄).
SPLITS = {
    'b1-10': [(10, 0, 203), (11, 203, None)],            # 11장 '퀴디치' 본문이 10장 파일에 있다
    'b1-11-13': [(11, 0, 5), (12, 5, 281), (13, 287, None)],  # 281~286은 287~291이 깨져 한 번 더 들어간 줄
    'b1-14-15': [(14, 0, 196), (15, 196, None)],
    'b2-09-10': [(9, 0, 437), (10, 437, 1044)],           # 1044~ 2-2권 표지·목차
    'b3-03-05': [(3, 0, 378), (4, 379, 821), (5, 822, 1421)],
    'b5-01-02': [(1, 0, 277), (2, 277, None)],
    'b5-04-06': [(4, 0, 690), (5, 690, 1139), (6, 1139, None)],
    'b5-08-09': [(8, 0, 156), (9, 156, None)],
    'b5-30-31': [(30, 0, 136), (31, 136, None)],
    'b5-37-38': [(37, 0, 366), (38, 366, None)],
}
# 파일 → 본문이 끝나고 군더더기가 시작하는 줄.
TAIL_CUTS = {'b1-09': 168, 'b1-17': 238, 'b3-11': 508, 'b3-22': 436, 'b4-12': 554, 'b4-21': 267, 'b4-28': 892, 'b4-37': 291,
             'b6-30': 239, 'b7-37': 134}

def _nospace(text: str) -> str:
    return re.sub(r'\s+', '', text)


def _similar(a: str, b: str) -> bool:
    return bool(b) and difflib.SequenceMatcher(None, _nospace(a), _nospace(b)).ratio() >= HEADER_RATIO


def clean(lines: list[str], title: str, book: int) -> list[str]:
    """빈 줄·쪽 번호와 기호 줄(한글 없는 8자 이하)·쪽 머리글·쪽 겹침으로 반복된 긴 줄을 뺀 줄 목록."""
    book_title = '해리포터와' + hp_chapters.BOOKS[book][0]
    seen, out = set(), []
    for line in lines:
        text = line.strip()
        if not text or (len(text) <= 8 and not HANGUL.search(text)):
            continue
        if len(text) <= HEADER_MAX and not PUNCT.search(text) and (_similar(text, title) or _similar(text, book_title)):
            continue
        if len(text) >= DUPLICATE_MIN:
            if text in seen:
                continue
            seen.add(text)
        out.append(text)
    return out


def _short(text: str) -> bool:
    return len(text) <= 30 and not PUNCT.search(text)


def _title(text: str) -> str:
    """머리 줄의 제목에서 괄호 메모·쪽 표시를 빼고, 한글 제목이 있으면 영어 원제를 뺀다."""
    text = re.sub(r'\(.*?\)|\(.*$|페이지.*$', '', text)
    text = re.sub(r"[A-Za-z][A-Za-z ,'.]*", '', text) if HANGUL.search(text) else text
    return text.strip(' \t.:;：。[]<>-_—')


def heading(lines: list[str]) -> tuple[str, list[str]]:
    """첫 줄이 장 머리(제N장·N。·챕터 N·Chapter N 형식, 또는 문장 부호 없는 짧은 줄)면 (제목, 나머지 줄), 아니면 ('', 줄 그대로).
    머리가 번호뿐이면 바로 다음 줄이 짧은 제목 줄일 때 그 줄을 제목으로 쓴다."""
    rest = [line for line in lines if line.strip()]
    if not rest:
        return '', rest
    first = rest[0].strip()
    if m := CHAP.match(first):
        return _title(m.group(1)), rest[1:]
    for _, pattern, _, anywhere in hp_chapters._PATTERNS:
        m = pattern.search(first) if anywhere else pattern.match(first)
        if not m:
            continue
        if not m.group(2).strip():
            nxt = rest[1].strip() if len(rest) > 1 else ''
            return (_title(nxt), rest[2:]) if nxt and _short(nxt) else ('', rest[1:])
        if not PUNCT.search(m.group(2)[-1:]):
            return _title(m.group(2)), rest[1:]
    return (_title(first), rest[1:]) if _short(first) else ('', rest)


def toc_titles(lines: list[str]) -> dict[int, str]:
    """목차·머리 줄 '제N장 제목'에서 장마다 가장 많이 나온 제목(뒤의 쪽 번호는 뺀다). 문장으로 끝나는 줄은 머리가 아니다."""
    seen: dict[int, dict[str, int]] = {}
    for line in lines:
        m = re.match(r'^\s*제\s*(\d+)\s*장\s*[.:]?\s*(\S.{0,40})$', line.strip())
        if m:
            title = re.sub(r'[.\s]*\d+$', '', m.group(2)).strip()
            if title and not re.search(r'[.?!"”]$', title):
                counts = seen.setdefault(int(m.group(1)), {})
                counts[title] = counts.get(title, 0) + 1
    return {n: max(counts, key=counts.get) for n, counts in seen.items()}


def _key(name: str) -> tuple[int, int]:
    book, first = re.match(r'b(\d+)-(\d+)', name).groups()
    return int(book), int(first)


def split_units(units: dict[str, list[str]], splits: dict, cuts: dict[str, int]) -> dict[tuple[int, int], list[str]]:
    """장 나눈 파일(이름 b<권>-<장>[-<끝 장>]) → (권, 장)별 줄. 나눌 파일은 splits의 줄 범위로, 나머지는 cuts의 줄에서 자른 한 장이다.
    한 장이 두 파일에 걸치면 파일 순서대로 잇는다."""
    parts: dict[tuple[int, int], list[str]] = {}
    for name in sorted(units, key=_key):
        lines, book = units[name], _key(name)[0]
        pieces = [(n, lines[a:b]) for n, a, b in splits[name]] if name in splits else [(_key(name)[1], lines[:cuts.get(name)])]
        for n, piece in pieces:
            parts.setdefault((book, n), []).extend(piece)
    return parts


def paragraphs(lines: list[str]) -> list[str]:
    """폭에 맞춰 줄바꿈된 짧은 줄(WRAP자 미만)이 문장 부호 없이 끝나면 다음 줄과 잇는다. 한 줄이 한 문단인 긴 줄은 그대로 문단이다."""
    out: list[str] = []
    previous = ''
    for line in lines:
        if out and len(previous) < WRAP and not TERMINAL.search(previous):
            out[-1] += line
        else:
            out.append(line)
        previous = line
    return out


def render(title: str, body: list[str]) -> str:
    return title + '\n\n' + '\n\n'.join(body) + '\n'


def build(base: Path = BASE) -> list[tuple[int, str, int]]:
    """episodes/NNN.md를 다시 쓴다. (회차, 제목, 글자 수) 목록을 돌려준다."""
    ordinals = json.loads((base / 'world.json').read_text(encoding='utf-8'))['ordinals']
    units = {p.stem: p.read_text(encoding='utf-8').split('\n') for p in (base / 'chapters').glob('b*.txt')}
    parts = split_units(units, SPLITS, TAIL_CUTS)
    if sorted(parts) != sorted(tuple(map(int, k.split('-'))) for k in ordinals):
        raise SystemExit('장 목록이 world.json의 ordinals와 다르다')
    names = {name: book for book, (name, _) in hp_chapters.BOOKS.items()}
    toc = {(names[folder.name], n): title for folder in (base / 'raw').iterdir()
           for n, title in toc_titles([line for f in hp_chapters.read_book(folder) for line in f]).items()}
    out = base / 'episodes'
    out.mkdir(exist_ok=True)
    made = []
    for (book, n), lines in sorted(parts.items()):
        found, rest = heading(lines)
        title = toc.get((book, n)) or found
        body = paragraphs(clean(rest, title, book))
        number = ordinals[f'{book}-{n}']
        name = f'{book}권 {n}장 {title}'.strip() if book < hp_chapters.EPILOGUE_BOOK or n <= hp_chapters.BOOKS[book][1] else f'{book}권 에필로그'
        (out / f'{number:03d}.md').write_text(render(name, body), encoding='utf-8')
        made.append((number, name, sum(map(len, body))))
    return made


if __name__ == '__main__':
    for number, name, size in build(Path(sys.argv[1]) if len(sys.argv) > 1 else BASE):
        print(f'{number:03d} [{size:6d}] {name}')
