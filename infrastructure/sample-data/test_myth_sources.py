"""전승 카드의 출처·유형·정본 일치와 기존 11종 보존을 검증한다. DB 적재 도구가 아니다."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'infrastructure/sample-data/genre-templates'
RESOURCES = ROOT / 'backend/content-service/src/main/resources'
TYPES = {'character', 'location', 'organization', 'ability', 'object', 'rule', 'event', 'other'}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class MythSourceTest(unittest.TestCase):
    def test_existing_eleven_genres_are_unchanged(self):
        manifest = read_json(BASE / 'genre-preservation.json')
        for path, sha in manifest['source_files'].items():
            self.assertEqual(sha, hashlib.sha256((ROOT / path).read_bytes().replace(b'\r\n', b'\n')).hexdigest(), path)
        self.assertEqual(manifest['runtime_genres_sha256'], digest(read_json(RESOURCES / 'genre-templates.json')[:11]))
        legacy = read_json(RESOURCES / 'genre-templates-v1.json')
        self.assertEqual(11, len(legacy))
        self.assertEqual(manifest['legacy_genres_sha256'], digest(legacy))

    def test_all_myth_cards_match_sources_and_runtime_without_creative_sections(self):
        runtime = read_json(RESOURCES / 'genre-templates.json')
        self.assertEqual(25, len(runtime))
        self.assertEqual(472, sum(len(w['cards']) for w in runtime))
        seen = set()
        for world in runtime[11:]:
            source = BASE / world['genre'] / 'source'
            data = read_json(source / 'template.json')
            self.assertEqual('myth_reference', data['content_kind'])
            self.assertNotIn('basic_template', data)
            self.assertEqual(world['name'], data['title'])
            self.assertTrue(data['scope'])
            sources = {s['id']: s for s in data['sources']}
            self.assertEqual(len(sources), len(data['sources']))
            self.assertTrue(all(s['title'] and s['url'].startswith('https://') for s in sources.values()))
            sections = data['setting_bible']['sections']
            self.assertEqual(len(sections), len(world['cards']))
            self.assertTrue(any(c['cardType'] == 'event' for c in world['cards']))
            for section, card in zip(sections, world['cards']):
                self.assertNotIn(card['id'], seen)
                seen.add(card['id'])
                self.assertEqual((section['id'], section['title'], section['content_markdown'], section['card_type']),
                                 (card['id'], card['title'], card['body'], card['cardType']))
                self.assertIn(card['cardType'], TYPES)
                self.assertEqual('history' if card['cardType'] == 'event' else 'basic', section['area_code'])
                self.assertEqual('전승 요약', section['template_part'])
                self.assertLessEqual(len(card['body'].encode('utf-16-le')) // 2, 3000)
                self.assertTrue(section['source_refs'])
                for ref in section['source_refs']:
                    self.assertIn(ref['source_id'], sources)
                    self.assertTrue(ref['locator'])
                    self.assertIn(sources[ref['source_id']]['url'], card['body'])
                self.assertNotIn('결말 선택지', card['title'])
                self.assertNotIn('도입 예시', card['title'])
            expected = '# ' + data['title'] + '\n\n' + world['description'] + '\n\n' + '\n\n'.join('## ' + c['title'] + '\n\n' + c['body'] for c in world['cards']) + '\n'
            self.assertEqual(expected, data['content_markdown'])
            self.assertEqual(expected, (source / 'original.md').read_text(encoding='utf-8'))
            self.assertFalse((source / 'translation.ko.md').exists())

    def test_priority_traditions_have_distinct_supported_subjects(self):
        worlds = {w['genre']: w for w in read_json(RESOURCES / 'genre-templates.json')}
        crossing = next(c for c in worlds['korean_mythology_fables']['cards'] if c['title'] == '주몽의 강 건너기')
        self.assertEqual('event', crossing['cardType'])
        expected = {
            'greco_roman_mythology': ['티탄 신족', '헤라클레스', '페르세우스', '오디세우스', '명계', '트로이', '아이네아스'],
            'norse_mythology': ['바니르', '거인', '아홉 세계', '이그드라실', '라그나로크', '묠니르', '궁니르'],
            'cthulhu_mythos': ['아컴', '인스머스', '르뤼에', '네크로노미콘', '요그 소토스'],
            'chinese_folklore': ['서유기 · 손오공', '서유기 · 삼장법사', '서유기 · 저팔계', '서유기 · 사오정', '팔십일난', '용궁', '서천', '파초선'],
        }
        for genre, subjects in expected.items():
            titles = '\n'.join(c['title'] for c in worlds[genre]['cards'])
            for subject in subjects:
                self.assertIn(subject, titles, genre)


if __name__ == '__main__':
    unittest.main()
