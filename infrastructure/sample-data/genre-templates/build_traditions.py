"""Validate narrative references and rebuild cards; preserve eleven released genres.

Run from any directory with Python 3: python build_traditions.py [--check].
This prepares local JSON only. It never connects to a database or server.
"""
import argparse
import json
import re
from pathlib import Path
from uuid import UUID, NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parent
RESOURCES = ROOT.parents[2] / "backend/content-service/src/main/resources"
LEGACY = (
    "wuxia", "romance_fantasy", "modern_fantasy", "science_fiction",
    "alternate_history", "game_fantasy", "fusion_fantasy",
    "territory_management", "apocalypse", "sports_fantasy", "entertainment",
)
TRADITIONS = (
    "sumerian_mythology", "cthulhu_mythos", "norse_mythology",
    "greco_roman_mythology", "germanic_folklore", "chinese_folklore",
    "japanese_mythology", "korean_mythology_fables", "egyptian_mythology",
    "indian_mythology", "celtic_mythology", "slavic_mythology",
    "maya_mythology", "aztec_mythology", "journey_to_the_west",
)
TYPES = {"character", "location", "organization", "ability", "object", "rule", "event", "other"}
MAX_SUPPLEMENTARY_EVIDENCE = 500  # supplementary.md의 발췌는 짧은 인용이다(글자 수)


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_supplementary(genre):
    """source/supplementary.md의 글. 없는 장르는 None."""
    path = ROOT / genre / "source/supplementary.md"
    return path.read_text(encoding="utf-8-sig") if path.exists() else None


def anchor_sections(text, name):
    parts = re.split(r'<a id="([a-z0-9-]+)"></a>', text)
    anchors = parts[1::2]
    assert anchors and len(anchors) == len(set(anchors)), name + ": missing/duplicate narrative anchors"
    return dict(zip(anchors, parts[2::2]))


def validate_narrative(data, text, supplementary=None):
    """Check editorial traceability, not automatic factual entailment.

    A ref's document is original.md unless it says supplementary.md, which holds sources the single original
    does not cover (a short excerpt under an anchor that also gives the source URL). Documents are looked up
    by exact name; the ref never builds a path.
    """
    assert data.get("narrative") == "original.md", "narrative must be the local source document"
    documents = {"original.md": anchor_sections(text, "original.md")}
    if supplementary is not None:
        documents["supplementary.md"] = anchor_sections(supplementary, "supplementary.md")
    for card in data["cards"]:
        refs = card.get("narrative_refs")
        assert refs, card["title"] + ": missing narrative evidence"
        for ref in refs:
            document = ref.get("document", "original.md")
            assert isinstance(document, str) and document in documents, card["title"] + ": unknown narrative document"
            assert ref["section"] in documents[document], card["title"] + ": unknown narrative section"
            section = documents[document][ref["section"]]
            assert ref["evidence"].strip() and ref["evidence"] in section, card["title"] + ": stale evidence"
            if document == "supplementary.md":
                urls = re.findall(r"https?://[^\s)\]]+", section)
                assert any(re.match(r"https?://[^/\s.]+(?:\.[^/\s.]+)+", url) for url in urls), card["title"] + ": supplementary section has no source URL"
                assert not any(ref["evidence"] in url for url in urls), card["title"] + ": excerpt is a URL"
                assert len(ref["evidence"]) <= MAX_SUPPLEMENTARY_EVIDENCE, card["title"] + ": supplementary excerpt too long"


def build(current):
    """Keep published entries/IDs; derive stable semantic IDs for new cards."""
    by_genre = {item["genre"]: item for item in current}
    result = [by_genre[genre] for genre in LEGACY]
    for genre in TRADITIONS:
        data = read(ROOT / genre / "source/tradition-cards.json")
        assert data["genre"] == genre and data["sources"], genre
        validate_narrative(data, (ROOT / genre / "source/original.md").read_text(encoding="utf-8-sig"),
                           read_supplementary(genre))
        world_id = by_genre.get(genre, {}).get("worldId") or str(uuid5(
            NAMESPACE_URL, "storyfork:tradition:" + genre))
        cards = []
        keys = set()
        for card in data["cards"]:
            assert card["key"] and card["key"] not in keys, genre
            keys.add(card["key"])
            assert card["cardType"] in TYPES, card["title"]
            assert 0 < len(card["title"]) <= 200, card["title"]
            assert 0 < len(card["body"]) <= 3000, card["title"]
            assert "http" in card["body"], card["title"]
            cards.append({
                "id": str(uuid5(UUID(world_id), "tradition:" + card["key"])),
                "title": card["title"], "body": card["body"],
                "cardType": card["cardType"],
            })
        assert cards and any(c["cardType"] == "event" for c in cards), genre
        result.append({"genre": genre, "worldId": world_id, "name": data["name"],
                       "description": data["scope"], "cards": cards})
    ids = [t["worldId"] for t in result] + [c["id"] for t in result for c in t["cards"]]
    assert len(ids) == len(set(ids)), "duplicate world/card ID"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare only; do not write")
    args = parser.parse_args()
    path = RESOURCES / "genre-templates.json"
    current = read(path)
    result = build(current)
    if args.check:
        assert current == result, "genre-templates.json is stale; run build_traditions.py"
        legacy = read(RESOURCES / "genre-templates-v1.json")
        assert [t["genre"] for t in legacy] == list(LEGACY), "v1 must contain only released eleven"
        print(f"OK: {len(result)} worlds, {sum(len(t['cards']) for t in result)} cards")
    else:
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
