"""평가 원천: 공개 근대 소설(위키문헌)과 로컬 해리 포터 번역본을 운영 회차 크기(5천~6천 자)의 회차 목록으로 만든다. 모델 호출 없음.
공개 작품은 저작권이 만료된 것만 둔다(게이트 세트가 저장소·Langfuse에 올라간다). 해리 포터(번역본, 저작권 있음)는 로컬 오프라인 평가 전용이라 호출한 쪽이 .data에만 쓴다.
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
for path in (HERE.parent / 'simulation', HERE.parent / 'novelbrain' / 'ko_timechara'):   # hp_chapters·kt_text(표준 라이브러리만 쓴다)
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from hp_chapters import windows  # noqa: E402
from kt_text import clean_wikitext, group_paragraphs, modernize_hangul  # noqa: E402

EPISODE_CHARS = 5500   # 운영 회차 크기(5천~8천 자)에서 호출 한도(읽기 70초·출력 16,000토큰) 안에 드는 크기
PUBLIC = (('운수 좋은 날', '현진건', '저작권 만료(저자 사망 1943년, 위키문헌 {{PD-old-50}})'),
          ('술 권하는 사회', '현진건', '저작권 만료(저자 사망 1943년, 위키문헌 {{PD-old-50}})'),
          ('감자', '김동인', '저작권 만료(저자 사망 1951년, 위키문헌 {{PD-old-50}})'),
          ('봄봄', '김유정', '저작권 만료(저자 사망 1937년, 위키문헌 {{PD-old-70}})'),
          ('레디메이드 인생', '채만식', '저작권 만료(저자 사망 1950년)'))   # (위키문헌 제목, 저자, 라이선스). 근대 소설은 현대어 번역·번안판이 아닌 위키문헌 원문이다
HP_LICENSE = '저작권 있음(번역본): 로컬 오프라인 평가 전용, 저장소·Langfuse에 두지 않는다'


def public_episodes(raw_dir: Path) -> list[dict]:
    """공개 작품: raw_dir/<제목>.txt(위키문헌 위키텍스트)에서 틀·태그·장식 줄을 걷어 EPISODE_CHARS 안팎의 회차로 묶는다(문단 순서·글자 그대로). 회차 id는 작품을 이어 1부터 센다."""
    episodes = []
    for title, author, license in PUBLIC:
        text = modernize_hangul(clean_wikitext((raw_dir / f'{title}.txt').read_text(encoding='utf-8')))
        text = '\n'.join(line for line in text.split('\n') if re.search(r'\w', line))   # 글자가 없는 줄(장 구분 장식)은 뺀다
        for part in group_paragraphs(text, max(1, round(len(text) / EPISODE_CHARS))):
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
