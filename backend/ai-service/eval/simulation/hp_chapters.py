"""해리 포터 번역본 원문을 장으로 나눈다(평가용, 모델 호출 없음).

원문은 파일마다 머리 형식이 다르다(제N장·Chapter N·N장·N。제목·제목 줄뿐), 파일 앞에 목차가 붙은 곳과 본문에 머리가 없는 곳도 있다. 그래서
① 머리처럼 보이는 줄(후보)을 모두 모으고 ② 가까이 붙은 번호 줄(목차)을 빼고 ③ 장 번호가 이어지는 가장 긴 열을 머리로 고르고(본문 속 '6. …' 같은 줄이
열을 막지 못하게) ④ 빠진 장은 목차에 적힌 제목과 같은(공백·글자 몇 개 달라도) 줄을 앞뒤 머리 사이에서 찾는다.
그래도 못 찾은 장은 앞 장과 한 덩어리(Unit)로 묶는다: 묶음의 사건은 마지막 장의 것으로 센다(미래 정보가 앞 장으로 새지 않게, 경계를 짐작하지 않는다).
장 번호는 TimeChara의 `BookK-chapterN` 번호와 같고(원작 장 수), 마지막 권은 에필로그를 한 장 더(장 수 + 1)로 센다.
"""

import difflib
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

BOOKS = {1: ('마법사의 돌', 17), 2: ('비밀의 방', 18), 3: ('아즈카반의 죄수', 22), 4: ('불의 잔', 37), 5: ('불사조 기사단', 38), 6: ('혼혈왕자', 30), 7: ('죽음의 성물', 36)}
EPILOGUE_BOOK = 7
MAX_HEADING = 80   # 머리 줄은 이보다 짧다(글자)
TOC_GAP = 300      # 목차 줄은 다음 번호 줄과 이보다 가깝다(글자). 이런 줄이 셋 이상 이어지면 목차다
TITLE_RATIO = 0.8  # 목차 제목과 이만큼 비슷한 줄을 제목 줄로 본다
TITLE_SLACK = 12   # 제목 줄은 목차 제목보다 이만큼(글자)보다 길지 않다
ROMAN = 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ'
# (종류, 정규식, 세기, 줄 안 어디서나 찾는가). 앞의 넷은 확실한 머리, 번호로 시작하는 둘은 약하다(본문의 번호 줄과 구분이 안 돼 장 번호가 이어지는지로 거른다).
_PATTERNS = (
    ('je', re.compile(r'^제\s*(\d+)\s*장\s*(.*)$'), 3, False),
    ('chapter', re.compile(r'(?i)\bchapter\s*[.:]?\s*(\d+)\s*[:\]>]*\s*(.*)$'), 3, True),
    ('chaeptae', re.compile(r'챕터\s*(\d+)\s*:?\s*(.*)$'), 3, True),
    ('jang', re.compile(r'^(\d+)\s*장(?!\w)\s*(.*)$'), 3, False),
    ('num', re.compile(r'^(\d+)\s*[.。．]\s*(\S.*)$'), 1, False),
    ('sp', re.compile(r'^(\d+)\s+([가-힣A-Za-z].*)$'), 1, False),
)
_EPILOGUE = re.compile(r'(?i)^\W*(에필로그|epilogue)(?!\w)\s*(.*)$')
_SENTENCE_END = re.compile(r'[.!?…"”“’]$')


@dataclass(frozen=True)
class Candidate:
    line: int
    n: int
    kind: str
    title: str
    strength: int


@dataclass(frozen=True)
class Unit:
    """한 번에 읽는 글 덩어리: 장 하나, 또는 머리를 못 찾아 앞 장과 묶인 장들. 묶음의 사건은 마지막 장의 것으로 센다."""
    chapters: tuple[int, ...]
    text: str

    @property
    def ordinal_chapter(self) -> int:
        return self.chapters[-1]


@dataclass(frozen=True)
class Split:
    units: list[Unit]
    found: dict[int, str]   # 장 번호 → 머리를 찾은 방법(heading·title)
    missing: list[int]      # 머리를 못 찾아 묶인 장


def file_order(name: str) -> int:
    """파일 이름 끝의 번호(숫자 또는 로마 숫자 Ⅰ~Ⅹ). 번호가 없으면 0."""
    found = re.search(rf'([{ROMAN}])\.?txt$|(\d+)\.txt$', name)
    if not found:
        return 0
    return ROMAN.index(found.group(1)) + 1 if found.group(1) else int(found.group(2))


def _norm(text: str) -> str:
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFC', text))


def candidates(lines: list[str], total: int, epilogue: bool = False) -> list[Candidate]:
    """머리처럼 보이는 줄. 장 번호는 1~total이고, epilogue면 '에필로그' 줄이 total + 1이다."""
    found = []
    for k, raw in enumerate(lines):
        line = raw.strip()
        if not line or len(line) > MAX_HEADING:
            continue
        if epilogue and (m := _EPILOGUE.match(line)):
            found.append(Candidate(k, total + 1, 'epilogue', m.group(2).strip(), 3))
            continue
        for kind, pattern, strength, anywhere in _PATTERNS:
            m = pattern.search(line) if anywhere else pattern.match(line)
            if not m:
                continue
            n, title = int(m.group(1)), m.group(2).strip()
            if 1 <= n <= total and not (strength == 1 and _SENTENCE_END.search(title)):
                found.append(Candidate(k, n, kind, title, strength))
            break
    return found


def _toc(cands: list[Candidate], offsets: list[int]) -> set[int]:
    """목차 줄의 후보 번호(cands의 위치). 다음 번호 줄과 TOC_GAP보다 가까운 줄이 셋 이상 이어지면 그 묶음이 목차이고, 묶음의 끝 줄은 번호가 이어질 때만 목차다
    (목차 바로 뒤에 본문 첫 머리가 오면 번호가 1로 되돌아온다)."""
    toc, i = set(), 0
    while i < len(cands):
        j = i
        while j + 1 < len(cands) and offsets[cands[j + 1].line] - offsets[cands[j].line] < TOC_GAP:
            j += 1
        if j - i + 1 >= 3:
            toc |= set(range(i, j))
            if cands[j].n == cands[j - 1].n + 1:
                toc.add(j)
        i = j + 1
    return toc


def _chain(cands: list[Candidate]) -> list[Candidate]:
    """장 번호가 엄격히 늘어나는 가장 긴 열(같으면 확실한 머리가 많은 쪽). 본문 속 잘못 잡힌 줄이 진짜 머리를 막지 못한다."""
    best: list[tuple[int, int, int | None]] = []
    for i, c in enumerate(cands):
        top = (1, c.strength, None)
        for j in range(i):
            if cands[j].n < c.n and (best[j][0] + 1, best[j][1] + c.strength) > top[:2]:
                top = (best[j][0] + 1, best[j][1] + c.strength, j)
        best.append(top)
    if not cands:
        return []
    end, chain = max(range(len(cands)), key=lambda i: best[i][:2]), []
    while end is not None:
        chain.append(cands[end])
        end = best[end][2]
    return chain[::-1]


def split_book(files: list[list[str]], total: int, epilogue: bool = False) -> Split:
    """한 권(파일 순서대로의 줄 목록들)을 장 덩어리로 나눈다."""
    lines = [line for file in files for line in file]
    offsets, size = [], 0
    for line in lines:
        offsets.append(size)
        size += len(line) + 1
    cands = candidates(lines, total, epilogue)
    toc = _toc(cands, offsets)
    titles = {c.n: c.title for i, c in enumerate(cands) if i in toc and c.kind == 'je' and c.title}
    heads = {c.n: c for c in _chain([c for i, c in enumerate(cands) if i not in toc])}
    how = {n: 'heading' for n in heads}
    taken = {c.line for c in cands}
    for n in sorted(titles):  # 빠진 장은 목차 제목과 같은 줄을 앞뒤 머리 사이에서 찾는다
        if n in heads:
            continue
        lo = max((c.line for m, c in heads.items() if m < n), default=-1)
        hi = min((c.line for m, c in heads.items() if m > n), default=len(lines))
        wanted = _norm(titles[n])
        for k in range(lo + 1, hi):
            line = lines[k].strip()
            if k not in taken and wanted and len(line) <= len(titles[n]) + TITLE_SLACK and _norm(line) \
                    and difflib.SequenceMatcher(None, _norm(line), wanted).ratio() >= TITLE_RATIO:
                heads[n], how[n] = Candidate(k, n, 'title', titles[n], 0), 'title'
                break
    last = total + 1 if epilogue and total + 1 in heads else total
    ordered = sorted(heads.values(), key=lambda c: c.line)
    first_line = ordered[0].line if ordered else len(lines)
    start = max((cands[i].line for i in toc if cands[i].line < first_line), default=-1) + 1

    def text(a: int, b: int) -> str:
        return '\n'.join(lines[a:b]).strip()

    units = []
    if not ordered or ordered[0].n > 1:
        units.append(Unit(tuple(range(1, (ordered[0].n if ordered else last + 1))), text(start, first_line)))
    for i, c in enumerate(ordered):
        after = ordered[i + 1] if i + 1 < len(ordered) else None
        units.append(Unit(tuple(range(c.n, after.n if after else last + 1)), text(c.line, after.line if after else len(lines))))
    return Split(units, how, sorted(set(range(1, last + 1)) - set(heads)))


def windows(text: str, limit: int) -> list[str]:
    """긴 글을 줄 경계에서 limit(글자) 안으로 자른다. 한 줄이 limit보다 길면 그 줄 하나로 둔다."""
    out, cur, size = [], [], 0
    for line in text.split('\n'):
        if cur and size + len(line) + 1 > limit:
            out.append('\n'.join(cur))
            cur, size = [], 0
        cur.append(line)
        size += len(line) + 1
    out.append('\n'.join(cur))
    return out


def read_book(folder: Path) -> list[list[str]]:
    """권 폴더의 파일을 번호 순서대로 읽은 줄 목록들."""
    return [f.read_text(encoding='utf-8').splitlines() for f in sorted(folder.glob('*.txt'), key=lambda p: file_order(p.name))]


def split_all(raw: Path) -> dict[int, Split]:
    """raw/<권 폴더>/*.txt 전체를 권별로 나눈다."""
    return {book: split_book(read_book(raw / name), total, epilogue=book == EPILOGUE_BOOK) for book, (name, total) in BOOKS.items()}


def write_chapters(splits: dict[int, Split], out: Path) -> None:
    """장 덩어리 본문을 out/b<권>-<첫 장>[-<끝 장>].txt로, 나눈 결과(장 번호·방법·못 찾은 장)는 out/index.json으로 쓴다(원문은 .data에만)."""
    out.mkdir(parents=True, exist_ok=True)
    index = {}
    for book, split in splits.items():
        for unit in split.units:
            first, last = unit.chapters[0], unit.chapters[-1]
            (out / f'b{book}-{first:02d}{f"-{last:02d}" if last != first else ""}.txt').write_text(unit.text, encoding='utf-8')
        index[book] = {'units': [{'chapters': list(u.chapters), 'chars': len(u.text)} for u in split.units], 'found': {str(n): how for n, how in split.found.items()}, 'missing': split.missing}
    (out / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1))
