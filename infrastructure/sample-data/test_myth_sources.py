"""전승 카드의 출처·유형·정본 일치와 기존 11종 보존을 검증한다. DB 적재 도구가 아니다."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import unicodedata
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'infrastructure/sample-data/genre-templates'
RESOURCES = ROOT / 'backend/content-service/src/main/resources'
TYPES = {'character', 'location', 'organization', 'ability', 'object', 'rule', 'event', 'other'}
spec = importlib.util.spec_from_file_location('build_traditions', BASE / 'build_traditions.py')
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)

CREATIVE_PROTAGONISTS = {
    'wuxia': ('남궁현',), 'romance_fantasy': ('에블린',), 'modern_fantasy': ('강도윤',),
    'science_fiction': ('이안 서',), 'alternate_history': ('이환',), 'game_fantasy': ('한시우',),
    'fusion_fantasy': ('레온', '백무진'), 'territory_management': ('에드릭',),
    'apocalypse': ('윤태건',), 'sports_fantasy': ('한도윤',), 'entertainment': ('한서준',),
}

CHARACTER, PLACE, OBJECT, EVENT = (frozenset({t}) for t in ('character', 'location', 'object', 'event'))
CLAN = frozenset({'organization'})  # 신족·일행처럼 집단을 가리키는 카드
CLAN_OR_PERSON = frozenset({'organization', 'character'})

# 사용자 요구(PR #287 추가 요청의 우선 대상). 주제마다 제목에 이름이 있고 유형이 맞으며 설명·출전이 있는
# 서로 다른 카드가 하나씩 있어야 한다. 이름은 한국어 표기가 갈리는 경우만 함께 적는다.
SUBJECTS = {
    'greco_roman_mythology': [
        ('티탄 신족', ('티탄 신족',), CLAN), ('헤라클레스', ('헤라클레스',), CHARACTER),
        ('페르세우스', ('페르세우스',), CHARACTER), ('오디세우스', ('오디세우스',), CHARACTER),
        ('아이네아스', ('아이네아스',), CHARACTER), ('명계', ('명계',), PLACE),
        ('트로이 전쟁', ('트로이',), EVENT | PLACE),
    ],
    'norse_mythology': [
        ('바니르', ('바니르',), CLAN), ('거인', ('거인',), CLAN_OR_PERSON),
        ('아홉 세계', ('아홉 세계', '9개 세계', '아홉세계'), PLACE), ('이그드라실', ('이그드라실',), PLACE),
        ('라그나로크', ('라그나로크', '라그나뢰크', 'Ragnarök', 'Ragnarok'), EVENT),
        ('묠니르', ('묠니르', '묄니르', 'Mjölnir', 'Mjollnir'), OBJECT), ('궁니르', ('궁니르', 'Gungnir'), OBJECT),
    ],
    'cthulhu_mythos': [
        ('아컴', ('아컴', '아캄', 'Arkham'), PLACE), ('인스머스', ('인스머스', '인스마우스', 'Innsmouth'), PLACE),
        ('르뤼에', ('르뤼에', '르리에', "R'lyeh"), PLACE), ('네크로노미콘', ('네크로노미콘', 'Necronomicon'), OBJECT),
        ('요그 소토스', ('요그 소토스', '요그소토스', 'Yog-Sothoth'), CHARACTER),
    ],
    'journey_to_the_west': [  # 서유기는 별도 세계관이다(중국 고대 신화·설화와 섞지 않는다).
        ('손오공', ('손오공',), CHARACTER), ('삼장법사', ('삼장법사',), CHARACTER),
        ('저팔계', ('저팔계',), CHARACTER), ('사오정', ('사오정',), CHARACTER),
        ('취경 일행', ('일행',), CLAN), ('팔십일난', ('팔십일난', '81난'), EVENT),
        ('용궁', ('용궁',), PLACE), ('서천', ('서천',), PLACE),
        ('여의금고봉', ('여의금고봉',), OBJECT), ('구치정파', ('구치정파',), OBJECT), ('파초선', ('파초선',), OBJECT),
    ],
}

# 신화 15종의 기존 카드(PR #298 병합 준비 시점): 세계관 ID와 카드 [ID, 유형] 순서의 해시. 새 카드는 뒤에 추가한다.
EXISTING_CARDS = {
    'sumerian_mythology': (53, '45f48917530363aee7fe4081bf68bd925f763ba50383e29084ec7d32fac7b194'),
    'cthulhu_mythos': (38, '1fbaa3a2ae451c97c124d4e32184d315ca4df9395ba31edb063f28efbbda6c0d'),
    'norse_mythology': (53, '6a4062146281ad5999e06e710138ab063a98143885389804ec6ce54db70db144'),
    'greco_roman_mythology': (73, '024aadf7e2afe66d7dc627c5fec9c8406ac854747b11ea5875f698a836b887cb'),
    'germanic_folklore': (14, '789873d5a4f65ac142caeaa1013194dbf87fe458014c3eaabc2e0dcd61348255'),
    'chinese_folklore': (50, 'c3b3c18177eda53d85f9bb9e6d5ee890340d0081089f08ecf6c58a91c70a35c0'),
    'japanese_mythology': (75, 'ad1ee6184a6f5273f19e394bf73196ad3c4cfc85000f2950516d382f02586738'),
    'korean_mythology_fables': (41, 'b439d384b0f00dc2f152d12dfa333a92de778d0aaccad7219b6b45d346559c47'),
    'egyptian_mythology': (15, '2af685521f22fcc91a54291f84e0da0241306b1a0c7e3caa3858054e7df9a423'),
    'indian_mythology': (68, 'e131fba7da8defb781c2d8bd569b02323823c7e77af0a1512569f3a696c028fd'),
    'celtic_mythology': (25, '41bc598b43a4c0e3ceb3a6c553698b3cafdca540c323cfa12f3cb409cc255f5e'),
    'slavic_mythology': (30, '5e6604650f5a44b3891a2842759cbf4850dc498ce91ee350a213d46e9892141f'),
    'maya_mythology': (68, 'ca4bdf36c9f3b403063b06312ef686ce4802f561bcce7453d9d5ca0aa0627657'),
    'aztec_mythology': (72, '5c2045a9586d953f940a503e6c2f73abed2f2ea69c3c413063a9dd2b820ef6f8'),
    'journey_to_the_west': (76, 'e825767a36d1cf05ab51c431b1d13ee41f2a2885ba374a6864f55a03fb441e61'),
}

SOURCE_LINK = re.compile(r'출전:[^\n]*https?://\S+')
MIN_DESCRIPTION = 30  # 출전 줄을 뺀 설명이 이보다 짧으면 이름만 붙인 빈 카드로 본다

# 제목 외에 본문에도 해당 주제의 구체적인 내용이 있어야 한다.
CONTEXT = {
    '티탄 신족': ('크로노스', '티탄'), '헤라클레스': ('알크메네', '히드라'),
    '페르세우스': ('메두사', '페가소스'), '오디세우스': ('키르케', '이타케'),
    '아이네아스': ('안키세스', '아프로디테'), '명계': ('타르타로스', '하데스'),
    '트로이 전쟁': ('전쟁', '아킬레', '헥토르'), '바니르': ('전쟁', '신'),
    '거인': ('거인', '요툰'), '아홉 세계': ('아홉', '9'), '이그드라실': ('나무', '우르드'),
    '라그나로크': ('종말', '전쟁', '멸망'), '묠니르': ('토르', '망치'), '궁니르': ('오딘', '창'),
    '아컴': ('아컴', '아캄', 'Arkham', '미스캐토닉'), '인스머스': ('인스머스', '인스마우스', 'Innsmouth', '다곤'),
    '르뤼에': ('크툴루', '도시'), '네크로노미콘': ('알하즈레드', '책', '마도서'),
    '요그 소토스': ('요그', 'Yog', '문', '시간'),
    '손오공': ('원숭이', '삼장'), '삼장법사': ('현장', '경전', '삼장'), '저팔계': ('돼지', '오능', '쇠스랑'),
    '사오정': ('사오정', '유사하', '사승'), '취경 일행': ('삼장', '손오공'), '팔십일난': ('팔십일난', '재난'),
    '용궁': ('용궁', '용왕'), '서천': ('서천', '경전'), '여의금고봉': ('금고봉', '신철'),
    '구치정파': ('구치정파', '쇠스랑'), '파초선': ('파초선', '부채'),
}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def named(card, keywords):
    return any(unicodedata.normalize('NFC', k) in unicodedata.normalize('NFC', card['title']) for k in keywords)


def covers(card, keywords, types, name):
    """제목에 주제 이름이 있고 유형이 맞으며 설명이 비어 있지 않고 출전 링크가 있는 카드인가."""
    description = card['body'].split('\n\n출전:', 1)[0].strip()
    return (named(card, keywords) and card['cardType'] in types
            and len(description) >= MIN_DESCRIPTION and bool(SOURCE_LINK.search(card['body']))
            and any(word in description for word in CONTEXT.get(name, keywords)))


def missing_subjects(cards, subjects):
    """주제마다 서로 다른 카드를 하나씩 배정하고(최대 이분 매칭) 배정받지 못한 주제와 사유를 돌려준다."""
    options = {name: [i for i, card in enumerate(cards) if covers(card, keywords, types, name)]
               for name, keywords, types in subjects}
    owner = {}

    def take(name, seen):
        for i in options[name]:
            if i not in seen:
                seen.add(i)
                if i not in owner or take(owner[i], seen):
                    owner[i] = name
                    return True
        return False

    def reason(keywords):
        found = [c for c in cards if named(c, keywords)]
        if not found:
            return '제목에 ' + '/'.join(keywords) + ' 중 하나가 든 카드가 없다'
        return '제목이 맞는 카드(' + ', '.join(c['title'] + ':' + c['cardType'] for c in found) + ')가 유형·설명·출전이 맞지 않거나 다른 주제와 겹친다'

    return {name: reason(keywords) for name, keywords, _ in subjects if not take(name, set())}


class MythSourceTest(unittest.TestCase):
    def test_apocalypse_character_relationships_and_regression_timing(self):
        data = read_json(BASE / 'apocalypse/source/setting-cards.json')
        cards = {card['key']: card for card in data['cards']}
        self.assertIn('태건의 여동생', cards['yun-seoeun']['body'])
        for phrase in ('전생', '가족을 인질', '거점 위치', '이번 생', '아직 배신하지 않'):
            self.assertIn(phrase, cards['oh-minseok']['body'])
        for phrase in ('전생', 'D-30', '다가올'):
            self.assertIn(phrase, cards['gray-fall']['body'])

    def test_creative_details_follow_the_named_source_sections(self):
        cases = {
            ('modern_fantasy', 'baek-jinseok'): ('아들',),
            ('wuxia', 'regression-token'): ('회천검패',),
            ('science_fiction', 'captain-authentication'): ('초기에는 이안만',),
            ('alternate_history', 'northern-garrison'): ('북방', '중앙의 평판'),
            ('game_fantasy', 'resurrection'): ('세 번', '되돌아올 방법은 확인되지'),
            ('fusion_fantasy', 'alteon-imperial-house'): ('영웅들이 세운 알테온 제국',),
            ('territory_management', 'lowell-estate'): ('늦여름', '42일', '연간 현금 수입'),
        }
        for (genre, key), phrases in cases.items():
            with self.subTest(genre=genre, key=key):
                cards = read_json(BASE / genre / 'source/setting-cards.json')['cards']
                body = next(card['body'] for card in cards if card['key'] == key)
                for phrase in phrases:
                    self.assertIn(phrase, body)
                if (genre, key) == ('modern_fantasy', 'baek-jinseok'):
                    self.assertNotIn('민도혁', body)

    def test_original_sources_and_frozen_v1_are_unchanged(self):
        manifest = read_json(BASE / 'genre-preservation.json')
        for path, sha in manifest['source_files'].items():
            self.assertEqual(sha, hashlib.sha256((ROOT / path).read_bytes().replace(b'\r\n', b'\n')).hexdigest(), path)
        self.assertEqual('96cbbb7607aada4ca8f7a27f56cfd6a6197c7826db0160fae2cc134768992d85',
                         hashlib.sha256((RESOURCES / 'genre-templates-v1.json').read_bytes().replace(b'\r\n', b'\n')).hexdigest())
        legacy = read_json(RESOURCES / 'genre-templates-v1.json')
        self.assertEqual(11, len(legacy))
        self.assertEqual(manifest['legacy_genres_sha256'], digest(legacy))

    # 출처 연결과 카드·템플릿 일치는 genre-templates/test_traditions.py가 검사한다.
    def test_runtime_has_twenty_six_worlds_and_1254_cards(self):
        runtime = read_json(RESOURCES / 'genre-templates.json')
        self.assertEqual(26, len(runtime))
        self.assertEqual(386, sum(len(w['cards']) for w in runtime[:11]))
        self.assertEqual(868, sum(len(w['cards']) for w in runtime[11:26]))
        self.assertEqual(1254, sum(len(w['cards']) for w in runtime))
        self.assertEqual(set(EXISTING_CARDS), {w['genre'] for w in runtime[11:26]})
        self.assertTrue({'korea_history', 'china_history', 'japan_history', 'england_history', 'france_history', 'italy_history', 'usa_history'}.isdisjoint(w['genre'] for w in runtime))
        without_soul = [{**w, 'cards': [{k: v for k, v in c.items() if k != 'soul'} for c in w['cards']]} for w in runtime[:26]]
        self.assertEqual(read_json(RESOURCES / 'genre-templates-v2.json'), without_soul)

    def test_creative_cards_match_sources_and_preserve_worlds(self):
        runtime = {world['worldId']: world for world in read_json(RESOURCES / 'genre-templates.json')}
        frozen = read_json(RESOURCES / 'genre-templates-v1.json')
        self.assertEqual(set(CREATIVE_PROTAGONISTS), {world['genre'] for world in frozen})
        for previous in frozen:
            genre = previous['genre']
            with self.subTest(genre=genre):
                world = runtime[previous['worldId']]
                for field in ('worldId', 'genre', 'name', 'description'):
                    self.assertEqual(previous[field], world[field], genre + '/' + field)
                source = BASE / genre / 'source'
                template = read_json(source / 'template.json')
                data = read_json(source / 'setting-cards.json')
                self.assertEqual(world, catalog.build_creative_world(world, data, template), genre)
                types = {card['cardType'] for card in world['cards']} - {'other'}
                self.assertIn('character', types, genre)
                self.assertGreaterEqual(len(types), 3, genre)
                for name in CREATIVE_PROTAGONISTS[genre]:
                    self.assertTrue(any(name in card['title'] and card['cardType'] == 'character'
                                        and sum(other in card['title'] for other in CREATIVE_PROTAGONISTS[genre]) == 1
                                        for card in world['cards']), genre + '/' + name)

                sections = template['setting_bible']['sections']
                excluded = [s for s in sections if s['title'] in
                            ('첫 화 도입 예시', '서술과 분위기', '이야기에서 지켜야 할 설정 규칙', '장편 전개 구조')]
                self.assertTrue(any(s['title'] == '첫 화 도입 예시' for s in excluded), genre)
                excluded_text = [re.sub(r'\s+', ' ', s['content_markdown']).strip() for s in excluded]
                for card in world['cards']:
                    self.assertNotIn(card['title'], [s['title'] for s in excluded], genre)
                    self.assertNotIn(card['body'].strip(), [s['content_markdown'].strip() for s in excluded], genre)
                    body = re.sub(r'\s+', ' ', card['body']).strip()
                    self.assertFalse(any(body[i:i + 100] in text for text in excluded_text
                                         for i in range(len(body) - 99)),
                                     genre + '/' + card['title'])

    def test_runtime_ids_are_unique_and_cards_carry_no_visibility_override(self):
        runtime = read_json(RESOURCES / 'genre-templates.json')
        ids = [w['worldId'] for w in runtime] + [c['id'] for w in runtime for c in w['cards']]
        self.assertEqual(len(ids), len(set(ids)))
        # 카드 공개(public)는 적재기가 모든 템플릿 카드에 일괄 적용한다. 카드별 값을 데이터에 두지 않는다.
        characters = 0
        for world in runtime:
            for card in world['cards']:
                is_character = card['cardType'] == 'character'
                self.assertEqual({'id', 'title', 'body', 'cardType'} | ({'soul'} if is_character else set()), set(card), card['title'])
                if is_character:
                    characters += 1
                    self.assertTrue(isinstance(card['soul'], str) and card['soul'].strip() and len(card['soul'].encode('utf-16-le')) // 2 <= 3000, card['title'])
        self.assertEqual(379, characters)

    def test_existing_tradition_cards_keep_ids_order_and_types(self):
        worlds = {w['genre']: w for w in read_json(RESOURCES / 'genre-templates.json')}
        for genre, (count, sha) in EXISTING_CARDS.items():
            head = [[c['id'], c['cardType']] for c in worlds[genre]['cards'][:count]]
            with self.subTest(genre=genre):
                self.assertEqual(sha, digest({'worldId': worlds[genre]['worldId'], 'cards': head}),
                                 '기존 카드 앞 %d장의 세계관 ID·카드 ID·순서·유형이 바뀌었다(새 카드는 뒤에 추가한다)' % count)

    def test_priority_traditions_have_distinct_supported_subjects(self):
        worlds = {w['genre']: w for w in read_json(RESOURCES / 'genre-templates.json')}
        crossing = next(c for c in worlds['korean_mythology_fables']['cards'] if c['title'] == '주몽의 강 건너기')
        self.assertEqual('event', crossing['cardType'])
        for genre, subjects in SUBJECTS.items():
            lacking = missing_subjects(worlds[genre]['cards'], subjects)
            for name, _, _ in subjects:
                with self.subTest(genre=genre, subject=name):
                    self.assertIsNone(lacking.get(name), genre + '/' + name)


class SubjectRuleTest(unittest.TestCase):
    """우선 주제 검사 규칙 자체의 회귀: 이름만 맞춘 카드나 한 장으로는 통과하지 못한다."""
    SUBJECTS = [('묠니르', ('묠니르',), OBJECT), ('궁니르', ('궁니르',), OBJECT), ('트로이', ('트로이',), EVENT | PLACE)]

    def card(self, title, card_type='object', description='토르의 망치와 오딘의 창에 관한 트로이 전쟁의 구체적인 설명이다.', source=True):
        return {'title': title, 'cardType': card_type,
                'body': description + ('\n\n출전: [예시](https://example.test/a).' if source else '')}

    def test_distinct_complete_cards_cover_every_subject(self):
        cards = [self.card('묠니르'), self.card('궁니르'), self.card('트로이 전쟁', 'event')]
        self.assertEqual({}, missing_subjects(cards, self.SUBJECTS))

    def test_one_card_cannot_stand_in_for_several_subjects(self):
        # object라 트로이는 못 채우고, 묠니르·궁니르는 한 장으로 하나만 채운다.
        self.assertEqual(2, len(missing_subjects([self.card('묠니르·궁니르·트로이')], self.SUBJECTS)))

    def test_a_subject_needs_matching_type_description_and_source(self):
        rest = [self.card('궁니르'), self.card('트로이 전쟁', 'event')]
        no_link = {'title': '묠니르', 'cardType': 'object', 'body': '가' * MIN_DESCRIPTION + '\n\n출전: 책 이름.'}
        empty_url = self.card('묠니르', source=False)
        empty_url['body'] += '\n\n출전: https://'
        title_elsewhere = self.card('토르의 무기', description='묠니르를 든다. ' + '가' * MIN_DESCRIPTION)
        for bad in (self.card('묠니르', 'character'), self.card('묠니르', description='짧다'),
                    self.card('묠니르', source=False), self.card('묠니르', description='가' * MIN_DESCRIPTION), no_link, empty_url, title_elsewhere):
            with self.subTest(card=bad['title'] + ':' + bad['cardType'] + ':' + bad['body'][:6]):
                self.assertIn('묠니르', missing_subjects([bad] + rest, self.SUBJECTS))

    def test_assignment_does_not_depend_on_card_order(self):
        cards = [self.card('묠니르와 궁니르'), self.card('궁니르')]
        subjects = [('궁니르', ('궁니르',), OBJECT), ('묠니르', ('묠니르',), OBJECT)]
        self.assertEqual({}, missing_subjects(cards, subjects))  # 첫 카드를 묠니르에 돌려야 둘 다 채워진다


if __name__ == '__main__':
    unittest.main()
