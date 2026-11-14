"""KoTimeChara 텍스트 처리: 인코딩 판별·회차 나누기·근거 대조·고전(위키문헌) 정리. 표준 라이브러리만 쓰는 순수 함수다."""

import re
import statistics
import unicodedata
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree

HEAD = r'^[ \t　]*'
# 회차 제목 줄 패턴. 각 패턴은 (번호, 제목)을 잡는다. 본문 속 비슷한 줄은 아래 사슬 검사가 걸러낸다.
PATTERNS = {
    'n_hwa': re.compile(HEAD + r'[\[(<]?(?:제[ \t]*)?(\d{1,4})[ \t]*[화회장][\])>]?[ \t]*(?:[.:\-–—][ \t]*)?(.{0,60})$', re.M),
    'n_dot': re.compile(HEAD + r'[\[(]?(\d{1,4})[\])]?[ \t]*[.:\-)][ \t]*(\S.{0,60})$', re.M),
    'ep': re.compile(HEAD + r'(?:EP|Ep|ep|Chapter|CHAPTER|chapter)\.?[ \t]*(\d{1,4})\b[ \t]*[.:\-]?[ \t]*(.{0,60})$', re.M),
    'hash': re.compile(HEAD + r'#[ \t]*(\d{1,4})[ \t]*(.{0,60})$', re.M),
}
QUOTES = str.maketrans({'“': '"', '”': '"', '„': '"', '«': '"', '»': '"', '「': '"', '」': '"', '『': '"', '』': '"', '‘': "'", '’': "'"})
BLOCK_TAGS = {'p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section'}


def decode_bytes(raw: bytes) -> str:
    """BOM이 있으면 그것으로, 없으면 utf-8 → cp949 순으로 엄격하게 읽는다. 읽을 수 없으면 입력을 담지 않은 ValueError."""
    if raw.startswith(b'\xef\xbb\xbf'):
        return raw.decode('utf-8-sig')
    for encoding in (('utf-16',) if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else ()) + ('utf-8', 'cp949'):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError('지원하지 않는 인코딩이다.')


def _chain(matches: list, start: int, cap: int = 400) -> list:
    """start번째 일치(번호 1)부터 1, 2, 3…으로 이어지는 제목만 이어 붙인다. 사이에 낀 가짜 번호는 건너뛴다."""
    chain, expected = [], 1
    for m in matches[start:]:
        if int(m.group(1)) == expected:
            chain.append(m)
            expected += 1
            if expected > cap:
                break
    return chain


def split_episodes(text: str, min_episodes: int = 20, min_chars: int = 800, max_chars: int = 40_000) -> tuple[str, list[dict]]:
    """제목 패턴(N화·제N장·001.·#N 등) 중 번호가 1부터 가장 길게 이어지는 것으로 회차를 나눈다.

    회차 본문의 중앙값이 min_chars 미만이거나(목차를 잡은 경우) 너무 짧은 회차가 많으면 그 패턴은 버린다. 어느 것도 맞지 않으면 ValueError.
    """
    best = None
    for name, pattern in PATTERNS.items():
        matches = list(pattern.finditer(text))
        for start in [i for i, m in enumerate(matches) if int(m.group(1)) == 1][:3]:
            chain = _chain(matches, start)
            if len(chain) < min_episodes or (best and len(chain) <= len(best[1])):
                continue
            bounds = [m.end() for m in chain] + [len(text)]
            heads = [m.start() for m in chain[1:]] + [len(text)]
            bodies = [text[bounds[i]:heads[i]].strip() for i in range(len(chain))]
            lengths = [len(b) for b in bodies[:40]]
            if statistics.median(lengths) < min_chars or sum(n < 300 for n in lengths[:-1]) > 0.1 * len(lengths):
                continue
            best = (name, chain, bodies)
    if best is None:
        raise ValueError('회차 제목 패턴을 찾지 못했다.')
    name, chain, bodies = best
    return name, [{'number': int(m.group(1)), 'title': (m.group(2) or '').strip(), 'text': body[:max_chars]} for m, body in zip(chain, bodies)]


def normalize(text: str) -> str:
    """근거 대조용 접기: NFKC, 따옴표 모양 통일, 모든 공백을 한 칸으로."""
    return ' '.join(unicodedata.normalize('NFKC', text).translate(QUOTES).split())


def squash(text: str) -> str:
    """normalize한 글에서 공백을 모두 없앤 비교용 글. 고전은 줄 끝에서 낱말 가운데가 끊겨 있어 공백 차이를 허용해야 근거 문장이 맞는다."""
    return ''.join(normalize(text).split())


def evidence_ok(text: str, sentence: str, min_chars: int = 6) -> bool:
    """근거 문장이 원문에 글자 그대로(공백의 차이와 따옴표 모양만 무시) 들어 있는가. 너무 짧은 근거는 거른다."""
    folded = squash(sentence)
    return len(folded) >= min_chars and folded in squash(text)


def group_paragraphs(text: str, count: int) -> list[dict]:
    """고전처럼 회차 제목이 없는 글을 문단 순서를 지켜 글자 수가 비슷한 count개 회차로 묶는다."""
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n|\n', text) if p.strip()]
    if len(paragraphs) < count:
        raise ValueError('문단이 회차 수보다 적다.')
    total, groups, before = sum(len(p) for p in paragraphs), [[] for _ in range(count)], 0
    for paragraph in paragraphs:
        groups[min(count - 1, int(before * count / total))].append(paragraph)
        before += len(paragraph)
    return [{'number': i + 1, 'title': '', 'text': '\n'.join(g)} for i, g in enumerate(groups)]


def clean_wikitext(raw: str) -> str:
    """위키문헌 위키텍스트에서 틀·링크·태그·머리글을 걷어 본문만 남긴다."""
    text = raw
    while True:                                           # 중첩 틀은 안쪽부터 벗긴다
        stripped = re.sub(r'\{\{[^{}]*\}\}', '', text)
        if stripped == text:
            break
        text = stripped
    text = re.sub(r'<ref[^>]*>.*?</ref>', '', text, flags=re.S)
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.I)
    text = re.sub(r'\[\[(?:분류|파일|File|Category):[^\]]*\]\]', '', text)
    text = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'^=+[^=\n]*=+[ \t]*$', '', text, flags=re.M)
    text = text.replace("'''", '').replace("''", '')
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def modernize_hangul(text: str) -> str:
    """옛한글 자모 중 아래아(ᆞ)·아래아+ㅣ(ᆡ)를 ㅏ·ㅐ로 바꿔 NFC로 합쳐 현대 음절처럼 읽히게 한다. 철자까지 현대화하지는 않는다."""
    return unicodedata.normalize('NFC', text.replace('ᆞ', 'ᅡ').replace('ᆡ', 'ᅢ'))


class _Plain(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self._skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self._skip += 1
        elif tag in BLOCK_TAGS:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self._skip -= 1
        elif tag in BLOCK_TAGS:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def _spine(archive: zipfile.ZipFile) -> list[str]:
    """OPF의 spine 순서로 본문 파일 이름. OPF를 못 읽으면 이름순."""
    names = [n for n in archive.namelist() if n.lower().endswith(('.xhtml', '.html', '.htm'))]
    for opf in (n for n in archive.namelist() if n.lower().endswith('.opf')):
        try:
            root = ElementTree.fromstring(archive.read(opf))
            ns = {'o': 'http://www.idpf.org/2007/opf'}
            href = {i.get('id'): i.get('href') for i in root.findall('.//o:manifest/o:item', ns)}
            base = opf.rsplit('/', 1)[0] + '/' if '/' in opf else ''
            ordered = [base + href[r.get('idref')] for r in root.findall('.//o:spine/o:itemref', ns) if r.get('idref') in href]
            ordered = [n for n in ordered if n in names]
            if ordered:
                return ordered
        except (ElementTree.ParseError, KeyError):
            pass
    return sorted(names)


def epub_text(path) -> str:
    """epub(zip) 안의 XHTML을 spine 순서로 읽어 태그를 떼고 이어 붙인다. 표준 라이브러리만 쓴다."""
    with zipfile.ZipFile(Path(path)) as archive:
        chapters = []
        for name in _spine(archive):
            parser = _Plain()
            parser.feed(decode_bytes(archive.read(name)))
            chapters.append(''.join(parser.parts))
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(chapters)).strip()


def canonical_names(names, text: str) -> dict[str, str]:
    """이름 → 대표 이름. 한 이름이 다른 이름의 끝부분(성을 뗀 이름)이거나 첫 낱말(서양식 이름)이고 그런 긴 이름이 하나뿐이면 같은 인물로 묶는다.

    묶음의 대표는 본문(text)에 가장 자주 나오는 형태이고 동률이면 짧은 쪽이다(짧은 이름은 긴 이름이 나오는 글에도 부분 일치한다).
    긴 이름이 둘 이상이거나 한 글자 이름이면 묶지 않는다(모호하면 합치지 않는다).
    """
    names = sorted({n.strip() for n in names if n.strip()})
    parent = {n: n for n in names}

    def find(name: str) -> str:
        while parent[name] != name:
            parent[name] = parent[parent[name]]
            name = parent[name]
        return name

    for short in names:
        longer = [n for n in names if len(n) > len(short) and (n.endswith(short) or n.startswith(short + ' '))]
        if len(short) >= 2 and len(longer) == 1:
            parent[find(short)] = find(longer[0])
    groups: dict[str, list[str]] = {}
    for name in names:
        groups.setdefault(find(name), []).append(name)
    result = {}
    for members in groups.values():
        best = min(members, key=lambda n: (-text.count(n), len(n), n))
        result.update({n: best for n in members})
    return result
