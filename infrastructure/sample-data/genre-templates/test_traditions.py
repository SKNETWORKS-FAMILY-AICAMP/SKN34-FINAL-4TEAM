"""Focused data contract tests; no database, network or application startup."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
import unittest
from unittest.mock import patch
from uuid import UUID, uuid5
import build_traditions as catalog


def variant_problems(card, documents=None):
    """'이설'이라고 쓴 카드는 출처별로 갈리는 근거를 보여야 한다. 쓰지 않은 카드에는 아무것도 요구하지 않는다."""
    if "이설" not in card["title"] + card["body"]:
        return []
    sections = {(ref.get("document", "sources.md"), ref["section"]) for ref in card["narrative_refs"]}
    # 각 출전 링크와 설명이 같은 줄에 있어야 출처별 주장을 구분할 수 있다.
    claims = re.findall(r"(?m)^\s*[-*]\s*\[([^\]]+)\]\((https?://[^)]+)\)\s*:\s*(.+)$", card["body"])
    cited = set()
    for document, section in sections:
        text = (documents or {}).get(document, {}).get(section, "")
        cited.update(url.split("#")[0] for url in re.findall(r"https?://[^\s)\]]+", text))
    supported = [(url.split("#")[0], claim.strip()) for _, url, claim in claims
                 if len(claim.strip()) >= 10 and url.split("#")[0] in cited]
    return (["서로 다른 근거 절이 2개 이상 필요하다"] if len(sections) < 2 else []) + \
        (["근거 절에 연결된 서로 다른 출전별 설명이 2개 이상 필요하다"]
         if len({url for url, _ in supported}) < 2 or len({claim for _, claim in supported}) < 2 else [])


class HistoryReviewTest(unittest.TestCase):
    def test_history_is_not_in_runtime_catalog(self):
        current = catalog.read(catalog.RESOURCES / "genre-templates.json")
        self.assertEqual(list(catalog.LEGACY + catalog.TRADITIONS), [world["genre"] for world in current])
        self.assertEqual(current, catalog.build(current))

    def test_candidate_soul_is_optional_and_validated_without_history_in_runtime(self):
        current = [world for world in catalog.read(catalog.RESOURCES / "genre-templates.json")
                   if world["genre"] in catalog.LEGACY + catalog.TRADITIONS]
        with tempfile.TemporaryDirectory() as directory:
            studio = Path(directory)
            for country in catalog.HISTORY:
                shutil.copy(catalog.STUDIO_ROOT / f"{country}.world.json", studio)
            path = studio / f"{catalog.HISTORY[0]}.world.json"
            world = catalog.read(path)
            person = next(card for card in world["cards"] if card["cardType"] == "character")
            other = next(card for card in world["cards"] if card["cardType"] != "character")
            original_soul = person.pop("soul")
            def save():
                path.write_text(json.dumps(world, ensure_ascii=False), encoding="utf-8")
            with patch.object(catalog, "STUDIO_ROOT", studio):
                save()
                reviewed = catalog.build_history_review(current)
                self.assertNotIn("soul", next(c for c in reviewed[0]["cards"] if c["id"] == person["id"]))
                person["soul"] = original_soul
                save()
                self.assertEqual(original_soul, next(c for c in catalog.build_history_review(current)[0]["cards"] if c["id"] == person["id"])["soul"])
                for value in ("", " ", "😀" * 1501, None):
                    person["soul"] = value
                    save()
                    with self.subTest(soul=value), self.assertRaises(AssertionError):
                        catalog.build_history_review(current)
                person["soul"] = original_soul
                other["soul"] = "invalid"
                save()
                with self.assertRaises(AssertionError):
                    catalog.build_history_review(current)
                del other["soul"]
                person["goal"] = "불필요한 필드"
                save()
                with self.assertRaises(AssertionError):
                    catalog.build_history_review(current)
                del person["goal"]
                save()
                collision = [{**current[0], "worldId": world["worldId"]}] + current[1:]
                with self.assertRaises(AssertionError):
                    catalog.build_history_review(collision)
                person["id"] = current[0]["cards"][0]["id"]
                save()
                with self.assertRaises(AssertionError):
                    catalog.build_history_review(current)

    def test_complete_studio_set_is_validated_without_changing_runtime_inputs(self):
        current = catalog.read(catalog.RESOURCES / "genre-templates.json")
        before = hashlib.sha256(json.dumps(current, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            studio = Path(directory)
            worlds = [catalog.load_history(catalog.ROOT / "history" / f"{country}.world.json") for country in catalog.HISTORY]
            for country, world in zip(catalog.HISTORY, worlds):
                (studio / f"{country}.world.json").write_text(json.dumps(world, ensure_ascii=False), encoding="utf-8")
            with patch.object(catalog, "STUDIO_ROOT", studio):
                self.assertEqual(worlds, catalog.build_history_review(current))
                path = studio / f"{catalog.HISTORY[-1]}.world.json"
                original = path.read_text(encoding="utf-8")
                path.unlink()
                with self.assertRaises(AssertionError):
                    catalog.build_history_review(current)
                path.write_text(original, encoding="utf-8")
                duplicate = json.loads(original)
                duplicate["cards"].append(duplicate["cards"][0])
                path.write_text(json.dumps(duplicate), encoding="utf-8")
                with self.assertRaises(AssertionError):
                    catalog.build_history_review(current)
                duplicate["cards"][-1] = {**duplicate["cards"][-1], "id": duplicate["cards"][-1]["id"].upper()}
                path.write_text(json.dumps(duplicate), encoding="utf-8")
                with self.assertRaises(AssertionError):
                    catalog.build_history_review(current)
                duplicate = json.loads(original)
                duplicate["worldId"] = worlds[0]["worldId"]
                path.write_text(json.dumps(duplicate), encoding="utf-8")
                with self.assertRaises(AssertionError):
                    catalog.build_history_review(current)
                duplicate = json.loads(original)
                duplicate["cards"][0]["id"] = worlds[0]["cards"][0]["id"]
                path.write_text(json.dumps(duplicate), encoding="utf-8")
                with self.assertRaises(AssertionError):
                    catalog.build_history_review(current)
                duplicate = json.loads(original)
                duplicate["genre"] = "other"
                path.write_text(json.dumps(duplicate), encoding="utf-8")
                with self.assertRaises(AssertionError):
                    catalog.build_history_review(current)
            self.assertEqual(before, hashlib.sha256(json.dumps(current, ensure_ascii=False, sort_keys=True).encode()).hexdigest())


class CreativeCardsTest(unittest.TestCase):
    WORLD = {"genre": "example", "worldId": "4fe1e070-e9f4-5d85-8923-c34da0b276e5", "name": "세계", "description": "설명", "cards": []}
    TEMPLATE = {"genre_id": "example", "setting_bible": {"sections": [{"id": "example_section_01"}]}}
    CARD = {"key": "hero", "title": "주인공", "body": "인물의 설정", "cardType": "character", "soul": "차분히 말한다", "source_sections": ["example_section_01"]}

    def test_character_soul_is_retained_separately_and_validated(self):
        card = {**self.CARD, "soul": "말투는 차분하다."}
        world = catalog.build_creative_world(self.WORLD, {"genre": "example", "cards": [card]}, self.TEMPLATE)
        self.assertEqual("말투는 차분하다.", world["cards"][0].get("soul"))
        self.assertEqual(self.CARD["body"], world["cards"][0]["body"])
        for soul in ("", " ", "😀" * 1501, None):
            with self.subTest(soul=soul), self.assertRaises(AssertionError):
                catalog.build_creative_world(self.WORLD, {"genre": "example", "cards": [{**card, "soul": soul}]}, self.TEMPLATE)
        for invalid in ({k: v for k, v in card.items() if k != "soul"}, {**card, "cardType": "location"}):
            with self.subTest(card=invalid), self.assertRaises(AssertionError):
                catalog.build_creative_world(self.WORLD, {"genre": "example", "cards": [invalid]}, self.TEMPLATE)

    def test_history_preserves_ids_text_order_and_soul(self):
        card = {"id": "8c75d599-4d1e-5e09-a942-873900666c44", "title": "사람", "body": "검수 대기 · 출처 https://example.org", "cardType": "character", "soul": "원전 검토 미확인"}
        world = {**self.WORLD, "cards": [card]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "country.world.json"
            path.write_text(json.dumps(world, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(world, catalog.load_history(path))
            del card["soul"]
            path.write_text(json.dumps(world, ensure_ascii=False), encoding="utf-8")
            with self.assertRaises(AssertionError):
                catalog.load_history(path)

    def test_loaded_history_cards_include_actual_sources(self):
        worlds = [catalog.load_history(catalog.ROOT / "history" / f"{country}.world.json") for country in catalog.HISTORY]
        cards = {card["id"]: card["body"] for world in worlds for card in world["cards"]}
        root = "https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/"
        with self.subTest(country="france"):
            body = cards["26f85737-beba-591e-94fe-ae97b2773e53"]
            self.assertIn("초기 왕국부터 1870–1871년 전쟁까지", body)
            self.assertIn("원문 49–59행", body)
            self.assertIn(root + "france/source-en.txt#L128-L161", body)
            self.assertIn(root + "france/source-en.txt#L2668-L2690", body)
        with self.subTest(country="italy"):
            body = cards["b0057fb2-639c-53f9-8e9b-0cb0cc7c5802"]
            self.assertIn("마지막 평가는 1874년", body)
            self.assertIn("원문 283–339행", body)
            self.assertIn(root + "italy/hunt/source-en.txt#L11253-L11262", body)
        with self.subTest(country="usa"):
            body = cards["0bef7a62-4958-5f89-8096-1b0dd60c1e59"]
            self.assertNotIn("usa.world.ko.md", body)
            self.assertIn("저장소 병합 후 접근", body)
            self.assertIn("https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/develop/infrastructure/sample-data/genre-templates/history/usa.evidence.json", body)
            self.assertIn("https://www.americanyawp.com/text/contributors/", body)
            self.assertIn("https://www.americanyawp.com/textbook/01-american-origins", body)

    def test_loaded_usa_license_card_links_to_chapter_credits(self):
        source = catalog.ROOT / "history/usa.world.json"
        original = catalog.read(source)
        result = catalog.load_history(source)
        card_id = "0bef7a62-4958-5f89-8096-1b0dd60c1e59"
        before = next(c for c in original["cards"] if c["id"] == card_id)
        after = next(c for c in result["cards"] if c["id"] == card_id)
        url = "https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/develop/infrastructure/sample-data/genre-templates/history/usa.evidence.json"
        self.assertEqual(before["body"].replace("짝인 usa.evidence.json과 usa.world.ko.md에", "usa.evidence.json에") + "\n\n장별 기여자와 출처(저장소 병합 후 접근): " + url + "\n원전의 현행 장별 목록: https://www.americanyawp.com/\n원전의 현행 기여자 목록: https://www.americanyawp.com/text/contributors/", after["body"])
        after["body"] = before["body"]
        self.assertEqual(before, after)

    def test_loaded_history_corrects_only_recorded_notes_and_sources(self):
        descriptions = {
            "england": ("현대사 보완·서비스 반영 전 검토용.", "현대사 보완 대기 중인 비공개 연구 기반 샘플."),
            "france": ("서비스·DB 반영 대상이 아니다.", "독립 검수 미완료인 비공개 연구 기반 샘플이다."),
            "italy": ("현대사 확보·서비스 반영은 보류 상태다.", "현대사 확보는 보류 상태인 비공개 연구 기반 샘플이다."),
            "japan": ("현대 통사·전수 감수본·서비스 등록본이 아니다.", "현대 통사·전수 감수본이 아닌 비공개 연구 기반 샘플이다."),
            "korea": ("서비스·DB 등록 금지.", "독립 검수 미완료인 비공개 연구 기반 샘플이다."),
        }
        bodies = {
            "2b354d59-bb5e-5515-8eeb-63270e9c12e8": ("연구용 신규 파일만 작성했으며 앱·DB·서비스 템플릿에는 반영하지 않는다.", "독립 검수 미완료인 연구 기반 샘플이다."),
            "29abc109-1de4-575a-aa6c-6ae29a4e0e39": ("연구용 파일만 만들며 서비스·DB에는 등록하지 않는다.", "검증되지 않은 연구 기반 샘플이다."),
            "84c432b7-7c72-5450-a0e0-9bff072b0420": ("현대 자료 신규 취득, 앱·DB 등록, 서비스 템플릿 수정, 커밋·푸시는 하지 않는다.", "현대 자료 신규 취득과 독립 역사 감수는 완료되지 않았다."),
            "4ff3552f-2aa0-5e95-88a8-5cf7d2c46e8b": ("창작 인물·가상 사건·대화·플롯을 추가하지 않았고 서비스 데이터에 반영하지 않았다.", "창작 인물·가상 사건·대화·플롯을 추가하지 않았으며 독립 검수 미완료인 연구 기반 샘플이다."),
            "26f85737-beba-591e-94fe-ae97b2773e53": ("[원문](https://www.gutenberg.org/cache/epub/17287/pg17287.txt)", "[원문](https://www.gutenberg.org/cache/epub/17287/pg17287.txt); [1장 초기 왕국, 원문 128–161행](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/france/source-en.txt#L128-L161); [프랑스-독일 전쟁, 원문 2668–2690행](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/france/source-en.txt#L2668-L2690)"),
            "b0057fb2-639c-53f9-8e9b-0cb0cc7c5802": ("[원문](https://archive.org/download/historyitaly00huntgoog/historyitaly00huntgoog_djvu.txt)", "[원문](https://archive.org/download/historyitaly00huntgoog/historyitaly00huntgoog_djvu.txt); [마지막 평가, 원문 11253–11262행](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/italy/hunt/source-en.txt#L11253-L11262)"),
            "0bef7a62-4958-5f89-8096-1b0dd60c1e59": ("짝인 usa.evidence.json과 usa.world.ko.md에", "usa.evidence.json에"),
        }
        url = "https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/develop/infrastructure/sample-data/genre-templates/history/usa.evidence.json"
        seen = set()
        for country in catalog.HISTORY:
            path = catalog.ROOT / "history" / (country + ".world.json")
            expected = catalog.read(path)
            if country in descriptions:
                before, after = descriptions[country]
                self.assertEqual(1, expected["description"].count(before))
                expected["description"] = expected["description"].replace(before, after)
            for card in expected["cards"]:
                if card["id"] in bodies:
                    seen.add(card["id"])
                    before, after = bodies[card["id"]]
                    self.assertEqual(1, card["body"].count(before))
                    card["body"] = card["body"].replace(before, after)
                if card["id"] == "0bef7a62-4958-5f89-8096-1b0dd60c1e59":
                    card["body"] += "\n\n장별 기여자와 출처(저장소 병합 후 접근): " + url + "\n원전의 현행 장별 목록: https://www.americanyawp.com/\n원전의 현행 기여자 목록: https://www.americanyawp.com/text/contributors/"
            with self.subTest(country=country):
                self.assertEqual(expected, catalog.load_history(path))
        self.assertEqual(set(bodies), seen)

    def test_stable_ids_and_runtime_fields(self):
        data = {"genre": "example", "cards": [self.CARD]}
        world = catalog.build_creative_world(self.WORLD, data, self.TEMPLATE)
        self.assertEqual({**self.WORLD, "cards": [{
            "id": str(uuid5(UUID(self.WORLD["worldId"]), "setting:hero")),
            "title": "주인공", "body": "인물의 설정", "cardType": "character", "soul": "차분히 말한다",
        }]}, world)
        self.assertEqual([], self.WORLD["cards"])
        self.assertEqual(world, catalog.build_creative_world(world, data, self.TEMPLATE))
        boundary = {**self.CARD, "title": "😀" * 100, "body": "😀" * 1500}
        catalog.build_creative_world(self.WORLD, {"genre": "example", "cards": [boundary]}, self.TEMPLATE)

    def test_build_selects_world_by_frozen_id(self):
        real_read = catalog.read
        frozen = real_read(catalog.RESOURCES / "genre-templates-v1.json")[0]
        genre = frozen["genre"]
        template = real_read(catalog.ROOT / genre / "source/template.json")
        card = {**self.CARD, "source_sections": [template["setting_bible"]["sections"][0]["id"]]}
        def read(path):
            return {"genre": genre, "cards": [card]} if path.name == "setting-cards.json" else real_read(path)
        unrelated = {**frozen, "worldId": "3cf7aea1-14ed-58af-9f2e-74f13d171cad", "genre": "other"}
        with patch.object(catalog, "LEGACY", (genre,)), patch.object(catalog, "TRADITIONS", ()), patch.object(catalog, "HISTORY", ()), patch.object(catalog, "read", side_effect=read):
            result = catalog.build([unrelated, frozen])
            self.assertEqual(frozen["worldId"], result[0]["worldId"])
            self.assertEqual(frozen["name"], result[0]["name"])
            self.assertEqual(frozen["description"], result[0]["description"])
            self.assertEqual(str(uuid5(UUID(frozen["worldId"]), "setting:hero")), result[0]["cards"][0]["id"])
            with self.assertRaises(AssertionError):
                catalog.build([{**frozen, "genre": "wrong"}])

    def test_rejects_invalid_cards_and_wrong_genre(self):
        for bad in (
            {"key": "Hero"}, {"key": "hero_bad"}, {"key": ""},
            {"title": " "}, {"body": ""}, {"cardType": "invalid"},
            {"source_sections": []}, {"source_sections": ["other_section_01"]},
            {"title": "😀" * 101}, {"body": "😀" * 1501},
        ):
            with self.subTest(bad=bad), self.assertRaises(AssertionError):
                catalog.build_creative_world(self.WORLD, {"genre": "example", "cards": [{**self.CARD, **bad}]}, self.TEMPLATE)
        for data in ({"genre": "other", "cards": [self.CARD]}, {"genre": "example", "cards": []},
                     {"genre": "example", "cards": [self.CARD, self.CARD]}):
            with self.subTest(data=data), self.assertRaises(AssertionError):
                catalog.build_creative_world(self.WORLD, data, self.TEMPLATE)
        with self.assertRaises(AssertionError):
            catalog.build_creative_world(self.WORLD, {"genre": "example", "cards": [self.CARD]}, {**self.TEMPLATE, "genre_id": "other"})


class TraditionCatalogTest(unittest.TestCase):
    def setUp(self):
        self.current = catalog.read(catalog.RESOURCES / "genre-templates.json")

    def test_removed_editorial_notes_are_not_present_in_public_cards(self):
        cases = {
            ("sumerian_mythology", "justice-vow"): ("저본의 보충 읽기",),
            ("chinese_folklore", "qi"): ("난해한 구절", "확정된 왕위 계승 연표"),
            ("chinese_folklore", "jie_meixi"): ("몽산·민산", "방자함·허물"),
            ("chinese_folklore", "king_mu"): ("탐욕", "원대한 계획"),
        }
        for (genre, key), retained in cases.items():
            with self.subTest(genre=genre, key=key):
                data = catalog.read(catalog.ROOT / genre / "source/tradition-cards.json")
                card = next(c for c in data["cards"] if c["key"] == key)
                self.assertNotIn("원고", card["body"])
                self.assertNotIn("편집 주", card["body"])
                for phrase in retained:
                    self.assertIn(phrase, card["body"])
                world = next(w for w in self.current if w["genre"] == genre)
                self.assertEqual(card["body"], next(c["body"] for c in world["cards"] if c["title"] == card["title"]))
        fiction = catalog.read(catalog.ROOT / "cthulhu_mythos/source/tradition-cards.json")
        expected = {"angell-papers": "6c564077ec876212399990342cfd57f7fa9dda5100c08928ad7f4ad4a90ab904",
                    "johansen-manuscript": "4518557c9272d39714b2dd2a1be5c6791470f89e6b3cb12bfb274f5f741fcd04"}
        by_key = {card["key"]: card for card in fiction["cards"]}
        for key, digest in expected.items():
            self.assertEqual(digest, hashlib.sha256(by_key[key]["body"].encode()).hexdigest())

    def test_public_text_does_not_point_to_removed_translations(self):
        obsolete = ("원고는", "한국어 중역", "한국어로 중역", "한국어 완역", "완역과", "한국어 전문", "중역하여", "전체를 직접 한국어로 옮겼다")
        for genre in catalog.TRADITIONS:
            with self.subTest(genre=genre):
                source = catalog.ROOT / genre / "source"
                data = catalog.read(source / "tradition-cards.json")
                template = catalog.read(source / "template.json")
                world = next(w for w in self.current if w["genre"] == genre)
                for text in (data["scope"], world["description"], template["setting_bible"]["introduction_markdown"]):
                    for phrase in obsolete:
                        self.assertNotIn(phrase, text)
                for card, section in zip(data["cards"], template["setting_bible"]["sections"]):
                    self.assertEqual(card["body"], section["content_markdown"])
                    if genre == "greco_roman_mythology":
                        self.assertNotIn("원문 파일의 행 표지", card["body"])
                    if genre == "journey_to_the_west" and card["key"] == "text":
                        self.assertNotIn("한국어 전문", card["body"])
                    if genre == "indian_mythology" and card["key"] == "adhyatma_and_related_terms":
                        self.assertNotIn("전문에 대괄호", card["body"])

    def test_tradition_sources_keep_locations_without_translation_or_evidence(self):
        for genre in catalog.TRADITIONS:
            with self.subTest(genre=genre):
                source = catalog.ROOT / genre / "source"
                data = catalog.read(source / "tradition-cards.json")
                template = catalog.read(source / "template.json")
                self.assertEqual({"genre", "name", "scope", "sources", "cards", "narrative"}, set(data))
                self.assertEqual({"id", "genre_id", "genre_name", "order", "title", "setting_bible"}, set(template))
                self.assertEqual({"title", "introduction_markdown", "sections"}, set(template["setting_bible"]))
                self.assertNotIn("original.md", template["setting_bible"]["introduction_markdown"])
                self.assertEqual({"template.json", "tradition-cards.json", "sources.md"} |
                                 ({"supplementary.md"} if catalog.read_supplementary(genre) is not None else set()),
                                 {path.name for path in source.iterdir()})
                self.assertFalse((source / "original.md").exists())
                self.assertNotIn("content_markdown", template)
                self.assertEqual("sources.md", data["narrative"])
                catalog.validate_narrative(data, (source / "sources.md").read_text(encoding="utf-8"),
                                           catalog.read_supplementary(genre))
                for card, section in zip(data["cards"], template["setting_bible"]["sections"]):
                    self.assertEqual({"key", "title", "cardType", "body", "narrative_refs"} | ({"soul"} if card["cardType"] == "character" else set()), set(card))
                    self.assertEqual({"id", "order", "title", "content_markdown", "template_part", "card_type", "narrative_refs"}, set(section))
                    self.assertEqual(card["narrative_refs"], section["narrative_refs"])
                    for ref in card["narrative_refs"]:
                        self.assertEqual({"document", "section"} | ({"excerpt_sha256"} if ref["document"] == "supplementary.md" else set()), set(ref))

    def test_original_eleven_frozen_resources_are_unchanged(self):
        expected = "333e2e2f970881ab2533312ec5c523e74f70cccf0c1f33bc356b274c22c538b8"
        records = catalog.read(catalog.RESOURCES / "genre-templates-v1.json")
        digest = hashlib.sha256(json.dumps(records, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        self.assertEqual(expected, digest)
        self.assertEqual(list(catalog.LEGACY), [t["genre"] for t in catalog.read(catalog.RESOURCES / "genre-templates-v1.json")])

    def test_runtime_catalog_is_reproducible_and_preserves_frozen_worlds(self):
        frozen_path = catalog.RESOURCES / "genre-templates-v2.json"
        self.assertEqual("4699939f749f45dc0958f7c908955ade6e9ea91ab8ed9ab55860251831aa9517", hashlib.sha256(frozen_path.read_bytes()).hexdigest())
        frozen = catalog.read(frozen_path)
        without_soul = [{**world, "cards": [{k: v for k, v in card.items() if k != "soul"} for card in world["cards"]]} for world in self.current[:26]]
        self.assertEqual(frozen, without_soul)
        self.assertEqual(self.current, catalog.build(self.current))
        self.assertEqual(list(catalog.LEGACY + catalog.TRADITIONS), [t["genre"] for t in self.current[:26]])
        history = [catalog.load_history(catalog.ROOT / "history" / (country + ".world.json")) for country in catalog.HISTORY]
        history_bytes = json.dumps(history, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        self.assertEqual("fe26493096498e93154404f31ba9a749164889c3bcd7a6aa71ae8c5b03ab84d5", hashlib.sha256(history_bytes).hexdigest())
        self.assertEqual((26, 1254, 379), (len(self.current), sum(len(w["cards"]) for w in self.current), sum(c["cardType"] == "character" for w in self.current for c in w["cards"])))
        self.assertEqual(catalog.build(self.current), catalog.build(catalog.build(self.current)))

    def test_original_source_urls_and_migrated_locations_are_unchanged(self):
        sources = {g: catalog.read(catalog.ROOT / g / "source/tradition-cards.json")["sources"] for g in catalog.TRADITIONS}
        indexes = {g: (catalog.ROOT / g / "source/sources.md").read_text(encoding="utf-8") for g in catalog.TRADITIONS}
        digest = lambda obj: hashlib.sha256(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        self.assertEqual("e2a9ac512120ae23ff9d541f383b2370eeb9879578c319de3e532d9d371a5208", digest(sources))
        self.assertEqual("8686ca514812153f499341b817e0ee0db48f90e6f449d196ecdd7a141a44cbbe", digest(indexes))

    def test_source_documents_match_cards_without_creative_scaffold(self):
        for genre in catalog.TRADITIONS:
            directory = catalog.ROOT / genre / "source"
            data = catalog.read(directory / "tradition-cards.json")
            template = catalog.read(directory / "template.json")
            self.assertNotIn("basic_template", template, genre)
            self.assertNotIn("content_markdown", template, genre)
            sections = template["setting_bible"]["sections"]
            self.assertEqual(len(data["cards"]), len(sections), genre)
            for card, section in zip(data["cards"], sections):
                self.assertEqual(card["title"], section["title"], genre)
                self.assertEqual(card["body"], section["content_markdown"], genre)
                self.assertEqual(card["cardType"], section["card_type"], genre)
                self.assertNotIn("도입 예시", section["template_part"], genre)
            self.assertTrue(data["sources"], genre)

    def test_source_refs_resolve_without_translation_and_card_bodies_are_distinct(self):
        for genre in catalog.TRADITIONS:
            with self.subTest(genre=genre):
                directory = catalog.ROOT / genre / "source"
                data = catalog.read(directory / "tradition-cards.json")
                template = catalog.read(directory / "template.json")
                catalog.validate_narrative(data, (directory / "sources.md").read_text(encoding="utf-8"), catalog.read_supplementary(genre))
                bodies = [c["body"].split("\n\n출전:", 1)[0].strip() for c in data["cards"]]
                self.assertEqual(len(bodies), len(set(bodies)), "duplicate worldbuilding bodies")
                for card, section in zip(data["cards"], template["setting_bible"]["sections"]):
                    self.assertEqual(card["narrative_refs"], section["narrative_refs"])
                    self.assertNotIn("evidence", str(card["narrative_refs"]))

    def test_build_rejects_cards_without_a_narrative(self):
        real_read = catalog.read
        def without_narrative(path):
            data = real_read(path)
            if path.name == "tradition-cards.json":
                data.pop("narrative", None)
            return data
        with patch.object(catalog, "LEGACY", ()), patch.object(catalog, "read", side_effect=without_narrative):
            with self.assertRaises(AssertionError):
                catalog.build(self.current)

    def test_bad_card_type_and_duplicate_keys_are_rejected(self):
        real_read = catalog.read
        for mutation in ("type", "duplicate"):
            def modified(path):
                data = real_read(path)
                if path.name == "tradition-cards.json":
                    if mutation == "type":
                        data["cards"][0]["cardType"] = "unsupported"
                    else:
                        data["cards"].append(data["cards"][0])
                return data
            with patch.object(catalog, "LEGACY", ()), patch.object(catalog, "read", side_effect=modified):
                with self.assertRaises(AssertionError):
                    catalog.build(self.current)

    def test_build_rejects_invalid_source_and_card_links(self):
        real_read = catalog.read
        for mutation in ("source", "card"):
            def modified(path):
                data = real_read(path)
                if path.name == "tradition-cards.json":
                    if mutation == "source":
                        data["sources"][0]["url"] = "https://"
                    else:
                        data["cards"][0]["body"] = "출전: https://"
                return data
            with self.subTest(mutation=mutation), patch.object(catalog, "LEGACY", ()), patch.object(catalog, "read", side_effect=modified):
                with self.assertRaises(AssertionError):
                    catalog.build(self.current)

    def test_build_reads_supplementary_next_to_original(self):
        genre = "egyptian_mythology"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / genre / "source"
            shutil.copytree(catalog.ROOT / genre / "source", source)
            data = catalog.read(source / "tradition-cards.json")
            data["cards"].append({
                "key": "supplement-test", "title": "보충 카드", "cardType": "event",
                "body": "보충 출전에서 가져온 사건.\n\n출전: [예시](https://example.test/x).",
                "narrative_refs": [{"document": "supplementary.md", "section": "supp-1", "excerpt_sha256": hashlib.sha256("원어 발췌".encode()).hexdigest()}],
            })
            (source / "tradition-cards.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            supplementary = source / "supplementary.md"
            with supplementary.open("a", encoding="utf-8") as file:
                file.write('\n<a id="supp-1"></a>\n\nURL: https://example.test/x\n> 원어 발췌\n')
            with patch.object(catalog, "ROOT", root), patch.object(catalog, "LEGACY", ()), patch.object(catalog, "TRADITIONS", (genre,)), patch.object(catalog, "HISTORY", ()):
                built = catalog.build(self.current)
                self.assertEqual("보충 카드", built[-1]["cards"][-1]["title"])
                supplementary.unlink()  # 문서가 없으면 같은 카드가 거절된다
                with self.assertRaises(AssertionError):
                    catalog.build(self.current)

    def test_variant_cards_in_every_tradition_cite_each_source(self):
        for genre in catalog.TRADITIONS:
            data = catalog.read(catalog.ROOT / genre / "source/tradition-cards.json")
            cards = data["cards"]
            original = (catalog.ROOT / genre / "source/sources.md").read_text(encoding="utf-8-sig")
            documents = {"sources.md": catalog.anchor_sections(original, "sources.md")}
            supplementary = catalog.read_supplementary(genre)
            if supplementary is not None:
                documents["supplementary.md"] = catalog.anchor_sections(supplementary, "supplementary.md")
            with self.subTest(genre=genre):
                self.assertEqual({}, {c["title"]: problems for c in cards if (problems := variant_problems(c, documents))})


class NarrativeDocumentsTest(unittest.TestCase):
    SOURCE = '<a id="creation"></a>\n위치: 제1장\nURL: https://example.test/original\n'
    SUPPLEMENTARY = '<a id="supp-1"></a>\n위치: 제2장\nURL: https://example.test/supp\n> 원어 발췌\n'
    ORIGINAL_REF = {"document": "sources.md", "section": "creation"}
    SUPP_REF = {"document": "supplementary.md", "section": "supp-1", "excerpt_sha256": hashlib.sha256("원어 발췌".encode()).hexdigest()}

    def validate(self, refs, source=SOURCE, supplementary=SUPPLEMENTARY, narrative="sources.md"):
        catalog.validate_narrative({"narrative": narrative, "cards": [{"title": "Card", "narrative_refs": refs}]}, source, supplementary)

    def test_both_documents_resolve(self):
        self.validate([self.ORIGINAL_REF, self.SUPP_REF])
        self.validate([self.ORIGINAL_REF], supplementary=None)

    def test_missing_or_invalid_refs_are_rejected(self):
        for refs in ([], [{**self.ORIGINAL_REF, "document": "../sources.md"}],
                     [{**self.ORIGINAL_REF, "section": "missing"}],
                     [{**self.ORIGINAL_REF, "evidence": "번역 문단"}],
                     [{**self.SUPP_REF, "excerpt_sha256": "bad"}]):
            with self.subTest(refs=refs), self.assertRaises(AssertionError):
                self.validate(refs)
        with self.assertRaises(AssertionError):
            self.validate([self.SUPP_REF], supplementary=None)
        with self.assertRaises(AssertionError):
            self.validate([self.ORIGINAL_REF], narrative="original.md")

    def test_source_url_location_and_unique_anchors_are_required(self):
        for source in (self.SOURCE.replace("https://example.test/original", "https://"),
                       self.SOURCE.replace("위치: 제1장", "위치:"),
                       self.SOURCE + self.SOURCE, "no anchor"):
            with self.subTest(source=source), self.assertRaises(AssertionError):
                self.validate([self.ORIGINAL_REF], source=source)
        with self.assertRaises(AssertionError):
            self.validate([self.SUPP_REF], supplementary=self.SUPPLEMENTARY.replace("원어 발췌", "변경된 발췌"))
        with self.assertRaises(AssertionError):
            self.validate([self.SUPP_REF], supplementary=self.SUPPLEMENTARY.replace("https://example.test/supp", "https://"))

    def test_supplementary_excerpt_is_required_and_limited_to_500_characters(self):
        for value, accepted in (("가" * 500, True), ("가" * 501, False), ("https://example.test/supp", False)):
            ref = {**self.SUPP_REF, "excerpt_sha256": hashlib.sha256(value.encode()).hexdigest()}
            document = self.SUPPLEMENTARY.replace("원어 발췌", value)
            with self.subTest(length=len(value)):
                if accepted:
                    self.validate([ref], supplementary=document)
                else:
                    with self.assertRaises(AssertionError):
                        self.validate([ref], supplementary=document)


class VariantRuleTest(unittest.TestCase):
    """이설: '이설'이라고 쓴 카드만 출처별 근거를 요구한다. 모든 전승에 이설이 있다고 가정하지 않는다."""
    A = {"document": "sources.md", "section": "a"}
    B = {"document": "supplementary.md", "section": "b"}
    TWO_SOURCES = "이설: 두 전승이 갈린다.\n\n출전: [가](https://a.test/x#1), [나](https://b.test/y)."
    DOCUMENTS = {"sources.md": {"a": "https://a.test/x#1 x"},
                 "supplementary.md": {"b": "https://b.test/y y"}}
    DISTINCT = "이설:\n- [가](https://a.test/x#1): 영웅이 바다에서 죽었다고 전한다.\n- [나](https://b.test/y): 영웅이 고향에서 죽었다고 전한다."

    def card(self, body, refs):
        return {"title": "오디세우스의 죽음", "body": body, "narrative_refs": refs}

    def test_variant_card_needs_distinct_evidence_and_sources(self):
        self.assertEqual([], variant_problems(self.card(self.DISTINCT, [self.A, self.B]), self.DOCUMENTS))
        same_page = "이설: 갈린다.\n\n출전: [가](https://a.test/x#1), [가](https://a.test/x#2)."
        for body, refs in ((self.TWO_SOURCES, [self.A]), (self.TWO_SOURCES, [self.A, dict(self.A)]), (same_page, [self.A, self.B])):
            with self.subTest(body=body[:12], refs=len(refs)):
                self.assertTrue(variant_problems(self.card(body, refs), self.DOCUMENTS))
        self.assertTrue(variant_problems(self.card(self.DISTINCT, [self.A, self.B]), {"sources.md": self.DOCUMENTS["sources.md"]}))

    def test_uncited_source_list_cannot_supply_a_variant_reference(self):
        docs = {"sources.md": {"a": "https://a.test/x", "a2": "https://a.test/x"},
                "original_sources": {"https://a.test/x", "https://b.test/y"}}
        refs = [self.A, {"document": "sources.md", "section": "a2"}]
        self.assertTrue(variant_problems(self.card(self.DISTINCT, refs), docs))

    def test_cards_without_variants_are_not_required_to_have_them(self):
        plain = "한 출전만 쓴다.\n\n출전: [가](https://a.test/x)."
        self.assertEqual([], variant_problems(self.card(plain, [self.A])))

    def test_generic_claim_is_not_a_source_by_source_difference(self):
        self.assertTrue(variant_problems(self.card(self.TWO_SOURCES, [self.A, self.B])))


if __name__ == "__main__":
    unittest.main()
