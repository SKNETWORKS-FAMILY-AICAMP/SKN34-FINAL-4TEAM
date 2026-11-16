"""Validate source references and rebuild creative and tradition cards.

Run from any directory with Python 3: python build_traditions.py [--check].
This prepares local JSON only. It never connects to a database or server.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
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


def valid_url(url):
    try:
        parsed = urlsplit(url)
        return parsed.scheme in {"http", "https"} and bool(parsed.hostname and "." in parsed.hostname)
    except ValueError:
        return False


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
    """Check source links and locations; they do not prove a card's claims."""
    assert data.get("narrative") == "sources.md", "narrative must be the source index"
    documents = {"sources.md": anchor_sections(text, "sources.md")}
    if supplementary is not None:
        documents["supplementary.md"] = anchor_sections(supplementary, "supplementary.md")
    for card in data["cards"]:
        refs = card.get("narrative_refs")
        assert refs, card["title"] + ": missing narrative evidence"
        for ref in refs:
            document = ref["document"]
            fields = {"document", "section"} | ({"excerpt_sha256"} if document == "supplementary.md" else set())
            assert set(ref) == fields, card["title"] + ": invalid source reference"
            assert isinstance(document, str) and document in documents, card["title"] + ": unknown narrative document"
            assert ref["section"] in documents[document], card["title"] + ": unknown narrative section"
            section = documents[document][ref["section"]]
            urls = re.findall(r"https?://[^\s\]]+", section)
            assert any(valid_url(url) for url in urls), card["title"] + ": section has no source URL"
            if document == "sources.md":
                assert re.search(r"(?m)^위치: \S", section), card["title"] + ": missing source location"
            else:
                excerpts = re.findall(r"(?m)^(?:>\s*|- 원어 발췌:\s*)(.+)$", section) + re.findall(r"`([^`]+)`", section)
                assert any(0 < len(excerpt) <= 500 and not valid_url(excerpt)
                           and hashlib.sha256(excerpt.encode()).hexdigest() == ref["excerpt_sha256"]
                           for excerpt in excerpts), card["title"] + ": missing or changed supplementary excerpt"


def build_creative_world(world, data, template):
    genre = world["genre"]
    assert data["genre"] == genre == template["genre_id"], genre
    sections = {section["id"] for section in template["setting_bible"]["sections"]}
    cards, keys = [], set()
    for card in data["cards"]:
        key = card["key"]
        assert isinstance(key, str) and re.fullmatch(r"[a-z0-9-]+", key) and key not in keys, genre
        keys.add(key)
        assert card["cardType"] in TYPES, key
        for field, limit in (("title", 200), ("body", 3000)):
            value = card[field]
            assert isinstance(value, str) and value.strip() and len(value.encode("utf-16-le")) // 2 <= limit, key
        refs = card["source_sections"]
        assert isinstance(refs, list) and refs and all(isinstance(ref, str) and ref in sections for ref in refs), key
        cards.append({"id": str(uuid5(UUID(world["worldId"]), "setting:" + key)),
                      "title": card["title"], "body": card["body"], "cardType": card["cardType"]})
    assert cards, genre
    return {**world, "cards": cards}


def build(current):
    """Keep world IDs and derive stable semantic IDs for cards."""
    by_genre = {item["genre"]: item for item in current}
    by_id = {item["worldId"]: item for item in current}
    frozen = {item["genre"]: item for item in read(RESOURCES / "genre-templates-v1.json")}
    result = []
    for genre in LEGACY:
        world = by_id[frozen[genre]["worldId"]]
        assert world["genre"] == genre, genre
        source = ROOT / genre / "source"
        result.append(build_creative_world(world, read(source / "setting-cards.json"), read(source / "template.json")))
    for genre in TRADITIONS:
        data = read(ROOT / genre / "source/tradition-cards.json")
        assert data["genre"] == genre and data["sources"], genre
        assert all(valid_url(source["url"]) for source in data["sources"]), genre + ": invalid source URL"
        validate_narrative(data, (ROOT / genre / "source/sources.md").read_text(encoding="utf-8-sig"),
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
            assert any(valid_url(url) for url in re.findall(r"https?://[^\s\]]+", card["body"])), card["title"]
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
