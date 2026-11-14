"""시연 세계관(world.json)의 형식·회차 지식 계약과 seed.py의 적재 흐름을 확인하는 순수 단위 테스트다.

DB·네트워크·서버를 쓰지 않는다. 실행(저장소 루트에서):
    python3 -m unittest infrastructure/sample-data/simulation-demo/test_world.py
"""
import importlib.util
import json
import math
import os
import re
import unittest
import unittest.mock
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("simulation_demo_seed", HERE / "seed.py")
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)

WORLD = json.loads((HERE / "world.json").read_text(encoding="utf-8"))
STARLIGHT_ID = "ba084057-8d94-3da5-86f0-ab54ce5703b0"  # infrastructure/sample-data/content/work.csv
MANUSCRIPT_EPISODES = 3  # starlight 원고는 1~3화(content/episode.csv)
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
}
# 화면이 카드 유형을 되읽는 규칙(cardTypeOf): 이 표와 어긋나면 화면이 응답을 거부한다
UI_KINDS = {"character": ("entity", "character"), "location": ("entity", "location"), "object": ("entity", "object"),
            "rule": ("rule", None), "event": ("event", None)}

CARDS = {c["key"]: c for c in WORLD["cards"]}
CHARACTERS = {k: c for k, c in CARDS.items() if c["cardType"] == "character"}
RELS = WORLD["relationships"]


def records_at(episode):
    """episode 시점에 유효한 관계 기록: 관계(key)마다 episode 이하에서 가장 최근 값(DEC-51)."""
    latest = {}
    for rel in RELS:
        if rel["from"] <= episode and rel["from"] >= latest.get(rel["key"], rel)["from"]:
            latest[rel["key"]] = rel
    return list(latest.values())


def knowers(event, episode):
    """episode 시점에 그 사건과 이어진 인물."""
    return {r["source"] for r in records_at(episode) if r["target"] == event and r["source"] in CHARACTERS}


class WorldFormatTest(unittest.TestCase):
    def test_world_and_work(self):
        uuid.UUID(WORLD["world"]["id"])
        self.assertEqual(STARLIGHT_ID, WORLD["work"]["id"])
        self.assertEqual("starlight", WORLD["work"]["slug"])
        self.assertTrue(0 < len(WORLD["world"]["name"]) <= 100)
        self.assertLessEqual(len(WORLD["world"]["description"]), 20000)

    def test_card_mix_and_visibility(self):
        count = lambda *types: sum(c["cardType"] in types for c in WORLD["cards"])  # noqa: E731
        self.assertIn(count("character"), (3, 4))
        self.assertIn(count("event"), (3, 4))
        self.assertIn(count("object"), (1, 2))
        self.assertTrue(2 <= count("location", "rule") <= 4)
        self.assertEqual(len(WORLD["cards"]), len(CARDS))  # key 중복 없음
        for card in WORLD["cards"]:
            if card["cardType"] in ("location", "rule"):
                self.assertEqual("public", card["visibility"], card["key"])  # 누구나 아는 세계 설정
            if card["cardType"] in ("character", "event"):
                self.assertEqual("private", card["visibility"], card["key"])  # 지식은 관계로만 퍼진다

    def test_cards_follow_server_limits(self):
        self.assertEqual(len({c["title"] for c in WORLD["cards"]}), len(WORLD["cards"]))
        for card in WORLD["cards"]:
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
        for key, card in CHARACTERS.items():
            docs = card["characterDocs"]
            self.assertEqual({"soul", "memory", "episodes"}, set(docs), key)
            self.assertTrue(docs["soul"].strip() and docs["memory"].strip(), key)
            self.assertTrue(docs["episodes"], key)
            for number, text in docs["episodes"].items():
                self.assertRegex(number, EPISODE_KEY, key)
                self.assertTrue(text.strip(), f"{key} {number}")
            for text in [docs["soul"], docs["memory"], *docs["episodes"].values()]:
                self.assertLessEqual(len(text), DOC_MAX, key)
            souls.append(docs["soul"])
        for key, card in CARDS.items():
            self.assertEqual(key in CHARACTERS, "characterDocs" in card, key)  # 인물 카드에만 문서가 있다
        grams = [{s[i:i + 2] for i in range(len(s) - 1)} for s in souls]  # 말투가 서로 달라야 한다(복붙 방지)
        for i in range(len(grams)):
            for j in range(i + 1, len(grams)):
                self.assertLess(len(grams[i] & grams[j]) / len(grams[i] | grams[j]), 0.5)

    def test_relationships_are_well_formed(self):
        versions = {}
        for rel in RELS:
            who = f"{rel['key']}@{rel['from']}"
            self.assertRegex(rel["key"], KEY)
            self.assertTrue(isinstance(rel["from"], int) and rel["from"] >= 1, who)
            self.assertIn(rel["source"], CARDS, who)
            self.assertIn(rel["target"], CARDS, who)
            self.assertNotEqual(rel["source"], rel["target"], who)
            self.assertIn(rel["predicate"], seed.PREDICATES, who)
            self.assertIn(rel.get("polarity", "asserted"), ("asserted", "denied"), who)
            self.assertTrue(0 < len(rel["label"]) <= 200, who)
            self.assertTrue(rel["body"].strip() and len(rel["body"]) <= DOC_MAX, who)
            versions.setdefault(rel["key"], []).append(rel)
        for key, rels in versions.items():
            self.assertEqual(len(rels), len({r["from"] for r in rels}), key)  # 같은 회차에 값이 둘이면 안 된다
            self.assertEqual(1, len({(r["source"], r["target"]) for r in rels}), key)  # 끝점은 회차가 바뀌어도 같다
        kinds = {(CARDS[r["source"]]["cardType"], CARDS[r["target"]]["cardType"]) for r in RELS}
        self.assertIn(("character", "character"), kinds)
        self.assertIn(("character", "event"), kinds)
        self.assertIn(("character", "object"), kinds)
        self.assertTrue(any(r.get("polarity") == "denied" for r in RELS))  # 부정 관계
        self.assertTrue(any(len(v) >= 2 for v in versions.values()))  # 회차에 따라 값이 바뀌는 관계

    def test_denied_relations_are_named_positively_and_do_not_replace_the_link(self):
        """소비자(simulation·화면)는 부정 관계를 'label 아님'으로 보이고, recall 필터는 긍정 관계만 연결로 센다."""
        for rel in RELS:
            if rel.get("polarity") == "denied":
                self.assertNotRegex(rel["label"], r"^(불|비|무|반)|않|아님|못", rel["key"])  # '불신 아님'은 이중부정
                pair = {rel["source"], rel["target"]}
                self.assertTrue(any(r.get("polarity", "asserted") == "asserted" and {r["source"], r["target"]} == pair
                                    for r in records_at(rel["from"])), rel["key"])

    def test_cards_a_character_names_are_linked_to_that_character(self):
        """recall 필터는 인물·물건 카드를 그 인물과 긍정 관계로 이어져 있을 때만 아는 것으로 본다(장소·규칙은 누구나)."""
        for key, card in CHARACTERS.items():
            docs = card["characterDocs"]
            text = " ".join([docs["soul"], docs["memory"], *docs["episodes"].values()])
            for other_key, other in CARDS.items():
                if other_key != key and other["cardType"] in ("character", "object") and other["title"] in text:
                    self.assertTrue(any(r.get("polarity", "asserted") == "asserted" and {r["source"], r["target"]} == {key, other_key}
                                        for r in RELS), f"{key}가 말하는 {other_key}와 이어진 긍정 관계가 없다")

    def test_relation_count_grows_with_episodes(self):
        counts = [len(seed.relations_at(WORLD, ep)) for ep in range(1, 6)]
        self.assertEqual(counts, [len(records_at(ep)) for ep in range(1, 6)])
        self.assertLess(counts[0], counts[1])  # 1화 < 2화 < 3화
        self.assertLess(counts[1], counts[2])
        self.assertLessEqual(counts[2], counts[4])

    def test_same_event_is_known_by_more_characters_later(self):
        events = [k for k, c in CARDS.items() if c["cardType"] == "event"]
        for event in events:  # 모든 사건을 아는 인물이 한 명은 있다
            self.assertTrue(any(knowers(event, ep) for ep in range(1, 8)), event)
        self.assertTrue(any(knowers(e, 1) and knowers(e, 1) < knowers(e, 2) for e in events))  # 1화엔 A만, 2화부터 B도

    def test_a_later_event_is_hidden_from_readers_and_learned_after_the_manuscript(self):
        hidden = [k for k, c in CARDS.items() if c["cardType"] == "event" and "revealFromEpisode" not in c]
        self.assertTrue(hidden)
        late = [r for r in RELS if r["target"] in hidden and r["source"] in CHARACTERS and r["from"] > MANUSCRIPT_EPISODES]
        self.assertTrue(late)  # 원고 3화까지에 없는 시연용 전개
        for card in CARDS.values():
            if card["cardType"] == "event" and card["key"] not in hidden:
                self.assertLessEqual(card["revealFromEpisode"], MANUSCRIPT_EPISODES)

    def test_secrets_stay_with_their_holders(self):
        self.assertTrue(WORLD["secrets"])
        for secret in WORLD["secrets"]:
            phrase, holders, learned = secret["phrase"], set(secret["holders"]), secret.get("learnedBy", {})
            self.assertTrue(holders and holders <= set(CHARACTERS))
            self.assertNotIn(phrase, WORLD["world"]["description"])
            for holder in holders:  # 비밀은 보유자의 MEMORY.md에 있다
                self.assertIn(phrase, CHARACTERS[holder]["characterDocs"]["memory"], holder)
            others = set(CHARACTERS) - holders
            self.assertTrue(others)
            for key in others:  # 다른 인물의 입력(기준 회차 이하 문서)에는 나오지 않는다
                docs = CHARACTERS[key]["characterDocs"]
                known_from = learned.get(key, math.inf)
                visible = [CHARACTERS[key]["body"], docs["soul"], docs["memory"],
                           *(t for n, t in docs["episodes"].items() if int(n) < known_from)]
                for text in visible:
                    self.assertNotIn(phrase, text, key)
            for key, card in CARDS.items():  # 카드 본문에 있으면 독자에게도 숨겨진 비공개 카드여야 한다
                if key not in CHARACTERS and phrase in card["title"] + card["body"]:
                    self.assertEqual("private", card["visibility"], key)
                    self.assertNotIn("revealFromEpisode", card, key)
            for rel in RELS:  # 관계는 양 끝 인물이 모두 안 뒤에만 쓸 수 있다
                if phrase in rel["label"] + rel["body"]:
                    for end in (rel["source"], rel["target"]):
                        if end in CHARACTERS and end not in holders:
                            self.assertLessEqual(learned.get(end, math.inf), rel["from"], f"{rel['key']}@{rel['from']}")

    def test_card_payloads_match_server_and_ui_contract(self):
        ids = set()
        for card in WORLD["cards"]:
            payload = seed.card_payload(card)
            self.assertEqual({"id", "title", "body", "cardType", "areaCode", "classification", "aliases", "tags",
                              "semanticMetadata", "visibility", "lifecycle"}, set(payload))
            self.assertEqual(seed.card_id(card["key"]), payload["id"])
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
        self.assertEqual(len(WORLD["cards"]), len(ids))

    def test_relation_payloads_match_server_and_ui_contract(self):
        for pred, expected in seed.PREDICATES.items():
            self.assertEqual(UI_PREDICATES[pred], expected, pred)
        for rec in RELS:
            payload = seed.relation_payload(rec)
            category, direction = UI_PREDICATES[rec["predicate"]]
            self.assertEqual((seed.relation_id(rec["key"]), seed.card_id(rec["source"]), seed.card_id(rec["target"]),
                              category, direction, rec.get("polarity", "asserted"), rec["label"], rec["body"], "active"),
                             tuple(payload[k] for k in ("id", "sourceCardId", "targetCardId", "category", "direction",
                                                        "polarity", "label", "body", "lifecycle")))
            item = payload["semanticMetadata"]["studio"]["item"]
            self.assertEqual(("relation", payload["id"], payload["label"], payload["body"], payload["sourceCardId"],
                              payload["targetCardId"], payload["polarity"], rec["predicate"]),
                             (item["kind"], item["id"], item["title"], item["text"], item["subjectId"],
                              item["targetId"], item["polarity"], item["predicate"]))
        keys = {r["key"] for r in RELS}
        self.assertEqual(len(keys), len({seed.relation_id(k) for k in keys}))

    def test_requests_fit_server_limits(self):
        self.assertLessEqual(len(WORLD["cards"]), 1000)
        for ep in seed.episodes(WORLD):
            self.assertLessEqual(len(seed.relations_at(WORLD, ep)), 1000)
        size = len(json.dumps([seed.card_payload(c) for c in WORLD["cards"]], ensure_ascii=False).encode())
        self.assertLess(size, 1_000_000)  # 서버 한도 2,000,000바이트(WorldStudioService.validateEditRequest)


OWNER = "11111111-1111-4111-8111-111111111111"
OTHER_WORLD = "22222222-2222-4222-8222-222222222222"


class FakeStack:
    """Content 최소 모의: draftRevision·회차별 관계(DEC-51)·작품 연결 규칙만 흉내 낸다."""

    def __init__(self, linked=None, owner=OWNER):
        self.linked, self.owner, self.world = linked, owner, None
        self.puts, self.calls, self.fail_put = [], [], None

    def call(self, method, path, body=None):
        self.calls.append((method, path))
        status, data = self.route(method, path, None if body is None else json.loads(json.dumps(body)))
        return status, json.loads(json.dumps(data))

    def route(self, method, path, body):
        route, _, query = path.partition("?")
        if (method, route) == ("POST", "/api/v1/world-studios"):
            self.world = self.world or {"id": body["id"], "revision": 0, "cards": {}, "edges": {}}
            return 200, self.draft(None)
        if method == "GET" and route.startswith("/api/v1/works/"):
            return 200, {"id": route.rsplit("/", 1)[1], "ownerId": self.owner, "worldStudioId": self.linked}
        if method == "GET" and route.startswith("/api/v1/world-studios/"):
            return 200, self.draft(int(query.split("=")[1]) if query else None)
        if method == "PUT" and route.endswith("/draft"):
            return self.put(body)
        if method == "PUT" and route.endswith("/world-studio"):
            if self.linked not in (None, body["worldId"]):
                return 409, {"detail": "이미 연결돼 있어요"}
            self.linked = body["worldId"]
            return 200, {"workId": route.split("/")[4], "worldId": self.linked}
        raise AssertionError(f"모의에 없는 호출: {method} {path}")

    def draft(self, episode):
        world, rels = self.world, []
        for history in world["edges"].values():
            seen = [e for e in history if episode is None or e <= episode]
            if seen:
                rels.append(history[max(seen)])
        return {"worldId": world["id"], "draftRevision": world["revision"], "cards": list(world["cards"].values()),
                "relationships": rels}

    def put(self, body):
        world = self.world
        self.puts.append(body)
        if self.fail_put == len(self.puts):
            return 500, {"detail": "모의 서버 오류"}
        if body["expectedDraftRevision"] != world["revision"]:
            return 409, {"detail": "draftRevision이 달라요"}
        for card in body["cards"]:
            world["cards"][card["id"]] = card
        for rel in body["relationships"]:
            history = world["edges"].setdefault(rel["id"], {})
            seen = [e for e in history if e <= body["episode"]]
            if not seen or history[max(seen)] != rel:
                history[body["episode"]] = rel
        world["revision"] += 1
        return 200, self.draft(body["episode"])


class SeedFlowTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
