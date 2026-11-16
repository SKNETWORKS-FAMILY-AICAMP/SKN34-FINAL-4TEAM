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

    # 원전 문서·카드 일치는 새 형식(tradition-cards.json)을 읽는 genre-templates/test_traditions.py가 검사한다.
    def test_runtime_has_twenty_six_worlds_and_999_cards(self):
        runtime = read_json(RESOURCES / 'genre-templates.json')
        self.assertEqual(26, len(runtime))
        self.assertEqual(999, sum(len(w['cards']) for w in runtime))

    def test_priority_traditions_have_distinct_supported_subjects(self):
        worlds = {w['genre']: w for w in read_json(RESOURCES / 'genre-templates.json')}
        crossing = next(c for c in worlds['korean_mythology_fables']['cards'] if c['title'] == '주몽의 강 건너기')
        self.assertEqual('event', crossing['cardType'])
        # 신화·고전은 장르마다 단일 작품 범위다(설계 문서). 그 작품에 없는 주제(트로이 전쟁·묠니르·아컴 등)는 기대하지 않는다.
        expected = {
            'greco_roman_mythology': ['티탄 신족', '헤라클레스', '페르세우스', '오디세우스', '명계', '아이네아스'],
            'norse_mythology': ['바니르', '거인', '아홉 세계', '이그드라실'],
            'cthulhu_mythos': ['르뤼에', '네크로노미콘'],
            'journey_to_the_west': ['손오공', '삼장법사', '저팔계', '사오정', '팔십일난', '용궁', '서천', '파초선'],
        }
        for genre, subjects in expected.items():
            titles = '\n'.join(c['title'] for c in worlds[genre]['cards'])
            for subject in subjects:
                self.assertIn(subject, titles, genre)


if __name__ == '__main__':
    unittest.main()
