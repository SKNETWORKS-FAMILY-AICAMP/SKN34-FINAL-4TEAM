"""웹소설 평가 원천(로컬 전용, 저작권 있음): 폴더의 txt에서 장르를 번갈아 돌며 작품을 고르고, 회차 표지로 나눠 초반 회차 셋과 중반 회차 하나를 운영 크기(5천~6천 자)로 만든다.
원문·선택표는 호출한 쪽이 .data에만 둔다(저장소·Langfuse 금지, 해리 포터와 같다). 원본 폴더는 읽기만 한다. 모델 호출 없음.
"""

import hashlib
import json
import re
from pathlib import Path

LICENSE = '저작권 있음(웹소설): 로컬 오프라인 평가 전용, 저장소·Langfuse에 두지 않는다'
LOW, HIGH = 5000, 6000   # 회차 한 편의 글자 수 범위(운영 회차 크기)
EARLY = 3   # 작품마다 초반 회차 수(설정 소개가 많다). 중반 회차 하나를 더한다
WORKS = 22   # 고르는 작품 수(작품마다 4회차, 모두 88회차)
MIN_EPISODES = 30   # 번호가 이어지는 회차 표지가 이만큼은 있어야 작품으로 쓴다
OTHER = '기타'
# 장르 표지(파일 이름의 말): 앞에서부터 처음 맞는 장르다. 제목 말뿐이라 어림이고, 층화(장르를 번갈아 고르기)에만 쓴다.
GENRES = (('무협', r'무협|무림|천마|검신|검성|마교|강호|선협|협객|사파|정파|문파'), ('로판', r'로판|악녀|공녀|황후|황녀|영애|공작가|왕비|여주|남주|결혼'),
          ('대체역사', r'대체\s?역사|삼국지|조선|고려|대한제국|이순신|충무공|임진왜란|독립군|일제'), ('SF', r'SF|우주|은하|사이버|로봇|외계|행성|함선|함대'),
          ('겜판', r'겜판|게임|레벨업|플레이어|공략|만렙|스킬|튜토리얼|랭커|뽑기'), ('현판', r'현판|헌터|현대|각성|던전|게이트|아이돌|연예|배우|재벌|야구|사원|회사'),
          ('판타지', r'판타지|퓨판|이세계|마법|마왕|용사|드래곤|아카데미|환생|귀환|네크로맨서|소환|엘프|마나|정령|영주|왕국|제국'))
TAGS = r'무협|로판|대체역사|SF|겜판|현판|판타지|퓨판'   # 파일 이름이 장르를 직접 적은 말(퓨판 = 퓨전 판타지)
SKIP = re.compile(r'번역|패러디')   # 번역본·패러디는 쓰지 않는다
DECOR = r'[\s\[(<〈《【「『#*\-=~_·•▶■◆◇●○◎※]*'
# 회차 표지 줄의 형식들(번호가 첫 묶음). 번호가 이어지는지(chain)로 거르므로 문장 속 숫자는 걸러진다.
FAMILIES = tuple(re.compile(pattern) for pattern in (
    rf'^{DECOR}(?:제\s*)?0*(\d{{1,4}})\s*[화회話]',   # 12화 · 제12화 · 〈 12화 〉 · 12화. 제목
    rf'^.{{1,60}}?\s0*(\d{{1,4}})\s*[화회]\s*[\])>〉》】]*$',   # 제목 12화
    rf'^{DECOR}0*(\d{{1,4}})\s*[.)\]]\s*\S.{{0,60}}$',   # 12. 제목 · 12) 제목
    rf'^{DECOR}0*(\d{{1,4}})[\s\-–—~=#*\])>〉》】.]*$',   # 12 · - 12 - · # 12
    rf'^{DECOR}0*(\d{{1,5}})\s+[^\d\s].{{0,60}}$',   # #12 제목 · 00012 제목
    rf'^{DECOR}(?:EP|Ep|ep|Episode|episode|Chapter|chapter|CH|Ch|ch)\.?\s*0*(\d{{1,4}})\b.*$',   # EP.12 · Chapter 12
    rf'^{DECOR}0*(\d{{1,4}})\s*/\s*0*\d{{1,4}}\s*[-–—=_\s]*$'))   # 0012 / 0040 ----


def genre_of(name: str) -> str:
    """파일 이름이 장르를 직접 적었으면(@판타지·현판 …) 그것, 아니면 제목의 말(GENRES)로 어림하고, 없으면 기타다."""
    stem = Path(name).stem.replace('_', ' ')
    tag = re.search(TAGS, stem)
    if tag:
        return '판타지' if tag.group() == '퓨판' else tag.group()
    return next((genre for genre, words in GENRES if re.search(words, stem, re.I)), OTHER)


def clean_title(name: str) -> str:
    """파일 이름에서 확장자·괄호 표지·@작가·회차 범위·완결 표지를 걷은 제목(같은 작품의 다른 파일이 같은 제목이 된다)."""
    text = re.sub(r'[\[(【][^\])】]*[\])】]|[@ⓒ]\S*', ' ', Path(name).stem.replace('_', ' ').replace('+', ' '))
    return ' '.join(re.sub(r'\b\d+\s*[-~ ]\s*\d+\s*[화권]?|\b\d+[화권]|完|완결|미완|연재중|(?<=\d)완|\b완\b', ' ', text).split())


def decode(raw: bytes) -> str | None:
    """utf-8(BOM 허용)·utf-16(BOM)·cp949(euc-kr 포함) 순으로 읽는다. 앞 2만 자에서 한글이 글자의 절반 미만이거나 깨진 글자(U+FFFD)가 있으면 None이다(그 작품은 건너뛴다)."""
    for encoding in ('utf-16',) if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else ('utf-8-sig', 'cp949'):
        try:
            text = raw.decode(encoding)
        except UnicodeDecodeError:
            continue
        letters = [c for c in text[:20000] if c.isalpha()]
        if letters and sum('가' <= c <= '힣' for c in letters) * 2 >= len(letters) and '\ufffd' not in text[:20000]:
            return text
    return None


def chain(lines: list[str], pattern: re.Pattern) -> list[tuple[int, int]]:
    """번호가 0·1에서 시작해 이어지는(건너뜀은 둘까지) 표지 줄의 (줄 위치, 번호). 70자를 넘는 줄은 표지가 아니다."""
    found, expected = [], None
    for i, text in enumerate(lines):
        match = len(text) <= 70 and pattern.match(text)
        n = int(match.group(1)) if match else -1
        if (n in (0, 1)) if expected is None else (expected <= n <= expected + 2):
            found.append((i, n))
            expected = n + 1
    return found


def split(text: str) -> list[tuple[int, list[str]]]:
    """(회차 번호, 문단들) 목록. 표지가 가장 길게 이어지는 형식으로 나누고 첫 표지 앞의 글·표지 줄·빈 줄은 버린다. 0화로 시작하면 번호를 하나씩 올린다(번호는 1 이상). MIN_EPISODES개 미만이면 []다."""
    lines = [line.strip() for line in text.replace('\r', '').split('\n')]
    heads = max((chain(lines, family) for family in FAMILIES), key=len)
    if len(heads) < MIN_EPISODES:
        return []
    ends = [i for i, _ in heads[1:]] + [len(lines)]
    return [(n + 1 - heads[0][1], [row for row in lines[i + 1:end] if row]) for (i, n), end in zip(heads, ends)]


def take(episodes: list, start: int) -> tuple[str, int]:
    """start 회차에서 문단을 LOW자 이상이 될 때까지 모은 글과 다음 회차 위치. 다음 회차로 넘어가며 모으고, 다음 문단이 HIGH를 넘기면 거기서 멈춘다. 쓰다 만 회차의 남은 글은 쓰지 않는다."""
    rows, size = [], 0
    for i in range(start, len(episodes)):
        for row in episodes[i][1]:
            if rows and size + len(row) + 1 > HIGH:
                return '\n'.join(rows), i + 1
            rows.append(row)
            size += len(row) + 1
            if size >= LOW:
                return '\n'.join(rows), i + 1
    return '\n'.join(rows), len(episodes)


def units(episodes: list) -> list[tuple[int, str]]:
    """초반 EARLY개와 중반(한가운데 회차부터) 1개의 (회차 번호, 글). 서로 겹치지 않고 운영 크기다. 글이 모자라거나 한 문단이 너무 길어 크기를 못 맞추면 []다(그 작품은 쓰지 않는다)."""
    out, i = [], 0
    for position in (0,) * EARLY + (len(episodes) // 2,):
        i = max(i, position)
        if i >= len(episodes):
            return []
        text, after = take(episodes, i)
        out.append((episodes[i][0], text))
        i = after
    return out if all(LOW - 1 <= len(text) <= HIGH for _, text in out) else []   # 줄바꿈까지 세어 LOW에 닿은 글(글자 수 LOW - 1 이상)만, 채우지 못했거나 HIGH를 넘는 글은 아니다


def select(root: Path, count: int = WORKS) -> list[dict]:
    """폴더의 txt에서 장르를 번갈아 돌며 count개 작품을 고른다. 장르 안의 순서는 파일 이름의 해시(고르게 퍼지고 같은 입력이면 같다). 번역본·같은 제목·읽을 수 없거나 회차를 못 나누는 작품은 건너뛴다.
    선택표 행: {file, title, genre, episodes(회차 번호들), sha1(원본 파일 해시)}."""
    root, queues = Path(root), {}
    for name in sorted(p.name for p in root.iterdir() if p.suffix.lower() == '.txt' and not SKIP.search(p.name)):
        queues.setdefault(genre_of(name), []).append(name)
    for names in queues.values():
        names.sort(key=lambda name: hashlib.sha1(name.encode()).hexdigest())
    works, tried = [], set()
    while len(works) < count and any(queues.values()):
        for genre in (*(g for g, _ in GENRES), OTHER):
            while queues.get(genre) and len(works) < count:
                name = queues[genre].pop(0)
                title = clean_title(name)
                if title in tried:
                    continue
                raw = (root / name).read_bytes()
                text = decode(raw)
                made = units(split(text)) if text else []
                if made:
                    tried.add(title)   # 고른 작품만 적는다: 읽을 수 없는 파일이 같은 제목의 다른 파일까지 막지 않게
                    works.append({'file': name, 'title': title, 'genre': genre, 'episodes': [n for n, _ in made], 'sha1': hashlib.sha1(raw).hexdigest()})
                    break
    return works


def episodes(root: Path, manifest: Path, count: int = WORKS) -> list[dict]:
    """선택표(manifest)의 작품마다 초반 셋·중반 하나의 회차 항목(ex_sources와 같은 모양)을 만든다. 선택표가 없으면 select로 만들어 쓰고, 있으면 새 파일이 생겨도 같은 선택이다.
    파일이 선택표와 달라졌으면(원본 해시나 회차 번호) ValueError다."""
    root, manifest = Path(root), Path(manifest)
    if not manifest.exists():
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(select(root, count), ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    items = []
    for w, work in enumerate(json.loads(manifest.read_text(encoding='utf-8')), 1):
        raw = (root / work['file']).read_bytes()
        made = units(split(decode(raw) or ''))
        if hashlib.sha1(raw).hexdigest() != work['sha1'] or [n for n, _ in made] != work['episodes']:
            raise ValueError(f"{work['file']}: 선택표(manifest)와 다른 글이다. 선택표를 지우면 다시 고른다.")
        for k, (number, body) in enumerate(made, 1):
            items.append({'id': f'webnovel-{w:02d}-{k}', 'number': number, 'title': work['title'], 'body': body, 'license': LICENSE,
                          'source': {'work': work['title'], 'author': '웹소설(로컬 전용)', 'origin': work['file'], 'license': LICENSE, 'episode': number, 'genre': work['genre']}})
    return items
