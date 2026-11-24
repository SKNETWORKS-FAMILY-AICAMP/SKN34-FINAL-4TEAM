"""평가 원천: 공개 근대 소설(위키문헌)과 로컬 해리 포터 번역본을 운영 회차 크기(5천~6천 자)의 회차 목록으로 만든다. 모델 호출 없음.
공개 작품은 저작권이 만료된 것만 둔다(게이트 세트·최적화 풀이 저장소·Langfuse에 올라간다). 해리 포터(번역본, 저작권 있음)는 로컬 오프라인 평가 전용이라 호출한 쪽이 .data에만 쓴다.
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
for path in (HERE.parent / 'simulation', HERE.parent / 'novelbrain', HERE.parent / 'novelbrain' / 'ko_timechara'):   # hp_chapters·kt_select·kt_text(표준 라이브러리만 쓴다)
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import kt_select  # noqa: E402
from hp_chapters import windows  # noqa: E402
from kt_text import clean_wikitext, group_paragraphs, modernize_hangul  # noqa: E402

EPISODE_CHARS = 5500   # 운영 회차 크기(5천~8천 자)에서 호출 한도(읽기 70초·출력 16,000토큰) 안에 드는 크기
MAX_PER_WORK = 4   # 긴 장편은 회차를 고르게 이만큼만 쓴다(한 작품이 세트를 차지하지 않게)
# 작가 사망 연도. 1962년 이전 사망 작가만 쓴다: 사후 50년 보호기간이 2012년에 끝나 2013년의 70년 연장이 닿지 않는다(염상섭 등 1963년 이후 사망 작가는 쓰지 않는다)
DIED = {
    '현진건': 1943, '김동인': 1951, '김유정': 1937, '이효석': 1942, '최서해': 1932, '나도향': 1926,
    '채만식': 1950, '강경애': 1944, '이광수': 1950, '이무영': 1960, '계용묵': 1961, '이상': 1937,
    '심훈': 1936, '나혜석': 1948,
}
# (위키문헌 문서 제목, 작가): 현대어 번역·번안판이 아닌 위키문헌 원문. 이 순서가 회차 id의 순서라(먼저 만든 정답표 캐시가 id로 이어진다) 새 작품은 맨 뒤에만 더한다.
PUBLIC = (
    ('운수 좋은 날', '현진건'), ('술 권하는 사회', '현진건'), ('감자', '김동인'), ('봄봄', '김유정'), ('레디메이드 인생', '채만식'),
    ('벗기운 대금업자', '김동인'), ('고향 (현진건)', '현진건'), ('따라지', '김유정'), ('분녀', '이효석'),
    ('박돌의 죽음', '최서해'), ('행랑자식', '나도향'), ('논이야기', '채만식'), ('채전', '강경애'),
    ('이차돈의 사', '이광수'), ('죄와 벌 (이무영)', '이무영'), ('최서방', '계용묵'), ('동해', '이상'),
    ('황공의 최후', '심훈'), ('경희', '나혜석'), ('적막한 저녁', '김동인'), ('타락자', '현진건'),
    ('총각과 맹꽁이', '김유정'), ('성화', '이효석'), ('홍염', '최서해'), ('뽕', '나도향'),
    ('종로의 주민', '채만식'), ('인간문제', '강경애'), ('윤광호', '이광수'), ('사위', '이무영'),
    ('바람은 그냥 불고', '계용묵'), ('실화', '이상'), ('발가락이 닮았다', '김동인'), ('빈처', '현진건'),
    ('노다지', '김유정'), ('도시와 유령', '이효석'),
    ('큰물 진 뒤', '최서해'), ('계집 하인', '나도향'), ('미스터 방', '채만식'), ('부자', '강경애'),
    ('가실', '이광수'), ('B녀의 소묘', '이무영'), ('백치 아다다', '계용묵'), ('봉별기', '이상'),
    ('왕부의 낙조', '김동인'), ('할머니의 죽음', '현진건'), ('솥', '김유정'), ('가을과 산양', '이효석'),
    ('기아', '최서해'), ('지형근', '나도향'), ('민족의 죄인', '채만식'), ('어머니와 딸 (강경애)', '강경애'),
    ('소년의 비애', '이광수'), ('기차와 박노인', '이무영'), ('신기루', '계용묵'), ('단발', '이상'),
    ('사진과 편지', '김동인'), ('희생화', '현진건'), ('산골 나그네', '김유정'), ('일표의 공능', '이효석'),
    ('미치광이', '최서해'), ('물레방아', '나도향'), ('쑥국새', '채만식'), ('해고', '강경애'),
    ('사랑인가', '이광수'), ('인두지주', '계용묵'), ('광염 소나타', '김동인'), ('까막잡기', '현진건'),
    ('동백꽃', '김유정'), ('메밀꽃 필 무렵', '이효석'), ('백금', '최서해'), ('자기를 찾기 전', '나도향'),
    ('허생전 (채만식)', '채만식'), ('검둥이', '강경애'), ('병풍에 그린 닭이', '계용묵'), ('정희', '김동인'),
    ('백발', '현진건'), ('두포전', '김유정'), ('막', '이효석'), ('무명초', '최서해'),
    ('옛날 꿈은 창백하더이다', '나도향'),
)
HP_LICENSE = '저작권 있음(번역본): 로컬 오프라인 평가 전용, 저장소·Langfuse에 두지 않는다'


def license_of(author: str, raw: str) -> str:
    """저작권 만료의 근거: 작가 사망 연도와, 그 문서가 단 위키문헌 PD 틀(있으면)."""
    template = re.search(r'\{\{(PD-[\w-]+)\}\}', raw)
    return f'저작권 만료(저자 사망 {DIED[author]}년' + (f', 위키문헌 {{{{{template.group(1)}}}}}' if template else '') + ')'


def fetch_public(raw_dir: Path) -> None:
    """작품표의 위키문헌 문서 중 아직 없는 것만 내려받는다(낮은 속도, 429면 기다린다: kt_select.fetch_classic)."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    for title, _ in PUBLIC:
        if not (raw_dir / f'{title}.txt').exists():
            kt_select.fetch_classic(title, raw_dir / f'{title}.txt')


def public_episodes(raw_dir: Path) -> list[dict]:
    """공개 작품: raw_dir/<제목>.txt(위키문헌 위키텍스트)에서 틀·태그·장식 줄을 걷어 EPISODE_CHARS 안팎의 회차로 묶는다(문단 순서·글자 그대로). 회차가 MAX_PER_WORK보다 많으면
    고르게 그만큼만 쓴다(회차 번호는 작품 안의 순서 그대로). 회차 id는 작품을 이어 1부터 센다."""
    episodes = []
    for title, author in PUBLIC:
        raw = (raw_dir / f'{title}.txt').read_text(encoding='utf-8')
        license = license_of(author, raw)
        text = modernize_hangul(clean_wikitext(raw))
        text = '\n'.join(line for line in text.split('\n') if re.search(r'\w', line))   # 글자가 없는 줄(장 구분 장식)은 뺀다
        count = max(1, round(len(text) / EPISODE_CHARS))
        parts = group_paragraphs(text, count)
        for part in [parts[i * count // MAX_PER_WORK] for i in range(MAX_PER_WORK)] if count > MAX_PER_WORK else parts:
            episodes.append({'id': f'extraction.extract-{len(episodes) + 1:02d}', 'number': part['number'], 'title': title, 'body': part['text'], 'license': license,
                             'source': {'work': title, 'author': author, 'origin': f'https://ko.wikisource.org/wiki/{title}', 'license': license, 'episode': part['number']}})
    return episodes


def hp_episodes(hp_dir: Path, per_book: int, size: int = EPISODE_CHARS) -> list[dict]:
    """해리 포터(로컬 전용): hp_dir/chapters(장 덩어리 파일과 index.json)의 글을 줄 경계 size자 조각으로 자르고 권마다 per_book개를 고르게 뽑는다(꼬리가 size의 절반 미만인 조각은 뺀다)."""
    folder = hp_dir / 'chapters'
    episodes = []
    for book, info in json.loads((folder / 'index.json').read_text(encoding='utf-8')).items():
        pieces = []
        for unit in info['units']:
            first, last = unit['chapters'][0], unit['chapters'][-1]
            name = f'b{book}-{first:02d}' + (f'-{last:02d}' if last != first else '')
            pieces += [(f'{name}-{i}', part) for i, part in enumerate(windows((folder / f'{name}.txt').read_text(encoding='utf-8'), size), 1) if len(part) >= size // 2]
        count = min(per_book, len(pieces))
        for number, (name, part) in enumerate((pieces[i * len(pieces) // count] for i in range(count)), 1):
            episodes.append({'id': f'hp-{name}', 'number': number, 'title': f'해리 포터 {book}권', 'body': part, 'license': HP_LICENSE,
                             'source': {'work': '해리 포터 번역본(로컬 전용)', 'author': '조앤 K. 롤링(번역본 저작권 있음)', 'origin': name, 'license': HP_LICENSE, 'episode': number}})
    return episodes
