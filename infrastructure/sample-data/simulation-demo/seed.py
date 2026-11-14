#!/usr/bin/env python3
"""시연 세계관(world.json)을 로컬 스택의 공개 진입점으로 적재한다(표준 라이브러리만).

흐름: Core 로그인 → (새 작품이면) 작품 생성·회차 원고 저장·발행, (Fork면) 원작의 기준 회차에서 Fork 생성·자기 원고 발행
→ 세계관 생성(고정 id, 멱등) → 회차 오름차순으로 초안 저장(카드는 첫 저장, 관계는 회차별 `episode`) → 작품에 연결
→ (`plans.json`이 있으면) 플롯 1개와 장면 계획 생성(시뮬레이션 흐름 모드의 비트).
같은 id·key·제목으로 다시 실행해도 중복이 생기지 않는다(이미 같은 값이면 건너뛴다).
이미 다른 세계관이 연결된 작품은 덮어쓰지 않고 이유를 알린 뒤 실패한다.

    STORYFORK_SEED_PASSWORD='<개발 작가 비밀번호>' python3 infrastructure/sample-data/simulation-demo/seed.py [데이터셋 디렉터리] [--base-url http://localhost]

데이터셋 디렉터리를 생략하면 이 디렉터리의 별빛 서약의 탑(이미 있는 starlight 작품)이고, `guunmong`·`honggildong`은 새 작품,
`heukgildong-fork`는 먼저 `honggildong`을 적재한 뒤에 적재하는 Fork다.
"""
import argparse
import hashlib
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAMESPACE = uuid.UUID("03fd5631-9e70-4ff6-ab51-4f4e34c36413")  # 카드·관계 id를 key에서 결정적으로 만든다
EMAIL = "writer@example.test"  # starlight 소유자(개발 작가). 공개 개발 비밀번호는 core-api auth/V4__sample_member.sql 주석에 있다
# 화면(frontend studioRelations.ts relationDefinitions)이 읽는 술어와 (category, direction). 서버는 두 값을 그대로 저장하고,
# 화면은 술어에서 되읽은 값과 다르면 응답을 거부한다.
# ponytail: 이 세계관이 쓰는 술어만 둔다. 다른 술어가 필요하면 화면의 표와 같은 값으로 여기와 테스트에 더한다.
PREDICATES = {
    "custom_relation_directed": ("structural", "directed"),
    "custom_emotion": ("emotional", "directed"),
    "wary_of": ("emotional", "directed"),
    "trusts": ("emotional", "directed"),
    "likes": ("emotional", "directed"),
    "hostile_to": ("emotional", "directed"),
}
# 화면이 카드 유형을 되읽는 규칙(studioCards.ts cardTypeOf): cardType → (item.kind, item.entityType)
KINDS = {"character": ("entity", "character"), "location": ("entity", "location"), "object": ("entity", "object"),
         "rule": ("rule", None), "event": ("event", None)}
CARD_FIELDS = ("title", "body", "cardType", "areaCode", "classification", "aliases", "tags", "semanticMetadata", "visibility", "lifecycle")
RELATION_FIELDS = ("sourceCardId", "targetCardId", "category", "body", "label", "direction", "polarity", "semanticMetadata", "lifecycle")
# 장면 계획(Content `story-plans`)의 인물·장소는 서버가 설정집(레거시 `GET /works/{id}/world`의 settings) id만 받는다(StoryPlanService.validate).
# WorldStudio 카드 id는 422라 지금은 보내지 않는다. 등장 인물은 장면 본문에 이름으로 적고, plans.json의 characters·places에는 카드 key를 둔다.
# ponytail: 서버가 카드 id를 받게 되면 True로 바꾼다(그 밖에 바꿀 곳이 없다).
SEND_PLAN_REFS = False


class SeedError(Exception):
    """사용자에게 이유를 보여 줄 실패. 메시지에 요청 본문·비밀번호·토큰을 넣지 않는다."""


def scope_of(world):
    """id에 섞는 세계관 범위. 서버의 카드·관계 id는 세계관과 무관한 전역 기본키라 세계관마다 달라야 한다(같은 key여도).
    별빛 서약의 탑(`work.id`로 샘플 작품에 연결)은 처음부터 key만으로 id를 만들어 왔으니 이미 적재된 id를 지키려고 그대로 둔다."""
    return "" if "id" in world["work"] else world["world"]["id"] + ":"


def card_id(key, scope=""):
    return str(uuid.uuid5(NAMESPACE, "card:" + scope + key))


def relation_id(key, scope=""):
    return str(uuid.uuid5(NAMESPACE, "relation:" + scope + key))


def _item(**fields):
    """화면이 `semanticMetadata.studio.item`에서 되읽는 전체 필드(StudioSetting.item)."""
    item = {"topics": [], "entityType": None, "subjectId": None, "targetId": None, "predicate": None, "polarity": "asserted",
            "relatedIds": [], "condition": "", "timeText": "", "afterId": None, "orderEvidence": [], "evidence": [],
            "origin": "author_addition", "decision": "approved", **fields}
    item["authorText"] = item["text"]
    return item


def card_payload(card, scope=""):
    """world.json 카드 → `PUT /draft`의 CardPayload. 인물 문서(DEC-47)·독자 공개 회차는 semanticMetadata 최상위 키다."""
    kind, entity_type = KINDS[card["cardType"]]
    cid = card_id(card["key"], scope)
    item = _item(id=cid, kind=kind, entityType=entity_type, title=card["title"], text=card["body"], category=card["areaCode"],
                 timeText=card.get("timeText", ""))
    meta = {"studio": {"userCategory": card["classification"], "tags": card["tags"], "aliases": card["aliases"], "item": item}}
    for key in ("revealFromEpisode", "characterDocs"):
        if key in card:
            meta[key] = card[key]
    return {"id": cid, "title": card["title"], "body": card["body"], "cardType": card["cardType"], "areaCode": card["areaCode"],
            "classification": card["classification"], "aliases": card["aliases"], "tags": card["tags"],
            "semanticMetadata": meta, "visibility": card["visibility"], "lifecycle": "active"}


def relation_payload(rel, scope=""):
    """world.json 관계 기록(한 회차의 값) → RelationshipPayload."""
    category, direction = PREDICATES[rel["predicate"]]
    rid, polarity = relation_id(rel["key"], scope), rel.get("polarity", "asserted")
    source, target = card_id(rel["source"], scope), card_id(rel["target"], scope)
    item = _item(id=rid, kind="relation", title=rel["label"], text=rel["body"], category="basic", subjectId=source,
                 targetId=target, predicate=rel["predicate"], polarity=polarity)
    return {"id": rid, "sourceCardId": source, "targetCardId": target, "category": category, "body": rel["body"],
            "label": rel["label"], "direction": direction, "polarity": polarity, "lifecycle": "active",
            "semanticMetadata": {"studio": {"userCategory": "", "tags": [], "item": item}}}


def relations_at(world, episode):
    """episode 시점의 관계 전체: 관계(key)마다 episode 이하에서 가장 최근 값(DEC-51)."""
    latest = {}
    for rel in world["relationships"]:
        if rel["from"] <= episode and rel["from"] >= latest.get(rel["key"], rel)["from"]:
            latest[rel["key"]] = rel
    scope = scope_of(world)
    return [relation_payload(rel, scope) for rel in latest.values()]


def episodes(world):
    """초안을 저장할 회차(오름차순): 관계가 시작·바뀌는 회차와 1화."""
    return sorted({1, *(rel["from"] for rel in world["relationships"])})


def _ok(response, what):
    status, data = response
    if not 200 <= status < 300:
        detail = data.get("detail") if isinstance(data, dict) and isinstance(data.get("detail"), str) else ""
        raise SeedError(f"{what} 실패(HTTP {status}){': ' + detail[:300] if detail else ''}")
    return data


def _differs(wanted, found, fields):
    return found is None or any(wanted[field] != found.get(field) for field in fields)


def _publish_episodes(call, work, base, log):
    """`episodes/NN.md`(첫 줄 제목, 빈 줄, 본문)를 차례로 저장 버전으로 저장하고 발행한다. 이미 같은 글이 발행돼 있으면 건너뛴다."""
    have = {e["number"]: e for e in _ok(call("GET", f"/api/v1/works/{work}/episodes"), "회차 목록")}
    for path in sorted((base / "episodes").glob("*.md")):
        number = int(path.stem)
        title, _, body = path.read_text(encoding="utf-8").partition("\n")
        title, body = title.strip(), body.strip()
        episode = have.get(number) or _ok(call("POST", f"/api/v1/works/{work}/episodes", {"title": title}), f"{number}화 만들기")
        published = next((v for v in episode["versions"] if v["id"] == episode["publishedVersionId"]), None)
        if published and (published["title"], published["body"]) == (title, body):
            continue
        saved = _ok(call("POST", f"/api/v1/works/{work}/episodes/{number}/versions",
                         {"title": title, "body": body, "revision": episode["draft"]["revision"]}), f"{number}화 저장")
        _ok(call("POST", f"/api/v1/works/{work}/episodes/{number}/publish",
                 {"revision": saved["draft"]["revision"], "rightsConfirmed": True, "versionId": saved["versions"][-1]["id"]}), f"{number}화 발행")
        log(f"{number}화 발행")


def _ensure_work(call, spec, base, log):
    """제목으로 내 작품을 찾고 없으면 만든다(Fork는 원작의 기준 회차에서 갈라진다). 원고를 발행하고 작품 id를 돌려준다."""
    works = _ok(call("GET", "/api/v1/works"), "작품 목록")
    fork = spec.get("fork")
    if fork:
        source_title = json.loads((base / fork["sourceDir"] / "world.json").read_text(encoding="utf-8"))["work"]["title"]
        source = next((w for w in works if w["title"] == source_title and not w.get("source")), None)
        if source is None:
            raise SeedError(f"원작 「{source_title}」이(가) 아직 없어요. 먼저 {fork['sourceDir']}의 원작 데이터셋을 적재하세요.")
        mine = next((w for w in works if (w.get("source") or {}).get("workId") == source["id"]), None) or _ok(
            call("POST", f"/api/v1/works/{source['id']}/forks", {"episode": fork["episode"], "title": spec["title"],
                                                                "summary": spec.get("summary", ""), "direction": fork.get("direction", "")}), "Fork 생성")
    else:
        mine = next((w for w in works if w["title"] == spec["title"] and not w.get("source")), None) or _ok(
            call("POST", "/api/v1/works", {"title": spec["title"], "summary": spec.get("summary", ""), "creationType": spec["creationType"],
                                           "genres": spec["genres"], "hashtags": spec.get("hashtags", []), "rightsConfirmed": True}), "작품 생성")
    _publish_episodes(call, mine["id"], base, log)
    if spec.get("allowFork"):  # Fork를 만들려면 원작이 분기를 허용해야 한다
        row = _ok(call("GET", f"/api/v1/works/{mine['id']}"), "작품 조회")
        if not (row["allowFork"] and row["allowForkPublication"]):
            _ok(call("PUT", f"/api/v1/works/{mine['id']}/policy",
                     {"revision": row["revision"], "allowFork": True, "allowForkPublication": True}), "분기 허용")
            log("분기를 허용했어요")
    return mine["id"]


def plan_payload(scene, parent, scope):
    """plans.json 장면 → `POST /story-plans` 본문(새 계획이라 revision 0). 인물·장소는 카드 key를 id로 바꿔 SEND_PLAN_REFS일 때만 보낸다."""
    ids = lambda keys: [card_id(key, scope) for key in keys] if SEND_PLAN_REFS else []  # noqa: E731
    return {"kind": "scene", "parentId": parent, "title": scene["title"], "content": scene["content"], "episodeNumber": scene["episode"],
            "characterIds": ids(scene["characters"]), "placeIds": ids(scene.get("places", [])), "revision": 0}


def _seed_plans(call, work, plans, scope, log):
    """plans.json의 플롯 1개와 장면 계획을 만든다. 같은 제목이 이미 있으면 건너뛰고, 장면은 파일 순서대로 만든다(서버 목록 순서가 비트 순서다).
    장면은 있는 회차에 붙는다. 마지막 회차 바로 다음 번호는 없으면 빈 초안을 만든다(앱이 발행 뒤 만드는 것과 같다). 그보다 먼 회차는 서버가 422로 거절한다."""
    path = f"/api/v1/works/{work}"
    have = {e["number"] for e in _ok(call("GET", path + "/episodes"), "회차 목록")}
    existing = _ok(call("GET", path + "/story-plans"), "장면 계획 목록")
    plot = next((p for p in existing if p["kind"] == "plot" and p["title"] == plans["plot"]["title"]), None)
    if plot is None:
        plot = _ok(call("POST", path + "/story-plans", {"kind": "plot", **plans["plot"], "revision": 0}), "플롯 만들기")
        log(f"플롯 「{plot['title']}」을 만들었어요")
    done = {p["title"] for p in existing if p["kind"] == "scene" and p["parentId"] == plot["id"]}
    made = 0
    for scene in plans["scenes"]:
        if scene["title"] in done:
            continue
        if scene["episode"] == max(have, default=0) + 1:
            _ok(call("POST", path + "/episodes", {"title": "새 회차"}), f"{scene['episode']}화 만들기")
            have.add(scene["episode"])
        _ok(call("POST", path + "/story-plans", plan_payload(scene, plot["id"], scope)), f"장면 계획 「{scene['title']}」")
        made += 1
    log(f"장면 계획: 새로 {made}개(전체 {len(plans['scenes'])}개)")


def seed(call, world, owner=None, log=lambda *_: None, base=HERE):
    """call(method, path, body) → (status, json)로 적재하고 회차별 관계 수 {회차: 수}를 돌려준다. base는 world.json이 있는 디렉터리다."""
    wid, spec = world["world"]["id"], world["work"]
    name, description = world["world"]["name"], world["world"]["description"]
    if "id" in spec:  # 이미 있는 샘플 작품에 연결한다
        work = spec["id"]
        row = _ok(call("GET", f"/api/v1/works/{work}"), "작품 조회")
        if owner and row.get("ownerId") != owner:
            raise SeedError(f"이 계정은 {spec['slug']} 작품의 소유자가 아니에요. 개발 작가({EMAIL})로 실행하세요.")
    else:
        work = _ensure_work(call, spec, base, log)
        row = _ok(call("GET", f"/api/v1/works/{work}"), "작품 조회")
    linked = row.get("worldStudioId")
    if linked and linked != wid:
        raise SeedError(f"작품에 이미 다른 세계관({linked})이 연결돼 있어 덮어쓰지 않아요. "
                        "그 연결을 직접 해제하거나 그 세계관을 그대로 쓰세요.")
    _ok(call("POST", "/api/v1/world-studios", {"id": wid, "name": name, "description": description}), "세계관 생성")
    scope = scope_of(world)
    cards = [card_payload(card, scope) for card in world["cards"]]
    for episode in episodes(world):
        draft = _ok(call("GET", f"/api/v1/world-studios/{wid}?episode={episode}"), f"{episode}화 시점 조회")
        have_cards = {c["id"]: c for c in draft["cards"]}
        have_relations = {r["id"]: r for r in draft["relationships"]}
        new_cards = [c for c in cards if _differs(c, have_cards.get(c["id"]), CARD_FIELDS)]
        new_relations = [r for r in relations_at(world, episode) if _differs(r, have_relations.get(r["id"]), RELATION_FIELDS)]
        if not new_cards and not new_relations:
            log(f"{episode}화: 이미 적재돼 있어요")
            continue
        body = {"expectedDraftRevision": draft["draftRevision"], "name": name, "description": description,
                "cards": new_cards, "relationships": new_relations, "replace": False, "episode": episode}
        # 결과를 못 받았을 때 같은 입력으로 다시 보내면 서버가 같은 요청으로 알아보도록, 키는 입력에서 정한다.
        digest = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]
        _ok(call("PUT", f"/api/v1/world-studios/{wid}/draft", {**body, "key": f"simulation-demo-{episode}-{digest}"}), f"{episode}화 저장")
        log(f"{episode}화: 카드 {len(new_cards)}개·관계 {len(new_relations)}개 저장")
    if linked != wid:
        _ok(call("PUT", f"/api/v1/works/{work}/world-studio", {"worldId": wid}), "작품 연결")
        log("작품에 연결했어요")
    if (base / "plans.json").exists():
        _seed_plans(call, work, json.loads((base / "plans.json").read_text(encoding="utf-8")), scope, log)
    counts = {ep: len(_ok(call("GET", f"/api/v1/world-studios/{wid}?episode={ep}"), f"{ep}화 시점 확인")["relationships"])
              for ep in range(1, max(episodes(world)) + 1)}
    log("회차별 관계 수: " + " · ".join(f"{ep}화 {n}" for ep, n in counts.items()))
    if len(counts) > 1 and len(set(counts.values())) == 1:
        raise SeedError("회차별 관계 수가 모두 같아요. 회차별 관계가 저장되지 않은 것 같아요(DEC-51).")
    return counts


class Client:
    """공개 진입점(nginx) HTTP 호출: 쿠키 보관, 변경 요청마다 CSRF 토큰, 로그인 뒤 Bearer."""

    def __init__(self, base_url):
        self.base, self.token = base_url.rstrip("/"), None
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def _open(self, request):
        try:
            with self.opener.open(request, timeout=30) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read()
        except urllib.error.URLError as error:
            raise SeedError(f"서버에 연결하지 못했어요: {error.reason}") from None
        try:
            return status, json.loads(raw) if raw else None
        except ValueError:
            return status, None

    def call(self, method, path, body=None):
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        if method != "GET":
            csrf = _ok(self._open(urllib.request.Request(self.base + "/api/v1/auth/csrf", headers={"Accept": "application/json"})), "CSRF 토큰")
            headers["X-CSRF-TOKEN"] = csrf["csrfToken"]
        data = None
        if body is not None:
            data, headers["Content-Type"] = json.dumps(body, ensure_ascii=False).encode("utf-8"), "application/json"
        return self._open(urllib.request.Request(self.base + path, data, headers, method=method))

    def login(self, email, password):
        status, data = self.call("POST", "/api/v1/auth/login", {"email": email, "password": password})
        if status != 200:
            raise SeedError(f"로그인하지 못했어요(HTTP {status}). 이메일·비밀번호를 확인하세요.")
        self.token = data["accessToken"]
        return data["user"]["id"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="시연 세계관을 로컬 스택에 적재하고 작품에 연결한다(새 작품·Fork는 원고도 발행한다).")
    parser.add_argument("directory", nargs="?", default=".", help="데이터셋 디렉터리(기본: 이 디렉터리의 별빛 서약의 탑)")
    parser.add_argument("--base-url", default="http://localhost", help="공개 진입점 주소(기본 http://localhost)")
    parser.add_argument("--password", default=os.environ.get("STORYFORK_SEED_PASSWORD"),
                        help="비밀번호(생략하면 환경변수 STORYFORK_SEED_PASSWORD)")
    args = parser.parse_args(argv)
    if not args.password:
        sys.exit("비밀번호가 필요해요: 환경변수 STORYFORK_SEED_PASSWORD 또는 --password")
    base = (HERE / args.directory).resolve()
    world = json.loads((base / "world.json").read_text(encoding="utf-8"))
    client = Client(args.base_url)
    try:
        member = client.login(EMAIL, args.password)
        seed(client.call, world, owner=member, log=print, base=base)
    except SeedError as error:
        sys.exit(f"실패: {error}")


if __name__ == "__main__":
    main()
