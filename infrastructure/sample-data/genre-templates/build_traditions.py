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
STUDIO_ROOT = ROOT / "history/studio"
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
HISTORY = ("korea", "china", "japan", "england", "france", "italy", "usa")
TYPES = {"character", "location", "organization", "ability", "object", "rule", "event", "other"}
HISTORY_DESCRIPTIONS = {
    "c1af4125-5423-5633-a5da-822b4753df94": ("현대사 보완·서비스 반영 전 검토용.", "현대사 보완 대기 중인 비공개 연구 기반 샘플."),
    "67907b53-fdd0-5771-8d78-0f317a0f71b9": ("서비스·DB 반영 대상이 아니다.", "독립 검수 미완료인 비공개 연구 기반 샘플이다."),
    "936b9d62-a1de-59a2-b8e0-1d52327464de": ("현대사 확보·서비스 반영은 보류 상태다.", "현대사 확보는 보류 상태인 비공개 연구 기반 샘플이다."),
    "8c3a276f-dda5-5b5d-89da-55221ee3d710": ("현대 통사·전수 감수본·서비스 등록본이 아니다.", "현대 통사·전수 감수본이 아닌 비공개 연구 기반 샘플이다."),
    "b08b14fa-dc75-5e3b-8067-148fb6346c72": ("서비스·DB 등록 금지.", "독립 검수 미완료인 비공개 연구 기반 샘플이다."),
}
HISTORY_BODIES = {
    "2b354d59-bb5e-5515-8eeb-63270e9c12e8": ("연구용 신규 파일만 작성했으며 앱·DB·서비스 템플릿에는 반영하지 않는다.", "독립 검수 미완료인 연구 기반 샘플이다."),
    "29abc109-1de4-575a-aa6c-6ae29a4e0e39": ("연구용 파일만 만들며 서비스·DB에는 등록하지 않는다.", "검증되지 않은 연구 기반 샘플이다."),
    "84c432b7-7c72-5450-a0e0-9bff072b0420": ("현대 자료 신규 취득, 앱·DB 등록, 서비스 템플릿 수정, 커밋·푸시는 하지 않는다.", "현대 자료 신규 취득과 독립 역사 감수는 완료되지 않았다."),
    "4ff3552f-2aa0-5e95-88a8-5cf7d2c46e8b": ("창작 인물·가상 사건·대화·플롯을 추가하지 않았고 서비스 데이터에 반영하지 않았다.", "창작 인물·가상 사건·대화·플롯을 추가하지 않았으며 독립 검수 미완료인 연구 기반 샘플이다."),
    "26f85737-beba-591e-94fe-ae97b2773e53": ("[원문](https://www.gutenberg.org/cache/epub/17287/pg17287.txt)", "[원문](https://www.gutenberg.org/cache/epub/17287/pg17287.txt); [1장 초기 왕국, 원문 128–161행](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/france/source-en.txt#L128-L161); [프랑스-독일 전쟁, 원문 2668–2690행](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/france/source-en.txt#L2668-L2690)"),
    "b0057fb2-639c-53f9-8e9b-0cb0cc7c5802": ("[원문](https://archive.org/download/historyitaly00huntgoog/historyitaly00huntgoog_djvu.txt)", "[원문](https://archive.org/download/historyitaly00huntgoog/historyitaly00huntgoog_djvu.txt); [마지막 평가, 원문 11253–11262행](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/italy/hunt/source-en.txt#L11253-L11262)"),
    "0bef7a62-4958-5f89-8096-1b0dd60c1e59": ("짝인 usa.evidence.json과 usa.world.ko.md에", "usa.evidence.json에"),
}


def valid_url(url):
    try:
        parsed = urlsplit(url)
        return parsed.scheme in {"http", "https"} and bool(parsed.hostname and "." in parsed.hostname)
    except ValueError:
        return False


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def soul_field(card):
    if card["cardType"] != "character":
        assert "soul" not in card, card["title"]
        return {}
    soul = card.get("soul")
    assert isinstance(soul, str) and soul.strip() and len(soul.encode("utf-16-le")) // 2 <= 3000, card["title"]
    return {"soul": soul}


def load_history(path):
    world = read(path)
    UUID(world["worldId"])
    if world["worldId"] in HISTORY_DESCRIPTIONS:
        before, after = HISTORY_DESCRIPTIONS[world["worldId"]]
        assert world["description"].count(before) == 1, world["worldId"]
        world["description"] = world["description"].replace(before, after)
    for card in world["cards"]:
        if card["id"] in HISTORY_BODIES:
            before, after = HISTORY_BODIES[card["id"]]
            assert card["body"].count(before) == 1, card["id"]
            card["body"] = card["body"].replace(before, after)
    if world["worldId"] == "caa0b0e9-0305-566e-82ee-650f43aa464e":
        cards = [card for card in world["cards"] if card["id"] == "0bef7a62-4958-5f89-8096-1b0dd60c1e59"]
        assert len(cards) == 1, "미국 저작 표시 카드 누락"
        cards[0]["body"] += ("\n\n장별 기여자와 출처(저장소 병합 후 접근): "
                             "https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/develop/infrastructure/sample-data/genre-templates/history/usa.evidence.json"
                             "\n원전의 현행 장별 목록: https://www.americanyawp.com/"
                             "\n원전의 현행 기여자 목록: https://www.americanyawp.com/text/contributors/")
    validate_history(world)
    return world


def validate_history(world, optional_soul=False):
    assert world["genre"] and world["name"].strip() and len(world["name"].encode("utf-16-le")) // 2 <= 100 and len(world["description"].encode("utf-16-le")) // 2 <= 20000 and world["cards"]
    for card in world["cards"]:
        UUID(card["id"])
        assert card["cardType"] in TYPES
        for field, limit in (("title", 200), ("body", 3000)):
            assert isinstance(card[field], str) and card[field].strip() and len(card[field].encode("utf-16-le")) // 2 <= limit, card["id"]
        if not (optional_soul and card["cardType"] == "character" and "soul" not in card):
            soul_field(card)


def build_history_review(current):
    """Validate review-only cards without changing the runtime catalog or seed inputs."""
    expected = {f"{country}.world.json" for country in HISTORY}
    assert {path.name for path in STUDIO_ROOT.glob("*.world.json")} == expected, "missing or unexpected studio worlds"
    baseline = [load_history(ROOT / "history" / f"{country}.world.json") for country in HISTORY]
    result = [read(STUDIO_ROOT / f"{country}.world.json") for country in HISTORY]
    old_owner = {UUID(card["id"]): UUID(world["worldId"]) for world in baseline for card in world["cards"]}
    for old, world in zip(baseline, result):
        assert (world["worldId"], world["genre"]) == (old["worldId"], old["genre"]), world["genre"]
        assert set(world) == {"genre", "worldId", "name", "description", "cards"}
        assert len(world["cards"]) <= 1000
        validate_history(world, optional_soul=True)
        for card in world["cards"]:
            assert set(card) == {"id", "title", "body", "cardType"} | ({"soul"} if "soul" in card else set())
            assert old_owner.get(UUID(card["id"]), UUID(world["worldId"])) == UUID(world["worldId"]), card["id"]
    all_worlds = current + result
    ids = [UUID(world["worldId"]) for world in all_worlds] + [UUID(card["id"]) for world in all_worlds for card in world["cards"]]
    assert len(ids) == len(set(ids)), "duplicate world/card ID"
    return result


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
                      "title": card["title"], "body": card["body"], "cardType": card["cardType"], **soul_field(card)})
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
                "cardType": card["cardType"], **soul_field(card),
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
    parser.add_argument("--check-studio", action="store_true", help="validate review-only history cards; do not write")
    args = parser.parse_args()
    path = RESOURCES / "genre-templates.json"
    current = read(path)
    if args.check_studio:
        worlds = build_history_review(current)
        print(f"OK: {len(worlds)} review worlds, {sum(len(t['cards']) for t in worlds)} cards")
        return
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
