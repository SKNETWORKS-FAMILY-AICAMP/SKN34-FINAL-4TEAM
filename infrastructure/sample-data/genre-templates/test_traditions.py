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
        if document == "sources.md":
            cited.update((documents or {}).get("original_sources", set()))
    supported = [(url.split("#")[0], claim.strip()) for _, url, claim in claims
                 if len(claim.strip()) >= 10 and url.split("#")[0] in cited]
    return (["서로 다른 근거 절이 2개 이상 필요하다"] if len(sections) < 2 else []) + \
        (["근거 절에 연결된 서로 다른 출전별 설명이 2개 이상 필요하다"]
         if len({url for url, _ in supported}) < 2 or len({claim for _, claim in supported}) < 2 else [])


class CreativeCardsTest(unittest.TestCase):
    WORLD = {"genre": "example", "worldId": "4fe1e070-e9f4-5d85-8923-c34da0b276e5", "name": "세계", "description": "설명", "cards": []}
    TEMPLATE = {"genre_id": "example", "setting_bible": {"sections": [{"id": "example_section_01"}]}}
    CARD = {"key": "hero", "title": "주인공", "body": "인물의 설정", "cardType": "character", "source_sections": ["example_section_01"]}

    def test_stable_ids_and_runtime_fields(self):
        data = {"genre": "example", "cards": [self.CARD]}
        world = catalog.build_creative_world(self.WORLD, data, self.TEMPLATE)
        self.assertEqual({**self.WORLD, "cards": [{
            "id": str(uuid5(UUID(self.WORLD["worldId"]), "setting:hero")),
            "title": "주인공", "body": "인물의 설정", "cardType": "character",
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
        with patch.object(catalog, "LEGACY", (genre,)), patch.object(catalog, "TRADITIONS", ()), patch.object(catalog, "read", side_effect=read):
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
                    self.assertEqual({"key", "title", "cardType", "body", "narrative_refs"}, set(card))
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

    def test_runtime_catalog_is_reproducible_and_includes_all_fifteen_traditions(self):
        runtime = (catalog.RESOURCES / "genre-templates.json").read_bytes()
        self.assertEqual("49a3a75f517ae461a42c0cc22d6d81b248af74b2e4d41a6338189b43ae2afe4a", hashlib.sha256(runtime).hexdigest())
        self.assertEqual(self.current, catalog.build(self.current))
        self.assertEqual(list(catalog.LEGACY + catalog.TRADITIONS), [t["genre"] for t in self.current])
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
            with patch.object(catalog, "ROOT", root), patch.object(catalog, "LEGACY", ()), patch.object(catalog, "TRADITIONS", (genre,)):
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
            documents["original_sources"] = {source["url"].split("#")[0] for source in data["sources"]}
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

    def test_cards_without_variants_are_not_required_to_have_them(self):
        plain = "한 출전만 쓴다.\n\n출전: [가](https://a.test/x)."
        self.assertEqual([], variant_problems(self.card(plain, [self.A])))

    def test_generic_claim_is_not_a_source_by_source_difference(self):
        self.assertTrue(variant_problems(self.card(self.TWO_SOURCES, [self.A, self.B])))


if __name__ == "__main__":
    unittest.main()
