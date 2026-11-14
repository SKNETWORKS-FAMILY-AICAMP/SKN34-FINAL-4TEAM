"""시연 세계관(world.json)·원고·knowledge.md의 형식·회차 지식 계약과 seed.py의 적재 흐름을 확인하는 순수 단위 테스트다.

이 디렉터리(별빛 서약의 탑)와 하위 디렉터리마다 `world.json`이 있으면 그 데이터셋 하나가 TestCase 하나로 검사된다.
DB·네트워크·서버를 쓰지 않는다. 실행(저장소 루트에서):
    python3 -m unittest infrastructure/sample-data/simulation-demo/test_world.py
"""
import contextlib
import importlib.util
import io
import json
import math
import os
import re
import tempfile
import unittest
import unittest.mock
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("simulation_demo_seed", HERE / "seed.py")
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)

STARLIGHT_ID = "ba084057-8d94-3da5-86f0-ab54ce5703b0"  # infrastructure/sample-data/content/work.csv
STARLIGHT_EPISODES = 3  # starlight 원고는 1~3화(content/episode.csv). 이 디렉터리에는 원고 파일이 없다.
# Content WorldStudioService.validate·RelationshipInputHelper.merge와 같은 한도·허용 값
CARD_TYPES = {"character", "location", "organization", "ability", "object", "rule", "event", "other"}
AREAS = {"basic", "space", "history", "society", "culture", "special", "conflict"}
DOC_MAX = 3000
KEY = re.compile(r"^[a-z][a-z0-9-]*$")
EPISODE_KEY = re.compile(r"^(0|[1-9]\d*)$")  # frontend characterDocs.ts isEpisodeKey와 같은 규칙
# 화면(frontend studioRelations.ts relationDefinitions)이 읽을 수 있는 술어와 (category, direction)
UI_PREDICATES = {
    "custom_relation": ("structural", "symmetric"), "custom_relation_directed": ("structural", "directed"),
    "custom_emotion": ("emotional", "directed"), "wary_of": ("emotional", "directed"), "trusts": ("emotional", "directed"),
    "likes": ("emotional", "directed"), "hostile_to": ("emotional", "directed"),
}
# 화면이 카드 유형을 되읽는 규칙(cardTypeOf): 이 표와 어긋나면 화면이 응답을 거부한다
UI_KINDS = {"character": ("entity", "character"), "location": ("entity", "location"), "object": ("entity", "object"),
            "rule": ("rule", None), "event": ("event", None)}
# Content work/domain/WorkMetadata.kt: 작품 등록의 승인 장르(1~2개), 해시태그 10개 이하
GENRES = {"판타지", "현대판타지", "무협", "선협", "퓨전", "로맨스", "로맨스판타지", "BL", "GL", "현대", "시대물", "역사", "대체역사", "SF",
          "게임", "스포츠", "드라마", "미스터리", "추리", "스릴러", "공포", "오컬트", "액션", "전쟁·밀리터리", "라이트노벨", "학원",
          "일상", "고전", "일반소설", "기타"}
# Fork 시연의 고정관념 금지 규칙: 비하 표현 차단(어간)과 외국어 흉내를 막는 알파벳 금지
BANNED = ("깜둥", "검둥", "흑형", "니그")
# 나레이션 문체는 세계관에서 제목이 `나레이터`로 시작하는 카드(유형 무관)의 본문을 지침으로 쓴다
is_narrator = lambda card: card["title"].startswith("나레이터")  # noqa: E731


class Manuscript:
    """`episodes/NN.md`: 첫 줄이 제목, 빈 줄, 본문(한 줄 = 한 문단, 문단 사이는 빈 줄)."""

    def __init__(self, path):
        title, _, body = path.read_text(encoding="utf-8").partition("\n")
        self.number, self.title, self.body, self.path = int(path.stem), title.strip(), body.strip(), path


class Dataset:
    def __init__(self, directory):
        self.dir = directory
        self.world = json.loads((directory / "world.json").read_text(encoding="utf-8"))
        self.cards = {c["key"]: c for c in self.world["cards"]}
        self.characters = {k: c for k, c in self.cards.items() if c["cardType"] == "character"}
        self.rels = self.world["relationships"]
        self.manuscripts = [Manuscript(p) for p in sorted((directory / "episodes").glob("*.md"))]
        plans = directory / "plans.json"
        self.plans = json.loads(plans.read_text(encoding="utf-8")) if plans.exists() else None  # 장면 계획(시뮬레이션 흐름 모드의 비트)
        fork = self.world["work"].get("fork")
        self.first = fork["episode"] + 1 if fork else 1  # Fork는 기준 회차 뒤부터 자기 원고를 쓴다
        self.last = self.manuscripts[-1].number if self.manuscripts else STARLIGHT_EPISODES

    def records_at(self, episode):
        """episode 시점에 유효한 관계 기록: 관계(key)마다 episode 이하에서 가장 최근 값(DEC-51)."""
        latest = {}
        for rel in self.rels:
            if rel["from"] <= episode and rel["from"] >= latest.get(rel["key"], rel)["from"]:
                latest[rel["key"]] = rel
        return list(latest.values())

    def knowers(self, event, episode):
        """episode 시점에 그 사건과 이어진 인물."""
        return {r["source"] for r in self.records_at(episode) if r["target"] == event and r["source"] in self.characters}


DATASET_DIRS = [HERE, *sorted(p.parent for p in HERE.glob("*/world.json"))]


class WorldChecks:
    """데이터셋 하나(self.dataset)를 검사한다. 데이터셋마다 이 믹스인을 쓴 TestCase가 만들어진다."""
    dataset = None

    world = property(lambda self: self.dataset.world)
    cards = property(lambda self: self.dataset.cards)
    characters = property(lambda self: self.dataset.characters)
    rels = property(lambda self: self.dataset.rels)
    records_at = lambda self, episode: self.dataset.records_at(episode)  # noqa: E731
    knowers = lambda self, event, episode: self.dataset.knowers(event, episode)  # noqa: E731
    scope = property(lambda self: seed.scope_of(self.world))

    def test_world_and_work(self):
        uuid.UUID(self.world["world"]["id"])
        self.assertTrue(0 < len(self.world["world"]["name"]) <= 100)
        self.assertLessEqual(len(self.world["world"]["description"]), 20000)
        work = self.world["work"]
        if "id" in work:  # 이미 있는 샘플 작품에 연결한다
            self.assertEqual((STARLIGHT_ID, "starlight"), (work["id"], work["slug"]))
            return
        self.assertTrue(0 < len(work["title"]) <= 120 and len(work.get("summary", "")) <= 2000)
        fork = work.get("fork")
        if fork:  # Fork: 원작 데이터셋의 작품에서 기준 회차를 보존해 갈라진다
            source = Dataset(self.dataset.dir / fork["sourceDir"])
            self.assertIn("title", source.world["work"])
            self.assertTrue(isinstance(fork["episode"], int) and 1 <= fork["episode"] <= source.last)
            self.assertLessEqual(len(fork.get("direction", "")), 2000)
            return
        self.assertIn(work["creationType"], ("ORIGINAL", "EXTERNAL_DERIVATIVE"))
        self.assertTrue(1 <= len(work["genres"]) <= 2 and set(work["genres"]) <= GENRES)
        self.assertTrue(len(work.get("hashtags", [])) <= 10 and all(t.strip() for t in work.get("hashtags", [])))

    def test_card_mix_and_visibility(self):
        count = lambda *types: sum(c["cardType"] in types and not is_narrator(c) for c in self.world["cards"])  # noqa: E731
        self.assertGreaterEqual(count("character"), 3)
        self.assertGreaterEqual(count("event"), 3)
        self.assertGreaterEqual(count("object"), 1)
        self.assertGreaterEqual(count("location", "rule"), 2)
        if self.dataset.dir == HERE:  # 첫 브리프의 규모(인물 3~4·사건 3~4·물건 1~2·장소·규칙 2~4)
            self.assertTrue(count("character") <= 4 and count("event") <= 4 and count("object") <= 2 and count("location", "rule") <= 4)
        self.assertEqual(len(self.world["cards"]), len(self.cards))  # key 중복 없음
        for card in self.world["cards"]:
            if card["cardType"] in ("location", "rule") and not is_narrator(card):
                self.assertEqual("public", card["visibility"], card["key"])  # 누구나 아는 세계 설정
            if card["cardType"] in ("character", "event"):
                self.assertEqual("private", card["visibility"], card["key"])  # 지식은 관계로만 퍼진다

    def test_cards_follow_server_limits(self):
        self.assertEqual(len({c["title"] for c in self.world["cards"]}), len(self.world["cards"]))
        for card in self.world["cards"]:
            who = card["key"]
            self.assertRegex(who, KEY)
            self.assertIn(card["cardType"], CARD_TYPES, who)
            self.assertIn(card["areaCode"], AREAS, who)
            if card["cardType"] == "event":
                self.assertEqual("history", card["areaCode"], who)  # 화면은 사건을 역사 영역에만 저장한다
            self.assertTrue(0 < len(card["title"]) <= 200, who)
            self.assertTrue(card["body"].strip() and len(card["body"]) <= DOC_MAX, who)
            self.assertLessEqual(len(card["classification"]), 50, who)
            for labels in (card["aliases"], card["tags"]):
                self.assertTrue(len(labels) <= 100 and all(0 < len(x) <= 200 for x in labels), who)
            self.assertIn(card["visibility"], ("private", "public"), who)
            reveal = card.get("revealFromEpisode")
            self.assertTrue(reveal is None or (isinstance(reveal, int) and reveal >= 1), who)

    def test_character_docs(self):
        souls = []
        for key, card in self.characters.items():
            docs = card["characterDocs"]
            self.assertEqual({"soul", "memory", "episodes"}, set(docs), key)
            self.assertTrue(docs["soul"].strip() and docs["memory"].strip(), key)
            self.assertTrue(docs["episodes"], key)
            for number, text in docs["episodes"].items():
                self.assertRegex(number, EPISODE_KEY, key)
                self.assertTrue(text.strip(), f"{key} {number}")
            for text in [docs["soul"], docs["memory"], *docs["episodes"].values()]:
                self.assertLessEqual(len(text), DOC_MAX, key)
            for number, text in docs["episodes"].items():  # '~를 모른다'는 knowledge.md의 몫: 그 문장이 다른 카드를 말하면 모르는 일의 존재를 그 인물에게 알린다
                for sentence in re.split(r"(?<=[.!?])\s+|\n", text):
                    if re.search(r"알지 못|모른다|모르고|몰랐|알아차리지 못", sentence):
                        named = [c["title"] for k, c in self.cards.items() if k != key and c["title"] in sentence]
                        self.assertEqual([], named, f"{key} {number}화: 모른다는 문장이 {named}을(를) 알려 준다")
            souls.append(docs["soul"])
        for key, card in self.cards.items():
            self.assertEqual(key in self.characters, "characterDocs" in card, key)  # 인물 카드에만 문서가 있다
        grams = [{s[i:i + 2] for i in range(len(s) - 1)} for s in souls]  # 말투가 서로 달라야 한다(복붙 방지)
        for i in range(len(grams)):
            for j in range(i + 1, len(grams)):
                self.assertLess(len(grams[i] & grams[j]) / len(grams[i] | grams[j]), 0.5)

    def test_relationships_are_well_formed(self):
        versions = {}
        for rel in self.rels:
            who = f"{rel['key']}@{rel['from']}"
            self.assertRegex(rel["key"], KEY)
            self.assertTrue(isinstance(rel["from"], int) and rel["from"] >= 1, who)
            self.assertIn(rel["source"], self.cards, who)
            self.assertIn(rel["target"], self.cards, who)
            self.assertNotEqual(rel["source"], rel["target"], who)
            self.assertIn(rel["predicate"], seed.PREDICATES, who)
            self.assertIn(rel.get("polarity", "asserted"), ("asserted", "denied"), who)
            self.assertTrue(0 < len(rel["label"]) <= 200, who)
            self.assertTrue(rel["body"].strip() and len(rel["body"]) <= DOC_MAX, who)
            versions.setdefault(rel["key"], []).append(rel)
        for key, rels in versions.items():
            self.assertEqual(len(rels), len({r["from"] for r in rels}), key)  # 같은 회차에 값이 둘이면 안 된다
            self.assertEqual(1, len({(r["source"], r["target"]) for r in rels}), key)  # 끝점은 회차가 바뀌어도 같다
        kinds = {(self.cards[r["source"]]["cardType"], self.cards[r["target"]]["cardType"]) for r in self.rels}
        self.assertIn(("character", "character"), kinds)
        self.assertIn(("character", "event"), kinds)
        self.assertIn(("character", "object"), kinds)
        self.assertTrue(any(r.get("polarity") == "denied" for r in self.rels))  # 부정 관계
        self.assertTrue(any(len(v) >= 2 for v in versions.values()))  # 회차에 따라 값이 바뀌는 관계

    def test_denied_relations_are_named_positively_and_do_not_replace_the_link(self):
        """소비자(simulation·화면)는 부정 관계를 'label 아님'으로 보이고, recall 필터는 긍정 관계만 연결로 센다."""
        for rel in self.rels:
            if rel.get("polarity") == "denied":
                self.assertNotRegex(rel["label"], r"^(불|비|무|반)|않|아님|못", rel["key"])  # '불신 아님'은 이중부정
                pair = {rel["source"], rel["target"]}
                self.assertTrue(any(r.get("polarity", "asserted") == "asserted" and {r["source"], r["target"]} == pair
                                    for r in self.records_at(rel["from"])), rel["key"])

    def test_cards_a_character_names_are_linked_to_that_character(self):
        """recall 필터는 인물·물건 카드를 그 인물과 긍정 관계로 이어져 있을 때만 아는 것으로 본다(장소·규칙은 누구나)."""
        for key, card in self.characters.items():
            docs = card["characterDocs"]
            text = " ".join([docs["soul"], docs["memory"], *docs["episodes"].values()])
            for other_key, other in self.cards.items():
                if other_key != key and other["cardType"] in ("character", "object") and other["title"] in text:
                    self.assertTrue(any(r.get("polarity", "asserted") == "asserted" and {r["source"], r["target"]} == {key, other_key}
                                        for r in self.rels), f"{key}가 말하는 {other_key}와 이어진 긍정 관계가 없다")

    def test_relation_count_grows_with_episodes(self):
        last = max(self.dataset.last, max(r["from"] for r in self.rels))
        counts = [len(seed.relations_at(self.world, ep)) for ep in range(1, last + 1)]
        self.assertEqual(counts, [len(self.records_at(ep)) for ep in range(1, last + 1)])
        self.assertEqual(counts, sorted(counts))  # 관계는 회차가 갈수록 늘기만 한다(끝난 관계는 쓰지 않는다)
        self.assertLess(counts[0], counts[-1])
        if self.dataset.dir == HERE:  # 1화 < 2화 < 3화
            self.assertTrue(counts[0] < counts[1] < counts[2])

    def test_same_event_is_known_by_more_characters_later(self):
        last = max(self.dataset.last, max(r["from"] for r in self.rels))
        events = [k for k, c in self.cards.items() if c["cardType"] == "event"]
        for event in events:  # 모든 사건을 아는 인물이 한 명은 있다
            self.assertTrue(any(self.knowers(event, ep) for ep in range(1, last + 1)), event)
        self.assertTrue(any(self.knowers(e, a) and self.knowers(e, a) < self.knowers(e, b)  # 먼저 A만, 나중에 B도
                            for e in events for a in range(1, last + 1) for b in range(a + 1, last + 1)))

    def test_a_later_event_is_hidden_from_readers_and_learned_after_the_manuscript(self):
        if self.dataset.dir != HERE:
            self.skipTest("원고 밖 전개는 별빛 서약의 탑 시연용이다")
        hidden = [k for k, c in self.cards.items() if c["cardType"] == "event" and "revealFromEpisode" not in c]
        self.assertTrue(hidden)
        late = [r for r in self.rels if r["target"] in hidden and r["source"] in self.characters and r["from"] > STARLIGHT_EPISODES]
        self.assertTrue(late)  # 원고 3화까지에 없는 시연용 전개
        for card in self.cards.values():
            if card["cardType"] == "event" and card["key"] not in hidden:
                self.assertLessEqual(card["revealFromEpisode"], STARLIGHT_EPISODES)

    def test_secrets_stay_with_their_holders(self):
        self.assertTrue(self.world["secrets"])
        for secret in self.world["secrets"]:
            phrase, holders, learned = secret["phrase"], set(secret["holders"]), secret.get("learnedBy", {})
            self.assertTrue(holders and holders <= set(self.characters))
            self.assertNotIn(phrase, self.world["world"]["description"])
            for holder in holders:  # 비밀은 보유자의 MEMORY.md에 있다
                self.assertIn(phrase, self.characters[holder]["characterDocs"]["memory"], holder)
            others = set(self.characters) - holders
            self.assertTrue(others)
            for key in others:  # 다른 인물의 입력(기준 회차 이하 문서)에는 나오지 않는다
                docs = self.characters[key]["characterDocs"]
                known_from = learned.get(key, math.inf)
                visible = [self.characters[key]["body"], docs["soul"], docs["memory"],
                           *(t for n, t in docs["episodes"].items() if int(n) < known_from)]
                for text in visible:
                    self.assertNotIn(phrase, text, key)
            for key, card in self.cards.items():  # 독자도 모르는 비밀이면 카드 본문에 있을 때 숨겨진 비공개 카드여야 한다(readersKnow: 독자는 이미 안다)
                if not secret.get("readersKnow") and key not in self.characters and phrase in card["title"] + card["body"]:
                    self.assertEqual("private", card["visibility"], key)
                    self.assertNotIn("revealFromEpisode", card, key)
            for rel in self.rels:  # 관계는 양 끝 인물이 모두 안 뒤에만 쓸 수 있다(입력에는 '출발 카드 → 도착 카드: 이름 — 본문'으로 들어간다)
                sentence = " ".join((self.cards[rel["source"]]["title"], self.cards[rel["target"]]["title"], rel["label"], rel["body"]))
                if phrase in sentence:
                    for end in (rel["source"], rel["target"]):
                        if end in self.characters and end not in holders:
                            self.assertLessEqual(learned.get(end, math.inf), rel["from"], f"{rel['key']}@{rel['from']}")

    def test_card_payloads_match_server_and_ui_contract(self):
        ids = set()
        for card in self.world["cards"]:
            payload = seed.card_payload(card, self.scope)
            self.assertEqual({"id", "title", "body", "cardType", "areaCode", "classification", "aliases", "tags",
                              "semanticMetadata", "visibility", "lifecycle"}, set(payload))
            self.assertEqual(seed.card_id(card["key"], self.scope), payload["id"])
            uuid.UUID(payload["id"])
            ids.add(payload["id"])
            meta = payload["semanticMetadata"]
            studio, kind = meta["studio"], UI_KINDS[card["cardType"]]
            item = studio["item"]
            self.assertEqual((payload["id"], *kind, payload["title"], payload["body"], payload["areaCode"]),
                             (item["id"], item["kind"], item["entityType"], item["title"], item["text"], item["category"]))
            self.assertEqual((payload["classification"], payload["tags"], payload["aliases"]),
                             (studio["userCategory"], studio["tags"], studio["aliases"]))
            self.assertEqual(card.get("revealFromEpisode"), meta.get("revealFromEpisode"))
            self.assertEqual("characterDocs" in card, "characterDocs" in meta)
            self.assertEqual("active", payload["lifecycle"])
        self.assertEqual(len(self.world["cards"]), len(ids))

    def test_relation_payloads_match_server_and_ui_contract(self):
        for pred, expected in seed.PREDICATES.items():
            self.assertEqual(UI_PREDICATES[pred], expected, pred)
        for rec in self.rels:
            payload = seed.relation_payload(rec, self.scope)
            category, direction = UI_PREDICATES[rec["predicate"]]
            self.assertEqual((seed.relation_id(rec["key"], self.scope), seed.card_id(rec["source"], self.scope), seed.card_id(rec["target"], self.scope),
                              category, direction, rec.get("polarity", "asserted"), rec["label"], rec["body"], "active"),
                             tuple(payload[k] for k in ("id", "sourceCardId", "targetCardId", "category", "direction",
                                                        "polarity", "label", "body", "lifecycle")))
            item = payload["semanticMetadata"]["studio"]["item"]
            self.assertEqual(("relation", payload["id"], payload["label"], payload["body"], payload["sourceCardId"],
                              payload["targetCardId"], payload["polarity"], rec["predicate"]),
                             (item["kind"], item["id"], item["title"], item["text"], item["subjectId"],
                              item["targetId"], item["polarity"], item["predicate"]))
        keys = {r["key"] for r in self.rels}
        self.assertEqual(len(keys), len({seed.relation_id(k, self.scope) for k in keys}))

    def test_requests_fit_server_limits(self):
        self.assertLessEqual(len(self.world["cards"]), 1000)
        for ep in seed.episodes(self.world):
            self.assertLessEqual(len(seed.relations_at(self.world, ep)), 1000)
        size = len(json.dumps([seed.card_payload(c, self.scope) for c in self.world["cards"]], ensure_ascii=False).encode())
        self.assertLess(size, 1_000_000)  # 서버 한도 2,000,000바이트(WorldStudioService.validateEditRequest)

    def test_manuscripts_follow_the_format_and_order(self):
        d = self.dataset
        if not d.manuscripts:
            self.skipTest("원고 파일이 없는 데이터셋")
        self.assertEqual(list(range(d.first, d.first + len(d.manuscripts))), [m.number for m in d.manuscripts])
        for m in d.manuscripts:
            who = f"{d.dir.name}/{m.number:02d}"
            self.assertTrue(0 < len(m.title) <= 120, who)
            self.assertTrue(3000 <= len(m.body.replace("\n", "")) <= 4000, f"{who} {len(m.body.replace(chr(10), ''))}자")
            self.assertEqual(0, m.body.count('"') % 2, who)  # 대사는 ASCII 큰따옴표, 짝이 맞는다
            self.assertNotRegex(m.body, r"\*|\[\[|[“”‘’]", who)
            self.assertNotRegex(m.body, r"\[\d+\]", f"{who}: 원문 문단 번호가 남았다")
            lines = m.body.split("\n")
            for line in lines:  # DEC-48: 줄 종류 기호가 없는 문단 줄, 한 줄 = 한 문단
                self.assertNotRegex(line, r"^\s*([#>\-]|\d+[.)]\s)", who)
                self.assertLessEqual(len(line), 1500, who)
            self.assertFalse(any(a and b for a, b in zip(lines, lines[1:])), who)  # 문단 사이는 빈 줄 하나

    def test_knowledge_has_a_section_for_every_episode(self):
        d = self.dataset
        if not d.manuscripts:
            self.skipTest("원고 파일이 없는 데이터셋")
        text = (d.dir / "knowledge.md").read_text(encoding="utf-8")
        self.assertEqual([m.number for m in d.manuscripts], [int(n) for n in re.findall(r"^## (\d+)화", text, re.M)])
        for number, body in re.findall(r"^## (\d+)화[^\n]*\n(.*?)(?=^## |\Z)", text, re.M | re.S):
            self.assertTrue(body.strip(), f"{d.dir.name} {number}화")

    def test_episode_numbers_stay_inside_the_manuscript(self):
        d = self.dataset
        if not d.manuscripts:
            self.skipTest("원고 파일이 없는 데이터셋")
        for rel in self.rels:
            self.assertTrue(1 <= rel["from"] <= d.last, rel["key"])
        for key, card in self.cards.items():
            self.assertLessEqual(card.get("revealFromEpisode", 1), d.last, key)
            for number in card.get("characterDocs", {}).get("episodes", {}):
                self.assertLessEqual(int(number), d.last, key)

    def test_relations_start_after_both_cards_are_revealed(self):
        """recall 필터는 상대 카드가 아직 공개되지 않은 관계를 뺀다. 그런 관계를 만들지 않는다."""
        d = self.dataset
        if not d.manuscripts:
            self.skipTest("원고 파일이 없는 데이터셋")
        for rel in self.rels:
            for end in (rel["source"], rel["target"]):
                self.assertLessEqual(self.cards[end].get("revealFromEpisode", 1), rel["from"], f"{rel['key']}@{rel['from']} {end}")

    def test_fork_world_is_the_source_world_as_of_the_base_episode(self):
        """Fork는 기준 회차 시점의 원작 세계관(그 회차까지 공개된 카드·기억·관계)에서 갈라진다. 바뀐 카드와 새로 더한 카드만 다르다."""
        fork = self.world["work"].get("fork")
        if not fork:
            self.skipTest("Fork가 아닌 데이터셋")
        source, base = Dataset(self.dataset.dir / fork["sourceDir"]), fork["episode"]
        changed, voice, added = set(fork["changed"]), set(fork["voiceChanged"]), set(fork.get("added", []))
        inherited = {k for k, c in source.cards.items() if c.get("revealFromEpisode", 1) <= base}
        self.assertEqual(inherited | added, set(self.cards))
        self.assertFalse(added & inherited)
        self.assertTrue(voice <= changed <= inherited)

        def upto(card):  # 물려받는 것은 기준 회차까지의 기억뿐이다(그 뒤 회차의 기억은 Fork가 새로 쓴다)
            docs = card.get("characterDocs")
            return card if not docs else {**card, "characterDocs": {**docs, "episodes": {n: t for n, t in docs["episodes"].items() if int(n) <= base}}}

        for key in inherited - changed:
            self.assertEqual(upto(source.cards[key]), upto(self.cards[key]), key)
        for key in changed:
            old, new = upto(source.cards[key]), upto(self.cards[key])
            if "characterDocs" not in old:  # 인물이 아닌 바뀐 카드(Fork 자신의 나레이터 카드): 본문만 달라진다
                self.assertNotEqual(old["body"], new["body"], key)
                continue
            self.assertEqual(old["characterDocs"]["episodes"], new["characterDocs"]["episodes"], key)  # 물려받은 회차의 기억은 그대로
            self.assertNotEqual((old["body"], old["characterDocs"]["memory"]), (new["body"], new["characterDocs"]["memory"]), key)
        grams = lambda s: {s[i:i + 2] for i in range(len(s) - 1)}  # noqa: E731
        for key in voice:  # 바뀐 말투가 원작 말투와 섞이지 않는다
            a, b = grams(source.cards[key]["characterDocs"]["soul"]), grams(self.cards[key]["characterDocs"]["soul"])
            self.assertLess(len(a & b) / len(a | b), 0.5, key)
        by_key = lambda rels: sorted(((r["key"], r["from"]), r) for r in rels)  # noqa: E731
        self.assertEqual(by_key(r for r in source.rels if r["from"] <= base), by_key(r for r in self.rels if r["from"] <= base))
        self.assertTrue(any(r["from"] > base for r in self.rels))

    def test_fork_text_avoids_stereotypes(self):
        fork = self.world["work"].get("fork")
        if not fork:
            self.skipTest("Fork가 아닌 데이터셋")
        texts = [m.body for m in self.dataset.manuscripts] + [m.title for m in self.dataset.manuscripts]
        for key in fork["changed"] + fork.get("added", []):
            card, docs = self.cards[key], self.cards[key].get("characterDocs")
            texts += [card["body"]] + ([docs["soul"], docs["memory"], *docs["episodes"].values()] if docs else [])
        for text in texts:
            for word in BANNED:
                self.assertNotIn(word, text)
            self.assertNotRegex(text, r"[A-Za-z]", "외국어를 흉내 낸 말투를 쓰지 않는다")
        for key in fork["changed"]:  # 말투를 인종이 아니라 경험·성격에서 끌어낸다고 SOUL에 못 박는다
            if key in self.characters:
                self.assertIn("하지 않는 말", self.cards[key]["characterDocs"]["soul"], key)

    def test_narrator_card_guides_the_narration_style(self):
        """작품마다 나레이터 카드 하나: 제목 `나레이터 — <작품명>`, 비공개 규칙 카드, 배경 설명·시점·말투·하지 않는 것.
        규칙 카드는 인물이 누구나 아는 것으로 읽으므로 인물·물건·사건 이름과 비밀을 쓰지 않는다. Fork는 고정관념 금지 규칙을 옮겨 적는다."""
        narrators = [c for c in self.world["cards"] if is_narrator(c)]
        self.assertEqual(1, len(narrators))
        card, body = narrators[0], narrators[0]["body"]
        self.assertEqual("나레이터 — " + self.world["world"]["name"].split(" · ")[0], card["title"])
        self.assertEqual(("narrator", "rule", "private"), (card["key"], card["cardType"], card["visibility"]))
        self.assertNotIn("revealFromEpisode", card)  # 독자에게 공개하는 설정이 아니다
        for section in ("## 배경 설명", "## 시점", "## 말투", "## 하지 않는 것"):
            self.assertIn(section, body)
        for rule in ("현대 속어", "속마음", "암시"):  # 하지 않는 것
            self.assertIn(rule, body.partition("## 하지 않는 것")[2])
        for other in self.cards.values():
            if other["cardType"] in ("character", "object", "event"):
                for name in [other["title"], *(a for a in other["aliases"] if len(a) >= 2)]:
                    self.assertNotIn(name, body, f"나레이터 카드가 {other['key']}의 이름을 쓴다")
        for secret in self.world["secrets"]:
            self.assertNotIn(secret["phrase"], body)
        if self.world["work"].get("fork"):
            for rule in ("특정 인종", "방언·속어", "사회의 문제", "스스로 익힌", "담담하고 존중하는 시선"):  # 흑길동전 README 고정관념 금지 규칙에서 옮긴 말
                self.assertIn(rule, body)
            self.assertIn("narrator", self.world["work"]["fork"]["changed"])  # 원작 나레이터 카드를 Fork 자신의 것으로 바꾼다

    def test_scene_plans_are_well_formed(self):
        """plans.json은 플롯 1개와 장면이다. 흐름 모드는 열린 회차의 장면을 `제목: 내용`(200자로 자름) 비트로 최대 8개, 참여 인물은 최대 6명 쓴다."""
        plans = self.dataset.plans
        if plans is None:
            self.skipTest("장면 계획이 없는 데이터셋")
        self.assertEqual({"plot", "scenes"}, set(plans))
        self.assertEqual({"title", "content"}, set(plans["plot"]))
        self.assertTrue(0 < len(plans["plot"]["title"]) <= 120 and len(plans["plot"]["content"]) <= 8000)  # 서버 한도(StoryPlanService.validate)
        titles = [s["title"] for s in plans["scenes"]]
        self.assertEqual(len(titles), len(set(titles)))  # 같은 제목은 건너뛰므로 제목이 겹치면 한쪽이 사라진다
        self.assertNotIn(plans["plot"]["title"], titles)
        by_episode = {}
        for scene in plans["scenes"]:
            who = scene["title"]
            self.assertTrue({"episode", "title", "content", "characters"} <= set(scene) <= {"episode", "title", "content", "characters", "places"}, who)
            self.assertTrue(isinstance(scene["episode"], int) and 1 <= scene["episode"] <= self.dataset.last + 1, who)  # 있는 회차나 바로 다음 회차
            self.assertTrue(0 < len(scene["title"]) <= 120 and scene["title"] == scene["title"].strip(), who)
            self.assertLessEqual(len(f"{scene['title']}: {scene['content']}"), 200, who)  # 더 길면 비트 끝이 잘린다
            self.assertTrue(scene["characters"] and len(set(scene["characters"])) == len(scene["characters"]), who)
            for key in scene["characters"]:
                self.assertIn(key, self.characters, who)
                self.assertLessEqual(self.cards[key].get("revealFromEpisode", 1), scene["episode"], f"{who}: {key}는 {scene['episode']}화에 아직 공개 전이다")
            for key in scene.get("places", []):
                self.assertEqual("location", self.cards[key]["cardType"], f"{who}: {key}")
            by_episode.setdefault(scene["episode"], []).append(scene)
        for episode, scenes in by_episode.items():
            self.assertLessEqual(len(scenes), 8, f"{episode}화 비트")
            self.assertLessEqual(len({k for s in scenes for k in s["characters"]}), 6, f"{episode}화 참여 인물")

    def test_scene_plans_name_exactly_their_characters(self):
        """장면 계획의 characterIds는 비어 있어(서버가 카드 id를 안 받는다) 화면이 비트 문장의 인물 이름으로 참여 인물을 채운다.
        장면에 없는 인물의 이름·별칭이 나오면 그 인물이 끼어들고, 비트에 카드 제목이 없으면 그 인물이 빠진다. 비밀은 참여 인물이 모두 안 뒤에만 쓴다."""
        if self.dataset.plans is None:
            self.skipTest("장면 계획이 없는 데이터셋")
        for scene in self.dataset.plans["scenes"]:
            who, beat = scene["title"], f"{scene['title']}: {scene['content']}"
            named = {k for k, c in self.characters.items() if any(n in beat for n in [c["title"], *(a for a in c["aliases"] if len(a) >= 2)])}
            self.assertEqual(set(scene["characters"]), named, who)
            for key in scene["characters"]:
                self.assertIn(self.cards[key]["title"], beat, who)  # 별칭이 아니라 카드 제목(이름)으로 나온다
            for secret in self.world["secrets"]:
                if secret["phrase"] in beat:
                    know = lambda key: key in secret["holders"] or secret.get("learnedBy", {}).get(key, math.inf) <= scene["episode"]  # noqa: E731
                    self.assertTrue(all(know(key) for key in scene["characters"]), f"{who}: 아직 모르는 인물이 있는 장면에 비밀이 나온다")

class WalkthroughPlans(unittest.TestCase):
    """README 시연 순서가 쓰는 장면 계획: 흑길동전 4·5화와 홍길동전 5화에 3~4개씩 있고, 두 작품의 5화는 같은 비트다(같은 비트에서 길동의 말씨를 비교한다)."""

    def test_scenes_exist_and_the_fifth_episode_is_shared(self):
        scenes = lambda name, episode: [(s["title"], s["content"], s["characters"]) for s in Dataset(HERE / name).plans["scenes"] if s["episode"] == episode]  # noqa: E731
        for name, episode in (("heukgildong-fork", 4), ("heukgildong-fork", 5), ("honggildong", 5)):
            self.assertIn(len(scenes(name, episode)), (3, 4), f"{name} {episode}화")
        self.assertEqual(scenes("heukgildong-fork", 5), scenes("honggildong", 5))


def add_world_checks(directory):
    """데이터셋마다 TestCase 하나를 모듈에 둔다(변수로 남기면 unittest가 같은 클래스를 두 번 모은다)."""
    name = "World_" + ("starlight" if directory == HERE else directory.name.replace("-", "_"))
    globals()[name] = type(name, (WorldChecks, unittest.TestCase), {"dataset": Dataset(directory)})


for _dir in DATASET_DIRS:
    add_world_checks(_dir)


class IdsDoNotRepeatAcrossDatasets(unittest.TestCase):
    """카드·관계 id는 서버(worldstudio V1)에서 세계관과 무관한 전역 기본키다. 데이터셋끼리 id가 겹치면 두 번째 적재가 실패하거나 남의 카드를 덮는다."""

    def test_card_and_relation_ids_are_unique_per_dataset(self):
        owners = {}
        for directory in DATASET_DIRS:
            world = Dataset(directory).world
            scope = seed.scope_of(world)
            ids = {seed.card_id(c["key"], scope) for c in world["cards"]} | {seed.relation_id(r["key"], scope) for r in world["relationships"]}
            clash = ids & owners.keys()
            self.assertEqual(0, len(clash), f"{directory.name}의 id {len(clash)}개가 {sorted({owners[i] for i in clash})}와 겹친다")
            owners.update(dict.fromkeys(ids, directory.name))

    def test_the_same_key_gets_different_ids_in_different_worlds_but_starlight_keeps_its_ids(self):
        one, two = {"work": {}, "world": {"id": "w1"}}, {"work": {}, "world": {"id": "w2"}}
        self.assertNotEqual(seed.card_id("gildong", seed.scope_of(one)), seed.card_id("gildong", seed.scope_of(two)))
        self.assertNotEqual(seed.relation_id("a-b", seed.scope_of(one)), seed.relation_id("a-b", seed.scope_of(two)))
        self.assertEqual("", seed.scope_of({"work": {"id": STARLIGHT_ID}, "world": {"id": "w3"}}))  # 이미 적재된 id는 그대로


STARLIGHT = Dataset(HERE)
WORLD, CARDS = STARLIGHT.world, STARLIGHT.cards
OWNER = "11111111-1111-4111-8111-111111111111"
OTHER_WORLD = "22222222-2222-4222-8222-222222222222"


class FakeStack:
    """Content 최소 모의: 작품·회차 저장·발행·분기 정책·Fork와 draftRevision·회차별 관계(DEC-51)·작품 연결 규칙만 흉내 낸다."""

    def __init__(self, linked=None, owner=OWNER):
        self.owner, self.worlds, self.counter = owner, {}, 0
        self.works = {STARLIGHT_ID: self.work(STARLIGHT_ID, "별빛 서약의 탑", owner, worldStudioId=linked)}  # 이미 있는 샘플 작품
        self.puts, self.calls, self.fail_put = [], [], None
        self.id_owner = {}  # 카드·관계 id → 세계관. 서버(worldstudio V1)의 id는 세계관과 무관한 전역 기본키다
        self.plans, self.plan_posts, self.fail_plan = {}, [], None  # 작품 id → 계획 목록, 받은 POST 본문, n번째 POST를 실패시킨다

    @property
    def linked(self):
        return self.works[STARLIGHT_ID]["worldStudioId"]

    @property
    def world(self):  # 마지막으로 만든 세계관(없으면 None)
        return list(self.worlds.values())[-1] if self.worlds else None

    def new_id(self):
        self.counter += 1
        return f"00000000-0000-4000-8000-{self.counter:012d}"

    def work(self, id, title, owner, source=None, **more):
        return {"id": id, "title": title, "ownerId": owner, "source": source, "revision": 0, "visibility": "private",
                "allowFork": False, "allowForkPublication": False, "worldStudioId": None, "episodes": {}, **more}

    def call(self, method, path, body=None):
        self.calls.append((method, path))
        status, data = self.route(method, path, None if body is None else json.loads(json.dumps(body)))
        return status, json.loads(json.dumps(data))

    def view(self, work):  # WorkResponse
        return {k: v for k, v in work.items() if k != "episodes"}

    def episode(self, work, number):  # EpisodeResponse
        e = work["episodes"][number]
        return {"number": number, "draft": e["draft"], "versions": e["versions"], "publishedVersionId": e["published"], "inherited": e["inherited"]}

    def route(self, method, path, body):
        route, _, query = path.partition("?")
        parts = route.split("/")  # ['', 'api', 'v1', 'works', id, 'episodes', n, ...]
        if route == "/api/v1/works":
            if method == "GET":
                return 200, [self.view(w) for w in self.works.values()]
            return self.create_work(body)
        if route == "/api/v1/world-studios":
            wid = body["id"]
            self.worlds.setdefault(wid, {"id": wid, "revision": 0, "cards": {}, "edges": {}})
            return 200, self.draft(wid, None)
        if route.startswith("/api/v1/world-studios/"):
            wid = parts[4]
            if method == "GET":
                return 200, self.draft(wid, int(query.split("=")[1]) if query else None)
            return self.put(wid, body)
        if route.startswith("/api/v1/works/"):
            work = self.works.get(parts[4])
            if work is None:
                return 404, {"detail": "작품을 찾을 수 없어요."}
            rest = "/".join(parts[5:])
            if (method, rest) == ("GET", ""):
                return 200, self.view(work)
            if (method, rest) == ("PUT", "world-studio"):
                taken = [w for w in self.works.values() if w is not work and w["worldStudioId"] == body["worldId"]]
                if work["worldStudioId"] not in (None, body["worldId"]) or taken:
                    return 409, {"detail": "이미 연결돼 있어요"}
                work["worldStudioId"] = body["worldId"]
                return 200, {"workId": work["id"], "worldId": work["worldStudioId"]}
            if (method, rest) == ("PUT", "policy"):
                if body["revision"] != work["revision"]:
                    return 409, {"detail": "원고가 변경됐어요."}
                work.update(allowFork=body["allowFork"], allowForkPublication=body["allowForkPublication"], revision=work["revision"] + 1)
                return 200, self.view(work)
            if (method, rest) == ("POST", "forks"):
                return self.fork(work, body)
            if rest.startswith("episodes"):
                return self.episodes(work, method, parts[6:], body)
            if rest == "story-plans":
                return self.story_plans(work, method, body)
        raise AssertionError(f"모의에 없는 호출: {method} {path}")

    def story_plans(self, work, method, body):
        """StoryPlanService.validate의 핵심: 장면은 소속 플롯, 회차는 있는 것만."""
        plans = self.plans.setdefault(work["id"], [])
        if method == "GET":
            return 200, plans  # 목록 순서 = 만든 순서(서버는 createdAt, id 순)
        self.plan_posts.append(body)
        if self.fail_plan == len(self.plan_posts):
            return 500, {"detail": "모의 서버 오류"}
        parent = next((p for p in plans if p["id"] == body.get("parentId")), None)
        if (body["kind"] == "scene") != (parent is not None and parent["kind"] == "plot"):
            return 422, {"detail": "장면 계획은 소속 플롯을 선택해야 해요."}
        number = body.get("episodeNumber")
        if number is not None and number not in work["episodes"]:
            return 422, {"detail": "연결할 회차를 찾을 수 없어요."}
        plan = {"id": self.new_id(), "workId": work["id"], "kind": body["kind"], "parentId": body.get("parentId"), "title": body["title"].strip(),
                "content": body["content"], "episodeNumber": number, "episodeMissing": False, "characterIds": [], "placeIds": [], "revision": 1}
        plans.append(plan)
        return 201, plan

    def create_work(self, body):
        if body.get("creationType") not in ("ORIGINAL", "EXTERNAL_DERIVATIVE") or not body.get("rightsConfirmed") \
                or not 1 <= len(body.get("genres", [])) <= 2 or not set(body["genres"]) <= GENRES:
            return 422, {"detail": "작품 등록 입력을 확인해 주세요."}
        work = self.work(self.new_id(), body["title"], self.owner, summary=body["summary"], creationType=body["creationType"],
                         genres=body["genres"], hashtags=body["hashtags"], rightsConfirmed=body["rightsConfirmed"])
        work["episodes"][1] = {"draft": {"title": "새 회차", "body": "", "revision": 0}, "versions": [], "published": None, "inherited": False}
        self.works[work["id"]] = work
        return 201, self.view(work)

    def fork(self, source, body):
        published = [n for n, e in source["episodes"].items() if e["published"]]
        if source["source"] or source["visibility"] != "public" or not source["allowFork"] or body["episode"] not in published:
            return 403, {"detail": "이 작품은 분기를 허용하지 않아요."}
        if any((w["source"] or {}).get("workId") == source["id"] and w["ownerId"] == self.owner for w in self.works.values()):
            return 409, {"detail": "이미 만든 분기 작품이 있어요."}
        work = self.work(self.new_id(), body["title"], self.owner, summary=body.get("summary", ""),
                         source={"workId": source["id"], "title": source["title"], "episode": body["episode"], "direction": body.get("direction", "")})
        for n in range(1, body["episode"] + 1):
            e = source["episodes"][n]
            work["episodes"][n] = {"draft": e["draft"], "versions": e["versions"], "published": e["published"], "inherited": True}
        work["episodes"][body["episode"] + 1] = {"draft": {"title": "새 회차", "body": "", "revision": 0}, "versions": [], "published": None, "inherited": False}
        self.works[work["id"]] = work
        return 201, self.view(work)

    def episodes(self, work, method, rest, body):
        if method == "GET" and not rest:
            return 200, [self.episode(work, n) for n in sorted(work["episodes"])]
        if method == "POST" and not rest:
            number = max(work["episodes"], default=0) + 1
            work["episodes"][number] = {"draft": {"title": body["title"], "body": "", "revision": 0}, "versions": [], "published": None, "inherited": False}
            work["revision"] += 1
            return 201, self.episode(work, number)
        number, action = int(rest[0]), rest[1]
        e = work["episodes"].get(number)
        if e is None or e["inherited"]:
            return (404 if e is None else 403), {"detail": "회차를 수정할 수 없어요."}
        if action == "versions":
            if body["revision"] != e["draft"]["revision"]:
                return 409, {"detail": "다른 편집이 저장됐어요."}
            e["draft"] = {"title": body["title"], "body": body["body"], "revision": body["revision"] + 1}
            work["revision"] += 1
            self.counter += 1
            e["versions"] = e["versions"] + [{"id": f"version-{self.counter}", "title": body["title"], "body": body["body"], "revision": e["draft"]["revision"]}]
            return 200, self.episode(work, number)
        version = next((v for v in e["versions"] if v["id"] == body["versionId"]), None)
        done = [n for n, x in work["episodes"].items() if x["published"]]
        if body["revision"] != e["draft"]["revision"] or version is None or not body["rightsConfirmed"]:
            return 409, {"detail": "저장 버전과 공개 권리를 확인해 주세요."}
        if number > max(done, default=0) + 1:
            return 409, {"detail": "앞 회차부터 순서대로 공개해 주세요."}
        e["published"], work["visibility"] = version["id"], "public"
        return 200, self.episode(work, number)

    def draft(self, wid, episode):
        world, rels = self.worlds[wid], []
        for history in world["edges"].values():
            seen = [e for e in history if episode is None or e <= episode]
            if seen:
                rels.append(history[max(seen)])
        return {"worldId": world["id"], "draftRevision": world["revision"], "cards": list(world["cards"].values()),
                "relationships": rels}

    def put(self, wid, body):
        world = self.worlds[wid]
        self.puts.append(body)
        if self.fail_put == len(self.puts):
            return 500, {"detail": "모의 서버 오류"}
        if body["expectedDraftRevision"] != world["revision"]:
            return 409, {"detail": "draftRevision이 달라요"}
        for item in [*body["cards"], *body["relationships"]]:
            if self.id_owner.setdefault(item["id"], wid) != wid:
                return 409, {"detail": "다른 세계관이 가진 id예요"}
        for card in body["cards"]:
            world["cards"][card["id"]] = card
        for rel in body["relationships"]:
            history = world["edges"].setdefault(rel["id"], {})
            seen = [e for e in history if e <= body["episode"]]
            if not seen or history[max(seen)] != rel:
                history[body["episode"]] = rel
        world["revision"] += 1
        return 200, self.draft(wid, body["episode"])


class SeedFlowTest(unittest.TestCase):
    """이미 있는 작품(starlight)에 세계관을 연결하는 흐름."""

    def run_seed(self, fake):
        return seed.seed(fake.call, WORLD, owner=OWNER)

    def test_first_run_loads_cards_once_then_relations_by_episode(self):
        fake = FakeStack()
        counts = self.run_seed(fake)
        episodes = seed.episodes(WORLD)
        self.assertEqual(episodes, [b["episode"] for b in fake.puts])
        self.assertEqual(len(WORLD["cards"]), len(fake.puts[0]["cards"]))  # 카드는 첫 저장에만
        self.assertTrue(all(not b["cards"] for b in fake.puts[1:]))
        self.assertTrue(all(b["replace"] is False for b in fake.puts))
        self.assertEqual(WORLD["world"]["id"], fake.linked)
        self.assertEqual(len(episodes), fake.world["revision"])
        for ep, n in counts.items():
            self.assertEqual(len(seed.relations_at(WORLD, ep)), n, ep)
        self.assertLess(counts[1], counts[2])

    def test_changed_relation_is_resent_only_in_its_episode(self):
        fake = FakeStack()
        self.run_seed(fake)
        by_episode = {b["episode"]: {r["id"]: r for r in b["relationships"]} for b in fake.puts}
        kael_lian = seed.relation_id("kael-lian")
        self.assertEqual({1, 2, 3}, {ep for ep, rels in by_episode.items() if kael_lian in rels})
        self.assertEqual(3, len({by_episode[ep][kael_lian]["body"] for ep in (1, 2, 3)}))
        self.assertNotIn(seed.relation_id("lian-orben"), by_episode[2])  # 그대로인 관계는 다시 보내지 않는다

    def test_save_keys_depend_only_on_the_input(self):
        first, second = FakeStack(), FakeStack()
        self.run_seed(first)
        self.run_seed(second)
        keys = [b["key"] for b in first.puts]
        self.assertEqual(keys, [b["key"] for b in second.puts])  # 같은 입력이면 같은 key(재시도를 같은 요청으로 알아본다)
        self.assertEqual(len(keys), len(set(keys)))
        self.assertTrue(all(0 < len(k.encode()) <= 200 for k in keys))  # 서버 key 한도 1~200바이트

    def test_rerun_changes_nothing(self):
        fake = FakeStack()
        self.run_seed(fake)
        before = (len(fake.puts), fake.world["revision"], len(fake.world["cards"]), len(fake.calls))
        self.run_seed(fake)
        self.assertEqual(before[:3], (len(fake.puts), fake.world["revision"], len(fake.world["cards"])))
        self.assertNotIn(("PUT", f"/api/v1/works/{STARLIGHT_ID}/world-studio"), fake.calls[before[3]:])

    def test_resumes_after_a_failed_episode(self):
        fake = FakeStack()
        fake.fail_put = 2
        with self.assertRaises(seed.SeedError):
            self.run_seed(fake)
        self.assertIsNone(fake.linked)
        fake.fail_put = None
        counts = self.run_seed(fake)
        self.assertEqual(len(seed.episodes(WORLD)), fake.world["revision"])
        self.assertEqual(WORLD["world"]["id"], fake.linked)
        self.assertEqual(len(seed.relations_at(WORLD, 3)), counts[3])

    def test_refuses_to_overwrite_another_world_link(self):
        fake = FakeStack(linked=OTHER_WORLD)
        with self.assertRaises(seed.SeedError) as caught:
            self.run_seed(fake)
        self.assertIn(OTHER_WORLD, str(caught.exception))
        self.assertIsNone(fake.world)
        self.assertNotIn("PUT", [m for m, _ in fake.calls])

    def test_refuses_when_the_account_does_not_own_the_work(self):
        fake = FakeStack(owner="33333333-3333-4333-8333-333333333333")
        with self.assertRaises(seed.SeedError):
            self.run_seed(fake)
        self.assertIsNone(fake.world)

    def test_server_errors_show_detail_but_not_card_text(self):
        fake = FakeStack()
        fake.fail_put = 1
        with self.assertRaises(seed.SeedError) as caught:
            self.run_seed(fake)
        message = str(caught.exception)
        self.assertIn("500", message)
        self.assertIn("모의 서버 오류", message)
        self.assertNotIn(CARDS["kael"]["body"], message)

    def test_password_is_required(self):
        with unittest.mock.patch.dict(os.environ, {}, clear=True), self.assertRaises(SystemExit) as caught:
            seed.main([])
        self.assertIn("STORYFORK_SEED_PASSWORD", str(caught.exception))


def write_dataset(root, name, title, episodes, **work):
    """작은 합성 데이터셋: 인물 둘·사건 하나, 1화·2화의 관계, 짧은 원고(seed 흐름 검사용이라 분량은 보지 않는다)."""
    directory = root / name
    (directory / "episodes").mkdir(parents=True)
    for number, text in episodes.items():
        (directory / "episodes" / f"{number:02d}.md").write_text(f"{number}화 제목\n\n{text}\n", encoding="utf-8")
    cards = [dict(key=k, cardType="character", areaCode="basic", title=t, classification="인물", aliases=[], tags=[], visibility="private",
                  body=f"{t}의 소개.", characterDocs=dict(soul="말투", memory="기억", episodes={"1": "겪은 일"})) for k, t in (("a", "가인"), ("b", "나리"))]
    cards.append(dict(key="ev", cardType="event", areaCode="history", title="만남", classification="사건", aliases=[], tags=[], visibility="private", body="두 사람이 만났다."))
    rels = [dict(key="a-ev", source="a", target="ev", predicate="custom_relation_directed", label="참여", body="가인이 만났다.", **{"from": 1}),
            dict(key="b-ev", source="b", target="ev", predicate="custom_relation_directed", label="목격", body="나리가 보았다.", **{"from": 2})]
    world = {"world": {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, name)), "name": title + " 세계관", "description": "시험용"},
             "work": {"title": title, "summary": "시험용 작품", **work}, "cards": cards, "relationships": rels, "secrets": []}
    (directory / "world.json").write_text(json.dumps(world, ensure_ascii=False), encoding="utf-8")
    return directory


class NewWorkSeedTest(unittest.TestCase):
    """새 작품(원고 저장·발행·분기 정책)과 Fork를 만드는 흐름."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.fake = FakeStack()
        self.original = write_dataset(self.root, "orig", "원작", {1: "첫째 날.", 2: "둘째 날.", 3: "셋째 날."},
                                      creationType="EXTERNAL_DERIVATIVE", genres=["고전", "시대물"], hashtags=["고전소설"], allowFork=True)
        self.fork = write_dataset(self.root, "fork", "갈래", {2: "다른 둘째 날.", 3: "다른 셋째 날."},
                                  fork={"sourceDir": "../orig", "episode": 1, "direction": "다른 전개", "changed": ["a"]})

    def seed(self, directory, fake=None):
        world = json.loads((directory / "world.json").read_text(encoding="utf-8"))
        return seed.seed((fake or self.fake).call, world, owner=OWNER, base=directory)

    def works(self, title, fake=None):
        return [w for w in (fake or self.fake).works.values() if w["title"] == title]

    def writes_since(self, count):
        """그 뒤의 쓰기 호출. 세계관 생성(POST /world-studios)은 id로 멱등이라 재실행에도 부르므로 세지 않는다."""
        return [c for c in self.fake.calls[count:] if c[0] != "GET" and c != ("POST", "/api/v1/world-studios")]

    def test_creates_the_work_publishes_every_episode_in_order_and_links_the_world(self):
        self.seed(self.original)
        (work,) = self.works("원작")
        self.assertEqual((["고전", "시대물"], ["고전소설"], "EXTERNAL_DERIVATIVE", True), (work["genres"], work["hashtags"], work["creationType"], work["rightsConfirmed"]))
        self.assertEqual([1, 2, 3], sorted(work["episodes"]))
        for number, text in {1: "첫째 날.", 2: "둘째 날.", 3: "셋째 날."}.items():
            published = next(v for v in work["episodes"][number]["versions"] if v["id"] == work["episodes"][number]["published"])
            self.assertEqual((f"{number}화 제목", text), (published["title"], published["body"]))
        self.assertTrue(work["allowFork"] and work["allowForkPublication"] and work["visibility"] == "public")
        self.assertEqual(self.fake.world["id"], work["worldStudioId"])

    def test_rerun_creates_and_publishes_nothing_again(self):
        self.seed(self.original)
        before = len(self.fake.calls)
        self.seed(self.original)
        self.assertEqual([], self.writes_since(before))  # 작품·회차·버전·발행·정책·세계관 저장·연결 모두 없다
        self.assertEqual(1, len(self.works("원작")))

    def test_a_changed_manuscript_is_saved_and_published_again(self):
        self.seed(self.original)
        (self.original / "episodes" / "02.md").write_text("2화 제목\n\n고쳐 쓴 둘째 날.\n", encoding="utf-8")
        before = len(self.fake.calls)
        self.seed(self.original)
        work = self.works("원작")[0]["id"]
        self.assertEqual([("POST", f"/api/v1/works/{work}/episodes/2/versions"), ("POST", f"/api/v1/works/{work}/episodes/2/publish")],
                         self.writes_since(before))

    def test_a_fork_keeps_the_base_episodes_and_publishes_only_its_own(self):
        self.seed(self.original)
        self.seed(self.fork)
        (source,), (fork,) = self.works("원작"), self.works("갈래")
        self.assertEqual({"workId": source["id"], "title": "원작", "episode": 1, "direction": "다른 전개"}, fork["source"])
        self.assertEqual([1, 2, 3], sorted(fork["episodes"]))
        self.assertTrue(fork["episodes"][1]["inherited"] and not fork["episodes"][2]["inherited"])
        bodies = [next(v for v in fork["episodes"][n]["versions"] if v["id"] == fork["episodes"][n]["published"])["body"] for n in (2, 3)]
        self.assertEqual(["다른 둘째 날.", "다른 셋째 날."], bodies)
        self.assertIsNotNone(fork["worldStudioId"])
        self.assertNotEqual(source["worldStudioId"], fork["worldStudioId"])  # 세계관은 작품마다 따로다

    def test_worlds_with_the_same_card_keys_get_their_own_ids(self):
        """원작과 Fork가 같은 key(a·b·ev)를 써도 한 스택에 둘 다 적재된다: 카드·관계 id가 세계관마다 다르다."""
        self.seed(self.original)
        self.seed(self.fork)
        first, second = (w["id"] for w in (self.fake.worlds[next(iter(self.fake.worlds))], self.fake.world))
        self.assertTrue(set(self.fake.worlds[first]["cards"]).isdisjoint(self.fake.worlds[second]["cards"]))

    def test_a_fork_rerun_does_not_create_a_second_fork(self):
        self.seed(self.original)
        self.seed(self.fork)
        before = len(self.fake.calls)
        self.seed(self.fork)
        self.assertEqual([], self.writes_since(before))
        self.assertEqual(1, len(self.works("갈래")))

    def test_a_fork_needs_its_source_loaded_first(self):
        with self.assertRaises(seed.SeedError) as caught:
            self.seed(self.fork)
        self.assertIn("원작", str(caught.exception))
        self.assertEqual([], [w for w in self.works("갈래")])

    def test_an_existing_work_with_another_world_is_not_overwritten(self):
        self.seed(self.original)
        (work,) = self.works("원작")
        work["worldStudioId"] = OTHER_WORLD
        before = len(self.fake.worlds)
        with self.assertRaises(seed.SeedError) as caught:
            self.seed(self.original)
        self.assertIn(OTHER_WORLD, str(caught.exception))
        self.assertEqual(before, len(self.fake.worlds))

    def test_an_episode_gap_is_refused(self):
        gap = write_dataset(self.root, "gap", "빈틈", {1: "첫째 날.", 3: "셋째 날."}, creationType="ORIGINAL", genres=["고전"])
        with self.assertRaises(seed.SeedError) as caught:
            self.seed(gap)
        self.assertIn("3화", str(caught.exception))

    def test_main_loads_the_dataset_directory_it_is_given(self):
        fake = self.fake

        class Stub:  # 로그인·HTTP는 모의로 바꾸고 main의 인자 처리만 본다
            def __init__(self, url):
                self.call = fake.call

            def login(self, email, password):
                return OWNER

        with unittest.mock.patch.object(seed, "Client", Stub), unittest.mock.patch.dict(os.environ, {"STORYFORK_SEED_PASSWORD": "x"}), \
                contextlib.redirect_stdout(io.StringIO()):
            seed.main([str(self.original)])
        self.assertEqual(1, len(self.works("원작")))
        self.assertEqual([1, 2, 3], sorted(self.works("원작")[0]["episodes"]))


class ScenePlanSeedTest(unittest.TestCase):
    """`plans.json`의 플롯 1개와 장면 계획을 만드는 흐름: 파일 순서가 비트 순서, 같은 제목은 건너뜀, 인물·장소는 서버가 받는 때만 보낸다."""
    PLOT = {"title": "시험 플롯", "content": "두 사람의 이야기."}
    SCENES = [{"episode": 2, "title": "첫 장면", "content": "가인이 나리를 만난다.", "characters": ["a", "b"]},
              {"episode": 2, "title": "둘째 장면", "content": "나리가 떠난다.", "characters": ["b"]},
              {"episode": 3, "title": "셋째 장면", "content": "가인이 홀로 남는다.", "characters": ["a"]}]
    ALL = ["시험 플롯", "첫 장면", "둘째 장면", "셋째 장면"]

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.fake = FakeStack()
        self.dir = write_dataset(Path(tmp.name), "orig", "원작", {1: "첫째 날.", 2: "둘째 날.", 3: "셋째 날."}, creationType="ORIGINAL", genres=["고전"])
        self.write_plans(self.SCENES)

    def write_plans(self, scenes):
        (self.dir / "plans.json").write_text(json.dumps({"plot": self.PLOT, "scenes": scenes}, ensure_ascii=False), encoding="utf-8")

    def seed(self):
        world = json.loads((self.dir / "world.json").read_text(encoding="utf-8"))
        return seed.seed(self.fake.call, world, owner=OWNER, base=self.dir)

    @property
    def work(self):
        (work,) = [w for w in self.fake.works.values() if w["title"] == "원작"]
        return work

    @property
    def plans(self):
        return self.fake.plans.get(self.work["id"], [])

    def test_creates_the_plot_first_then_every_scene_in_file_order(self):
        self.seed()
        self.assertEqual([("plot", "시험 플롯", None), ("scene", "첫 장면", 2), ("scene", "둘째 장면", 2), ("scene", "셋째 장면", 3)],
                         [(p["kind"], p["title"], p["episodeNumber"]) for p in self.plans])
        self.assertEqual({self.plans[0]["id"]}, {p["parentId"] for p in self.plans[1:]})  # 장면은 모두 그 플롯 아래

    def test_requests_carry_the_text_and_no_card_ids_by_default(self):
        self.seed()
        self.assertEqual({"kind": "plot", "title": "시험 플롯", "content": "두 사람의 이야기.", "revision": 0}, self.fake.plan_posts[0])
        self.assertEqual({"kind": "scene", "parentId": self.plans[0]["id"], "title": "첫 장면", "content": "가인이 나리를 만난다.", "episodeNumber": 2,
                          "characterIds": [], "placeIds": [], "revision": 0}, self.fake.plan_posts[1])

    def test_card_ids_are_sent_only_when_the_server_takes_them(self):
        """장면 계획 API는 설정집(레거시) id만 받아 WorldStudio 카드 id는 422다. 받게 되면 SEND_PLAN_REFS를 켠다."""
        with unittest.mock.patch.object(seed, "SEND_PLAN_REFS", True):
            body = seed.plan_payload({**self.SCENES[0], "places": ["ev"]}, "plot-id", "scope:")
        self.assertEqual(([seed.card_id("a", "scope:"), seed.card_id("b", "scope:")], [seed.card_id("ev", "scope:")]), (body["characterIds"], body["placeIds"]))

    def test_rerun_creates_no_plan_again(self):
        self.seed()
        before = len(self.fake.plan_posts)
        self.seed()
        self.assertEqual(before, len(self.fake.plan_posts))
        self.assertEqual(self.ALL, [p["title"] for p in self.plans])

    def test_a_failed_scene_resumes_in_order_without_duplicates(self):
        self.fake.fail_plan = 3  # 플롯(1)·첫 장면(2) 뒤 둘째 장면에서 실패
        with self.assertRaises(seed.SeedError) as caught:
            self.seed()
        self.assertIn("모의 서버 오류", str(caught.exception))
        self.assertNotIn("나리가 떠난다", str(caught.exception))  # 오류에는 상태와 서버의 detail만, 장면 글은 없다
        self.assertEqual(self.ALL[:2], [p["title"] for p in self.plans])
        self.fake.fail_plan = None
        self.seed()
        self.assertEqual(self.ALL, [p["title"] for p in self.plans])

    def test_a_plan_for_the_next_unwritten_episode_creates_that_draft_once(self):
        self.write_plans([{"episode": 4, "title": "다음 회차 장면", "content": "가인이 문을 연다.", "characters": ["a"]}])
        self.seed()
        self.seed()
        episodes = self.work["episodes"]
        self.assertEqual([1, 2, 3, 4], sorted(episodes))
        self.assertEqual(("새 회차", None), (episodes[4]["draft"]["title"], episodes[4]["published"]))
        self.assertEqual(["시험 플롯", "다음 회차 장면"], [p["title"] for p in self.plans])

    def test_a_plan_beyond_the_next_episode_is_refused_by_the_server(self):
        self.write_plans([{"episode": 5, "title": "먼 회차 장면", "content": "x", "characters": ["a"]}])
        with self.assertRaises(seed.SeedError) as caught:
            self.seed()
        self.assertIn("422", str(caught.exception))
        self.assertEqual([1, 2, 3], sorted(self.work["episodes"]))  # 먼 회차를 위해 초안을 만들지 않는다


if __name__ == "__main__":
    unittest.main()
