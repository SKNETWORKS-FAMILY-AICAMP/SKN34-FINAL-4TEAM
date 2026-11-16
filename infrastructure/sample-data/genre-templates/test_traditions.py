"""Focused data contract tests; no database, network or application startup."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
import unittest
from unittest.mock import patch
import build_traditions as catalog


def variant_problems(card, documents=None):
    """'이설'이라고 쓴 카드는 출처별로 갈리는 근거를 보여야 한다. 쓰지 않은 카드에는 아무것도 요구하지 않는다."""
    if "이설" not in card["title"] + card["body"]:
        return []
    sections = {(ref.get("document", "original.md"), ref["section"]) for ref in card["narrative_refs"]}
    # 각 출전 링크와 설명이 같은 줄에 있어야 출처별 주장을 구분할 수 있다.
    claims = re.findall(r"(?m)^\s*[-*]\s*\[([^\]]+)\]\((https?://[^)]+)\)\s*:\s*(.+)$", card["body"])
    cited = set()
    for document, section in sections:
        text = (documents or {}).get(document, {}).get(section, "")
        cited.update(url.split("#")[0] for url in re.findall(r"https?://[^\s)\]]+", text))
        if document == "original.md":
            cited.update((documents or {}).get("original_sources", set()))
    supported = [(url.split("#")[0], claim.strip()) for _, url, claim in claims
                 if len(claim.strip()) >= 10 and url.split("#")[0] in cited]
    return (["서로 다른 근거 절이 2개 이상 필요하다"] if len(sections) < 2 else []) + \
        (["근거 절에 연결된 서로 다른 출전별 설명이 2개 이상 필요하다"]
         if len({url for url, _ in supported}) < 2 or len({claim for _, claim in supported}) < 2 else [])


class TraditionCatalogTest(unittest.TestCase):
    def setUp(self):
        self.current = catalog.read(catalog.RESOURCES / "genre-templates.json")

    def test_original_eleven_are_unchanged_in_current_and_frozen_resources(self):
        expected = "333e2e2f970881ab2533312ec5c523e74f70cccf0c1f33bc356b274c22c538b8"
        for name in ("genre-templates.json", "genre-templates-v1.json"):
            records = catalog.read(catalog.RESOURCES / name)[:11]
            digest = hashlib.sha256(json.dumps(records, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            self.assertEqual(expected, digest, name)
        self.assertEqual(list(catalog.LEGACY), [t["genre"] for t in catalog.read(catalog.RESOURCES / "genre-templates-v1.json")])

    def test_runtime_catalog_is_reproducible_and_includes_all_fifteen_traditions(self):
        self.assertEqual(self.current, catalog.build(self.current))
        self.assertEqual(list(catalog.LEGACY + catalog.TRADITIONS), [t["genre"] for t in self.current])
        self.assertEqual(catalog.build(self.current), catalog.build(catalog.build(self.current)))

    def test_source_documents_match_cards_without_creative_scaffold(self):
        for genre in catalog.TRADITIONS:
            directory = catalog.ROOT / genre / "source"
            data = catalog.read(directory / "tradition-cards.json")
            template = catalog.read(directory / "template.json")
            self.assertNotIn("basic_template", template, genre)
            self.assertEqual(template["content_markdown"], (directory / "original.md").read_text(encoding="utf-8-sig"), genre)
            sections = template["setting_bible"]["sections"]
            self.assertEqual(len(data["cards"]), len(sections), genre)
            for card, section in zip(data["cards"], sections):
                self.assertEqual(card["title"], section["title"], genre)
                self.assertEqual(card["body"], section["content_markdown"], genre)
                self.assertEqual(card["cardType"], section["card_type"], genre)
                self.assertNotIn("도입 예시", section["template_part"], genre)
            self.assertTrue(data["sources"], genre)

    def test_narrative_references_are_required_and_resolve_to_exact_evidence(self):
        text = '<a id="creation"></a>\n\n## Creation\n\nThe world is formed from the first beings.\n'
        data = {"narrative": "original.md", "cards": [{
            "title": "Creation", "narrative_refs": [{
                "section": "creation", "evidence": "The world is formed from the first beings."
            }]
        }]}
        catalog.validate_narrative(data, text)
        for bad in ([], [{"section": "missing", "evidence": "The world"}],
                    [{"section": "creation", "evidence": "Not in the narrative"}]):
            data["cards"][0]["narrative_refs"] = bad
            with self.assertRaises(AssertionError):
                catalog.validate_narrative(data, text)

    def test_all_tradition_cards_are_derived_from_separate_narratives(self):
        narratives = []
        for genre in catalog.TRADITIONS:
            with self.subTest(genre=genre):
                directory = catalog.ROOT / genre / "source"
                data = catalog.read(directory / "tradition-cards.json")
                self.assertEqual("original.md", data["narrative"])
                narrative = (directory / "original.md").read_text(encoding="utf-8")
                catalog.validate_narrative(data, narrative, catalog.read_supplementary(genre))
                template = catalog.read(directory / "template.json")
                for card, section in zip(data["cards"], template["setting_bible"]["sections"]):
                    self.assertEqual(card["narrative_refs"], section["narrative_refs"])
                self.assertGreater(len(narrative), 3000)
                self.assertNotEqual(narrative, "\n\n".join(c["body"] for c in data["cards"]))
                narratives.append(narrative)
        self.assertEqual(len(catalog.TRADITIONS), len(set(narratives)))

    def test_worldbuilding_cards_are_distinct_extractions_not_copied_paragraphs(self):
        for genre in catalog.TRADITIONS:
            with self.subTest(genre=genre):
                data = catalog.read(catalog.ROOT / genre / "source/tradition-cards.json")
                bodies = [c["body"].split("\n\n출전:", 1)[0].strip() for c in data["cards"]]
                self.assertEqual(len(bodies), len(set(bodies)), "duplicate worldbuilding bodies")
                for card, body in zip(data["cards"], bodies):
                    evidence = [ref["evidence"].strip() for ref in card.get("narrative_refs", [])]
                    self.assertNotIn(body, evidence, card["title"] + ": copied narrative instead of extraction")

    def test_build_rejects_cards_without_a_narrative(self):
        real_read = catalog.read
        def without_narrative(path):
            data = real_read(path)
            if path.name == "tradition-cards.json":
                data.pop("narrative", None)
            return data
        with patch.object(catalog, "read", side_effect=without_narrative):
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
            with patch.object(catalog, "read", side_effect=modified):
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
                "narrative_refs": [{"document": "supplementary.md", "section": "supp-1", "evidence": "원어 발췌"}],
            })
            (source / "tradition-cards.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            supplementary = source / "supplementary.md"
            with supplementary.open("a", encoding="utf-8") as file:
                file.write('\n<a id="supp-1"></a>\n\nURL: https://example.test/x\n원어 발췌\n')
            with patch.object(catalog, "ROOT", root), patch.object(catalog, "TRADITIONS", (genre,)):
                built = catalog.build(self.current)
                self.assertEqual("보충 카드", built[-1]["cards"][-1]["title"])
                supplementary.unlink()  # 문서가 없으면 같은 카드가 거절된다
                with self.assertRaises(AssertionError):
                    catalog.build(self.current)

    def test_variant_cards_in_every_tradition_cite_each_source(self):
        for genre in catalog.TRADITIONS:
            data = catalog.read(catalog.ROOT / genre / "source/tradition-cards.json")
            cards = data["cards"]
            original = (catalog.ROOT / genre / "source/original.md").read_text(encoding="utf-8-sig")
            documents = {"original.md": catalog.anchor_sections(original, "original.md")}
            documents["original_sources"] = {source["url"].split("#")[0] for source in data["sources"]}
            supplementary = catalog.read_supplementary(genre)
            if supplementary is not None:
                documents["supplementary.md"] = catalog.anchor_sections(supplementary, "supplementary.md")
            with self.subTest(genre=genre):
                self.assertEqual({}, {c["title"]: problems for c in cards if (problems := variant_problems(c, documents))})


class NarrativeDocumentsTest(unittest.TestCase):
    """original.md 말고 source/supplementary.md도 근거 문서로 쓸 수 있다. 합성 문서로 규칙만 확인한다."""
    ORIGINAL = '<a id="creation"></a>\n\n## Creation\n\nThe world is formed from the first beings.\n'
    SUPPLEMENTARY = (
        '# 보충 출전\n\n'
        '<a id="iliad-1-1"></a>\n\n## 일리아스 1.1\n\nURL: https://example.test/iliad\n장절: Iliad 1.1\n원어: μῆνιν ἄειδε θεὰ\n\n'
        '<a id="iliad-2-1"></a>\n\n## 일리아스 2.1\n\nURL: https://example.test/iliad\n장절: Iliad 2.1\n원어: ἄλλοι μέν ῥα θεοί\n'
    )
    ORIGINAL_REF = {"section": "creation", "evidence": "The world is formed from the first beings."}
    SUPP_1 = {"document": "supplementary.md", "section": "iliad-1-1", "evidence": "μῆνιν ἄειδε θεὰ"}
    SUPP_2 = {"document": "supplementary.md", "section": "iliad-2-1", "evidence": "ἄλλοι μέν ῥα θεοί"}

    def validate(self, *cards, supplementary=SUPPLEMENTARY, narrative="original.md"):
        data = {"narrative": narrative, "cards": [
            {"title": "Card %d" % i, "narrative_refs": refs} for i, refs in enumerate(cards)]}
        catalog.validate_narrative(data, self.ORIGINAL, *(() if supplementary is None else (supplementary,)))

    def rejected(self, *cards, **kwargs):
        with self.assertRaises(AssertionError):
            self.validate(*cards, **kwargs)

    def test_cards_may_cite_original_and_supplementary_documents(self):
        self.validate([self.ORIGINAL_REF, self.SUPP_1],  # 복수 출처
                      [self.SUPP_1, self.SUPP_2],  # 보충 출처만
                      [self.ORIGINAL_REF],  # 기존 형식: document가 없으면 original.md
                      [{**self.ORIGINAL_REF, "document": "original.md"}])
        self.validate([self.ORIGINAL_REF], supplementary=None)  # 보충 문서가 없는 기존 장르

    def test_unknown_unavailable_or_escaping_documents_are_rejected(self):
        for document in ("other.md", "../original.md", "/etc/passwd", "source/supplementary.md",
                         "supplementary.md/..", "SUPPLEMENTARY.md", "", None, ["supplementary.md"]):
            with self.subTest(document=document):
                self.rejected([{**self.ORIGINAL_REF, "document": document}], supplementary=None)
                self.rejected([{**self.ORIGINAL_REF, "document": document}])
                self.rejected([{**self.SUPP_1, "document": document}])
        self.rejected([self.SUPP_1], supplementary=None)  # supplementary.md가 없는 장르

    def test_anchor_and_excerpt_must_belong_to_the_cited_document(self):
        for ref in (
            {**self.SUPP_1, "section": "missing"},  # 없는 앵커
            {**self.SUPP_1, "evidence": self.SUPP_2["evidence"]},  # 다른 앵커의 발췌
            {**self.SUPP_1, "evidence": "not in any document"},  # 없는 발췌
            {**self.SUPP_1, "evidence": "  "},  # 빈 발췌
            {**self.SUPP_1, "evidence": self.ORIGINAL_REF["evidence"]},  # original.md 문장을 보충 근거로 인용
            {"section": "iliad-1-1", "evidence": self.SUPP_1["evidence"]},  # document를 생략하면 original.md다
            {**self.ORIGINAL_REF, "document": "supplementary.md"},  # 보충 문서에 original.md 앵커를 인용
        ):
            with self.subTest(ref=ref):
                self.rejected([ref])

    def test_supplementary_needs_unique_anchors_and_a_source_url(self):
        no_url = self.SUPPLEMENTARY.replace("https://example.test/iliad", "출전 없음")
        duplicate = self.SUPPLEMENTARY + '<a id="iliad-1-1"></a>\n\nURL: https://example.test/iliad\n'
        for text in (no_url, duplicate, "# 앵커 없는 보충 문서\n"):
            with self.subTest(text=text[:24]):
                self.rejected([self.SUPP_1], supplementary=text)
        for broken in (duplicate, "# 앵커 없는 보충 문서\n"):
            self.rejected([self.ORIGINAL_REF], supplementary=broken)  # 인용하지 않아도 깨진 문서는 거절한다

    def test_source_url_and_excerpt_cannot_be_empty_or_the_same(self):
        for text, evidence in (
            ('<a id="iliad-1-1"></a>\nhttps://\nμῆνιν', 'μῆνιν'),
            ('<a id="iliad-1-1"></a>\nhttps://example.test/source', 'https://example.test/source'),
        ):
            with self.subTest(text=text):
                self.rejected([{**self.SUPP_1, 'evidence': evidence}], supplementary=text)

    def test_supplementary_excerpts_stay_short(self):
        text = '<a id="long"></a>\n\nURL: https://example.test/\n' + "α" * (catalog.MAX_SUPPLEMENTARY_EVIDENCE + 1) + "\n"
        ref = {"document": "supplementary.md", "section": "long"}
        self.validate([{**ref, "evidence": "α" * catalog.MAX_SUPPLEMENTARY_EVIDENCE}], supplementary=text)
        self.rejected([{**ref, "evidence": "α" * (catalog.MAX_SUPPLEMENTARY_EVIDENCE + 1)}], supplementary=text)

    def test_narrative_stays_the_original_document(self):
        self.rejected([self.SUPP_1], narrative="supplementary.md")

    def test_original_document_keeps_its_anchor_rules(self):
        data = {"narrative": "original.md", "cards": [{"title": "Card", "narrative_refs": [self.ORIGINAL_REF]}]}
        for text in ("## 앵커 없는 원고\n", self.ORIGINAL + self.ORIGINAL):
            with self.subTest(text=text[:12]), self.assertRaises(AssertionError):
                catalog.validate_narrative(data, text)


class VariantRuleTest(unittest.TestCase):
    """이설: '이설'이라고 쓴 카드만 출처별 근거를 요구한다. 모든 전승에 이설이 있다고 가정하지 않는다."""
    A = {"section": "a", "evidence": "x"}
    B = {"document": "supplementary.md", "section": "b", "evidence": "y"}
    TWO_SOURCES = "이설: 두 전승이 갈린다.\n\n출전: [가](https://a.test/x#1), [나](https://b.test/y)."
    DOCUMENTS = {"original.md": {"a": "https://a.test/x#1 x"},
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
        self.assertTrue(variant_problems(self.card(self.DISTINCT, [self.A, self.B]), {"original.md": self.DOCUMENTS["original.md"]}))

    def test_cards_without_variants_are_not_required_to_have_them(self):
        plain = "한 출전만 쓴다.\n\n출전: [가](https://a.test/x)."
        self.assertEqual([], variant_problems(self.card(plain, [self.A])))

    def test_generic_claim_is_not_a_source_by_source_difference(self):
        self.assertTrue(variant_problems(self.card(self.TWO_SOURCES, [self.A, self.B])))


if __name__ == "__main__":
    unittest.main()
