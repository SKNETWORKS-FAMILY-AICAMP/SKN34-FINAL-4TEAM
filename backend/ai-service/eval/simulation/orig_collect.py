"""공개 세트 원천 수집: 고전(위키문헌, kt_select 재사용)·근대 소설(위키문헌)·SCP 재단 한국어(wikidot). 원문은 ORIG/works에만 쓴다(git 무시).

    cd backend/ai-service
    uv run --locked --extra dev python eval/simulation/orig_cli.py collect     # 낮은 속도로 내려받아 작품·회차로 저장(호출 0회)

고전은 기존 kt_select(위키문헌 내려받기·틀 제거·아래아 현대화·문단 묶음)를 그대로 쓰고, 근대 소설·SCP는 같은 모양(work.json)으로 저장한다.
"""

import json
import re
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from orig_common import ORIG
from kt_select import CLASSICS, fetch_classic, prepare_classic
from kt_text import clean_wikitext, group_paragraphs

# (id, 위키문헌 문서 제목, 저자 사망 연도, 글자 상한). 저자는 문서 머리말에서 읽는다. 작가 사망 1962년 이전의 원문만 쓴다(현대어 번역판 제외).
MODERN = (('m01', '운수 좋은 날', 1943, 40_000), ('m02', '술 권하는 사회', 1943, 40_000), ('m03', '감자', 1951, 40_000), ('m04', '봄봄', 1937, 40_000),
          ('m05', '레디메이드 인생', 1950, 40_000))
# (id, scpko.wikidot.com 문서 주소 끝). 대사가 많은 이야기. 저자는 문서의 「저자:」 줄이다.
SCP = (('s01', 'babel'), ('s02', 'breathless-to-the-point'), ('s03', 'knight-and-gunner-encounted-darkest-quartz'), ('s04', 'lee-s-daybreak-of-21k-site'),
       ('s05', 'sexy-jual'))
SCP_URL = 'https://scpko.wikidot.com/'
SCP_LICENSE = 'CC BY-SA 3.0'
WIKISOURCE_URL = 'https://ko.wikisource.org/wiki/'
HEADERS = {'User-Agent': 'research-fetch/1.0 (evaluation sample collection; low rate)'}
FOOTER = re.compile(r'^(?:《|\[\[|댓글 보기)')
GLYPH_ONLY = re.compile(r'^[\W_]+$')


class _Story(HTMLParser):
    """wikidot 본문에서 숨김(display:none)·코드·스타일·각주 번호·접기 링크·바닥 글을 뺀 글."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.stack, self.skip = [], [], 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        style, cls = (a.get('style') or '').replace(' ', '').lower(), a.get('class') or ''
        hide = ('display:none' in style or tag in ('script', 'style', 'pre') or any(k in cls for k in ('footnoteref', 'footnotes-footer', 'collapsible-block-link', 'licensebox', 'page-rate-widget-box', 'ko-footer')))
        if tag not in ('br', 'hr', 'img', 'meta', 'link', 'input'):
            self.stack.append((tag, hide))
            self.skip += hide
        if not self.skip and tag in ('p', 'div', 'br', 'li', 'tr', 'blockquote', 'h1', 'h2', 'h3', 'h4'):
            self.out.append('\n')

    def handle_endtag(self, tag):
        while self.stack:
            name, hide = self.stack.pop()
            self.skip -= hide
            if name == tag:
                break
        if not self.skip and tag in ('p', 'div', 'li', 'tr', 'blockquote'):
            self.out.append('\n')

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def scp_page(page: str) -> dict:
    """SCP 문서 HTML → {title, author, text}. 「저자: …」 줄 앞(제목 위쪽 틀)과 이전/다음 줄·바닥 글은 뺀다. 저자 줄이 없으면 author는 None이고 본문 전체를 쓴다."""
    start = page.find('id="page-content"')
    start = page.find('>', start) + 1 if start >= 0 else 0   # 본문 칸 여는 태그 다음부터
    end = page.find('id="page-info-break"', start)
    parser = _Story()
    parser.feed(page[start:end if end > 0 else len(page)])
    lines = [line for line in (re.sub(r'[ \t ]+', ' ', raw).strip() for raw in ''.join(parser.out).split('\n')) if line]
    credit = next((i for i, line in enumerate(lines) if re.match(r'저자\s*[:：]', line)), None)
    title = re.sub(r'^(?:제목|재목)\s*[:：]?\s*', '', lines[credit - 1]) if credit else None
    author = re.sub(r'^저자\s*[:：]\s*', '', lines[credit]) if credit is not None else None
    body = lines[credit + 1:] if credit is not None else lines
    body = [line for line in body if line != '노클립 하기']
    cut = next((i for i, line in enumerate(body) if FOOTER.match(line)), len(body))
    return {'title': title, 'author': author, 'text': '\n'.join(body[:cut])}


def wikisource_work(raw: str) -> dict:
    """위키문헌 위키텍스트 → {author, license, text}. 저자는 머리말(지은이·저자), 라이선스는 {{PD-…}} 틀 이름이고 틀·분류·장식 줄을 뺀 본문이다."""
    author = re.search(r'(?:지은이|저자)\s*=\s*\[\[(?:[^|\]]*\|)?([^\]]+)\]\]', raw)
    pd = re.search(r'\{\{(PD[^{}|]*)', raw)
    lines = [line.rstrip() for line in clean_wikitext(raw).split('\n')]
    text = '\n'.join(line for line in lines if not GLYPH_ONLY.match(line.strip()) or not line.strip()).strip()
    return {'author': author.group(1).strip() if author else None, 'license': pd.group(1).strip() if pd else None, 'text': re.sub(r'\n{3,}', '\n\n', text)}


def episode_count(chars: int) -> int:
    """글자 수에 맞는 회차 수: 회차 하나가 3,000자쯤이 되게 3~12개."""
    return max(3, min(12, round(chars / 3000)))


# ---- 내려받기·저장(네트워크가 필요해 단위 테스트하지 않는다) ----

def fetch_page(url: str, dest: Path) -> None:
    """SCP 문서 HTML을 한 번 내려받는다(이미 받았으면 건너뜀, 요청 사이 1.5초)."""
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60).read().decode('utf-8', 'replace'), encoding='utf-8')
        time.sleep(1.5)


def save_work(work: dict) -> None:
    folder = ORIG / 'works' / work['id']
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'work.json').write_text(json.dumps(work, ensure_ascii=False))


def collect() -> None:
    """고전 5·근대 소설·SCP를 받아 ORIG/works/<id>/work.json(회차 목록 포함)으로 저장한다."""
    raw = ORIG / 'raw'
    for number, (title, count, cap) in enumerate(CLASSICS, 1):
        fetch_classic(title, raw / 'wikisource' / f'{title}.txt')
        episodes = prepare_classic((raw / 'wikisource' / f'{title}.txt').read_text(encoding='utf-8'), count, cap)
        save_work({'id': f'c{number:02d}', 'kind': 'classic', 'title': title, 'author': '작자 미상(조선 시대)', 'license': '저작권 만료(조선 시대 작품)',
                   'source': WIKISOURCE_URL + title, 'person': 'third', 'episodes': episodes})
    for wid, title, died, cap in MODERN:
        fetch_classic(title, raw / 'wikisource' / f'{title}.txt')
        got = wikisource_work((raw / 'wikisource' / f'{title}.txt').read_text(encoding='utf-8'))
        text = got['text'][:cap].rsplit('\n', 1)[0] if len(got['text']) > cap else got['text']
        tag = f", 위키문헌 {{{{{got['license']}}}}}" if got['license'] else ''
        save_work({'id': wid, 'kind': 'modern', 'title': title, 'author': got['author'], 'license': f"저작권 만료(저자 사망 {died}년{tag})",
                   'source': WIKISOURCE_URL + title, 'episodes': group_paragraphs(text, episode_count(len(text)))})
    for wid, slug in SCP:
        fetch_page(SCP_URL + slug, raw / 'scp' / f'{slug}.html')
        got = scp_page((raw / 'scp' / f'{slug}.html').read_text(encoding='utf-8'))
        save_work({'id': wid, 'kind': 'scp', 'title': got['title'], 'author': got['author'], 'license': SCP_LICENSE, 'source': SCP_URL + slug,
                   'episodes': group_paragraphs(got['text'], episode_count(len(got['text'])))})
