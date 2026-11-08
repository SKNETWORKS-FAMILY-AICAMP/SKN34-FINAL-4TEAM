"""Offline CSV reproduction from immutable provenance; CSV files are authoritative import inputs."""
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import uuid

HERE = Path(__file__).resolve().parent
STAMP = "2026-11-01T00:00:00Z"  # Synthetic fixture time, not historical publication provenance.
NS = "storyfork-sample-v1"

# Explicit fact -> original episode + exact supporting passage in the frozen inventory.
# Unlisted/changed facts are stored privately (NULL), never dated by a character's first appearance.
PROPERTY_DISCLOSURES = [
    ("guunmong", "char:성진", 0, "설명", "연화봉의 젊은 승려", 1, "스무 살의 젊은 승려 성진"),
    ("guunmong", "char:성진", 0, "나이", "20", 1, "스무 살의 젊은 승려 성진"),
    ("guunmong", "char:성진", 0, "소속", "연화봉 도량", 1, "육관대사가 도량을 열고 있었다"),
    ("guunmong", "char:성진", 0, "관계", "육관대사의 제자", 1, "수백 명의 제자 가운데 대사가 가장 아끼는 이는"),
    ("guunmong", "char:성진", 1, "상태", "계율을 어기고 술을 마심", 1, "끝내 석 잔을 받아 마셨다"),
    ("guunmong", "char:성진", 2, "상태", "마음이 흔들림", 3, "부귀와 공명, 아름다운 사람들과 함께하는 삶이 자꾸만 눈앞에 그려졌다"),
    ("guunmong", "char:성진", 3, "상태", "벌을 받아 인간 세상으로", 4, "양 처사의 집에 아이 울음소리가 울렸다"),
    ("guunmong", "char:육관대사", 0, "관계", "성진의 스승", 1, "수백 명의 제자 가운데 대사가 가장 아끼는 이는"),
    ("guunmong", "char:육관대사", 0, "소속", "연화봉 도량", 1, "연화봉에는 서역에서 온 육관대사가 도량을 열고 있었다"),
    ("guunmong", "char:팔선녀", 0, "설명", "위부인을 모시는 여덟 선녀", 2, "남악 위부인의 심부름으로 여덟 선녀"),
    ("guunmong", "char:팔선녀", 0, "소속", "남악 위부인", 2, "남악 위부인의 심부름으로 여덟 선녀"),
    ("guunmong", "char:팔선녀", 0, "관계", "성진에게서 구슬을 받음", 2, "꽃잎은 여덟 알의 구슬이 되어 선녀들의 손에 하나씩 떨어졌다"),
    ("guunmong", "char:양소유", 0, "소속", "회남 수주현 양 처사 댁", 4, "회남 땅 수주현, 양 처사의 집에 아이 울음소리가 울렸다"),
    ("guunmong", "place:연화봉", 0, "첫 등장", "1화", 1, "남악 형산의 연화봉"),
    ("guunmong", "place:동정호 용궁", 0, "첫 등장", "1화", 1, "동정호 용왕께 감사의 뜻을 전하고 오너라"),
    ("guunmong", "place:돌다리", 0, "첫 등장", "2화", 2, "선녀들은 돌다리 위에 앉아"),
    ("guunmong", "item:여덟 구슬", 0, "첫 등장", "2화", 2, "꽃잎은 여덟 알의 구슬이 되어"),
    ("guunmong", "org:연화봉 도량", 0, "첫 등장", "1화", 1, "연화봉에는 서역에서 온 육관대사가 도량을 열고 있었다"),
    ("starlight", "char:리안", 0, "관계", "오르벤의 제자", 1, "스승 오르벤이 탑에서 사라진 지"),
    ("starlight", "char:리안", 2, "상태", "봉인의 속삭임을 들음", 2, "리안은 희미한 속삭임을 들었다"),
    ("starlight", "char:카엘", 0, "설명", "탑을 지키는 기사", 1, "문을 지키던 기사 카엘"),
    ("starlight", "char:카엘", 0, "소속", "별빛 탑 기사", 1, "문을 지키던 기사 카엘"),
    ("starlight", "char:카엘", 0, "관계", "리안을 경계하다 서고 열람을 허락", 2, "리안이 서고를 열람하는 것만은 허락했다"),
    ("starlight", "char:세라핀", 0, "설명", "재의 왕국 사절", 3, "재의 왕국의 사절단이 탑 앞에 도착했다"),
    ("starlight", "char:세라핀", 0, "소속", "재의 왕국 사절단", 3, "선두에 선 여인은 붉은 망토를 두른 세라핀"),
    ("starlight", "char:세라핀", 0, "관계", "리안에게 손을 내밂", 3, "나도 도와줄 수 있는데"),
    ("starlight", "place:별빛 탑", 0, "첫 등장", "1화", 1, "리안은 별빛 탑의 문 앞에 닿았다"),
    ("starlight", "place:지하서고", 0, "첫 등장", "2화", 2, "지하서고 가장 깊은 곳에서"),
    ("starlight", "item:별빛 수정", 0, "첫 등장", "1화", 1, "탑 꼭대기의 별빛 수정"),
    ("starlight", "item:오르벤의 서한", 0, "첫 등장", "1화", 1, "그가 남긴 것은 낡은 서한 한 장뿐"),
    ("starlight", "org:재의 왕국 사절단", 0, "첫 등장", "3화", 3, "재의 왕국의 사절단이 탑 앞에 도착했다"),
    ("postman", "char:도윤", 0, "관계", "하람과 편지로 엮임", 2, "하람은 도윤을 기다리고 있었다"),
    ("postman", "char:하람", 0, "소속", "7구역", 2, "7구역 배급소 앞에서 하람"),
    ("postman", "char:하람", 0, "관계", "편지의 글씨가 어머니 것이라고 말함", 2, "그 편지, 우리 엄마 글씨야"),
    ("postman", "place:고가도로", 0, "첫 등장", "1화", 1, "도윤은 고가도로 위에서"),
    ("postman", "place:7구역 배급소", 0, "첫 등장", "2화", 2, "7구역 배급소 앞에서"),
    ("postman", "item:주소가 지워진 편지", 0, "첫 등장", "1화", 1, "주소가 지워진 편지 한 통"),
    ("hong", "char:길동", 0, "설명", "홍 판서의 서자", 1, "그러나 길동은 서자였기에"),
    ("hong", "char:길동", 0, "소속", "홍 판서 댁", 1, "홍 판서의 집에 길동이라는 아이"),
    ("hong", "char:길동", 0, "성격", "총명함", 1, "길동은 어려서부터 총명하여"),
    ("hong", "char:길동", 0, "관계", "홍 판서의 서자", 1, "그러나 길동은 서자였기에"),
    ("hong", "char:길동", 0, "상태", "설움", 1, "이보다 더한 설움이 어디 있겠습니까"),
    ("hong", "char:홍 판서", 0, "설명", "길동의 아버지", 1, "그러나 길동은 서자였기에 아버지를"),
    ("hong", "char:홍 판서", 0, "관계", "길동의 아버지", 1, "그러나 길동은 서자였기에 아버지를"),
    ("hong", "place:홍 판서 댁", 0, "첫 등장", "1화", 1, "홍 판서의 집에 길동이라는 아이"),
]


def key(*parts):
    return str(uuid.UUID(bytes=hashlib.md5("\0".join(map(str, parts)).encode()).digest(), version=3))


def core_rows(source):
    members = {}
    for author in source["authors"]:
        if author["canonicalOwnerLabel"] == "개발 작가":
            continue  # Existing development writer; never change credentials or privileges.
        members[author["proposedSubjectId"]] = dict(id=author["proposedSubjectId"], email=author["proposedEmail"],
            password_hash="!sample-import-login-disabled", nickname=author["canonicalOwnerLabel"], operator=False)
    return {"auth_member": list(members.values())}


def first_episode(work, doc):
    if doc["cat"] == "event":
        return doc["ep"]
    if doc["cat"] == "char":
        return min((e[0] for e in work.get("events", []) if doc["t"] in e[3]), default=1)
    if doc["cat"] == "world":
        return work.get("ruleFrom", {}).get(doc["t"], 1)
    return int(re.search(r"\d+", doc.get("props", {}).get("첫 등장", "1")).group())


def content_rows(source):
    disclosure = {}
    for slug, doc, epoch, name, value, public_at, passage in PROPERTY_DISCLOSURES:
        episode = next(e for m in source['canonicalMappings'] if m['slug'] == slug for e in m['episodes'] if e['number'] == public_at)
        if passage not in episode['body'] or public_at < epoch:
            raise ValueError(f'Invalid property disclosure evidence: {slug}/{doc}/{name}')
        disclosure[slug, doc, epoch, name, value] = public_at
    rows = {}
    seen = {}

    def add(table, **values):
        signature = json.dumps(values, sort_keys=True, ensure_ascii=False)
        if signature not in seen.setdefault(table, set()):
            seen[table].add(signature)
            rows.setdefault(table, []).append(values)

    works = {w["id"]: w for w in source["works"]}
    maps = {m["slug"]: m for m in source["canonicalMappings"]}
    for owner in dict.fromkeys(m["ownerSubjectId"] for m in maps.values()):
        add("member", id=owner)
    for slug, w in works.items():
        m = maps[slug]
        wid, owner = m["workId"], m["ownerSubjectId"]
        base = works.get(w.get("parent"), w)
        add("work", id=wid, owner_id=owner, title=w["title"], description=w.get("summary", w.get("dir", "")),
            origin_kind="fork" if w.get("parent") else "original", creation_type="original", revision=0,
            deleted_episode_revision=0, created_at=STAMP, slug=slug, author_name=w["author"], theme=w["theme"],
            hook=w.get("hook", ""), hanja=w.get("hanja"), hero_line1=w.get("hero", [None, None])[0],
            hero_line2=w.get("hero", [None, None])[1], hero_background=w.get("heroBg"))
        add("world", id=wid, owner_id=owner, name=w["title"] + " 설정집", description="저장소 데모 텍스트 이관; 실제 저자 인증·이용 기록 아님", revision=0, created_at=STAMP)
        wh = key("work-world", wid, "0")
        add("work_world_history", id=wh, work_id=wid, world_id=wid, revision_no=0, changed_at=STAMP)
        add("work_publication_history", id=key("work-publication", wid, "0"), work_id=wid, revision_no=0, visibility="public", changed_at=STAMP)
        genres = ["genre-28", "genre-01"] if base["genre"] == "고전 판타지" else ["genre-28"] if base["genre"] == "고전 영웅" else ["genre-14"] if base["genre"] == "SF" else ["genre-01"]
        for genre in genres:
            add("work_genre", work_id=wid, genre_id=genre)
        for i, tag in enumerate(base.get("hash", [])):
            add("work_hashtag", id=key("work-hashtag", wid, str(i)), work_id=wid, tag=tag.lstrip("#"), position=i)
        inherited_episodes = []
        for inherited in m["sourceEpisodeVersionIds"]:
            source_episode = next(e for e in maps[w["parent"]]["episodes"] if e["number"] == inherited["number"])
            inherited_episodes.append({**source_episode, "episodeId": inherited["localEpisodeId"], "versionRowId": inherited["localVersionRowId"]})
        for e in inherited_episodes + m["episodes"]:
            inherited = e["number"] <= m["inheritedEpisodeCount"]
            add("episode", id=e["episodeId"], work_id=wid, sequence=e["number"])
            add("episode_version", id=e["versionRowId"], episode_id=e["episodeId"], content_version_id=e["contentVersionId"],
                revision_no=1, title=e["title"], content=e["body"], created_at=STAMP, is_saved=not inherited, work_world_history_id=wh)
            if not inherited:
                add("publication_event", id=key(NS, "publication", e["versionRowId"]), episode_version_id=e["versionRowId"], actor_id=owner,
                    action="publish", outcome="applied", occurred_at=STAMP, trigger_kind="sample_import")
        if not w.get("parent"):
            start = w.get("forkFrom", 0)
            add("fork_policy_history", id=key("policy", wid, "0"), work_id=wid, allow_creation=w["forksAllowed"],
                allow_publication=w["forksAllowed"], episode_scope="all" if w.get("forkAll") or not start else "from",
                start_episode_id=key("episode", wid, str(start)) if start else None, changed_at=STAMP, revision_no=0)

    # Versioned, normalized wiki instances. Future-source documents stay stored but private.
    for slug, w in works.items():
        m, wid = maps[slug], maps[slug]["workId"]
        original = works.get(w.get("parent"), w)
        source_docs = {d["id"]: d for d in original["wiki"]["docs"]}
        ids = {d["sourceId"]: d for d in m["wikiDocuments"]}
        cast = {c["n"]: c for c in original.get("cast", [])}
        for index, doc in enumerate(w["wiki"]["docs"]):
            identity = ids[doc["id"]]
            logical, did = identity["logicalId"], identity["documentId"]
            cv = key(NS, "setting-version", slug, doc["id"])
            vid = key("setting-version", did, cv)
            vis = key("visibility", vid)
            first = first_episode(original, source_docs.get(doc["id"], doc))
            public = first <= m["readEpisodeCount"] and (not w.get("parent") or first <= w["forkAt"])
            add("setting_document", id=did, world_id=wid, logical_id=logical, created_at=STAMP)
            add("setting_visibility_history", id=vis, setting_document_id=did, revision_no=0, default_visibility="private", changed_at=STAMP)
            if public:
                add("setting_visibility_range", id=key("range", vid), visibility_history_id=vis, start_episode_id=key("episode", wid, str(first)), end_episode_id=None, visibility="public")
            add("setting_version", id=vid, setting_document_id=did, content_version_id=cv, revision_no=index,
                name=doc["t"], category_id={"char": "인물", "place": "장소", "item": "상태", "event": "지식"}.get(doc["cat"], "규칙"),
                content=doc["body"], evidence="Repository demonstration fixture; not verified author provenance", created_at=STAMP, lifecycle="active", visibility_history_id=vis)
            add("setting_reading_detail", setting_version_id=vid, source_key=doc["id"], wiki_category=doc["cat"],
                color=cast.get(doc["t"], {}).get("c", "#7C8A9E"), image=doc.get("img"), event_episode=doc.get("ep"), event_line=doc.get("line"),
                source_basis_episode=w.get("forkAt"))
            props = [(0, name, value) for name, value in doc.get("props", {}).items()]
            props += [(int(epoch), name, value) for epoch, values in doc.get("at", {}).items() for name, value in values.items()]
            for position, (epoch, name, value) in enumerate(props):
                disclosed = disclosure.get((original['id'], doc['id'], epoch, name, value))
                add("setting_reading_property", setting_version_id=vid, position=position, episode=epoch, name=name, value=value, public_from_episode=disclosed)
            for position, alias in enumerate(doc.get("alias", [])):
                add("setting_reading_alias", setting_version_id=vid, position=position, alias=alias)
            for position, participant in enumerate(doc.get("who", [])):
                add("setting_reading_participant", setting_version_id=vid, position=position, name=participant)
            for position, link in enumerate(doc.get("links", [])):
                if link["to"] in ids:
                    add("setting_reading_link", setting_version_id=vid, position=position, target_logical_id=ids[link["to"]]["logicalId"], kind=link["k"])
            for position, knowledge in enumerate(doc.get("knowledge", [])):
                add("setting_reading_knowledge", setting_version_id=vid, position=position, content=knowledge["text"], known_at=knowledge["knownAt"], public_at=knowledge.get("publicAt"))
            for position, tag in enumerate(doc.get("tags", [])):
                tid = key("tag", m["ownerSubjectId"], tag)
                add("setting_tag", id=tid, owner_id=m["ownerSubjectId"], name=tag)
                add("setting_version_tag", setting_version_id=vid, setting_tag_id=tid, position=position)
                add("setting_document_tag", setting_document_id=did, setting_tag_id=tid)

    version_by_doc = {v["setting_document_id"]: v for v in rows["setting_version"]}
    for slug, w in works.items():
        if not w.get("parent"):
            continue
        m, parent = maps[slug], maps[w["parent"]]
        wid, source_id, basis = m["workId"], parent["workId"], w["forkAt"]
        cp, e = key("checkpoint", wid), parent["episodes"][basis - 1]
        add("checkpoint", id=cp, work_id=source_id, episode_id=e["episodeId"], basis_episode_version_id=e["versionRowId"], status="content_only", created_at=STAMP)
        for episode in parent["episodes"][:basis]:
            add("checkpoint_episode", checkpoint_id=cp, source_work_id=source_id, episode_id=episode["episodeId"], episode_version_id=episode["versionRowId"])
        for doc in works[w["parent"]]["wiki"]["docs"]:
            if first_episode(works[w["parent"]], doc) > basis:
                continue
            source_doc = next(d for d in parent["wikiDocuments"] if d["sourceId"] == doc["id"])
            vid = version_by_doc[source_doc["documentId"]]["id"]
            add("checkpoint_setting", checkpoint_id=cp, setting_document_id=source_doc["documentId"], setting_version_id=vid)
            add("fork_source_setting", fork_work_id=wid, setting_document_id=source_doc["documentId"], setting_version_id=vid)
        add("fork", work_id=wid, source_work_id=source_id, owner_id=m["ownerSubjectId"], source_checkpoint_id=cp,
            confirmed_policy_history_id=key("policy", source_id, "0"), conditions_confirmed_at=STAMP,
            source_title=works[w["parent"]]["title"], direction=w["dir"], world_revision=0, created_at=STAMP)
        add("fork_world_reference", fork_work_id=wid, source_world_id=source_id, reference_status="independent", last_followed_checkpoint_id=cp, detached_at=STAMP)
    return rows


# Reuse the importer's fixed table/column contract without relying on sys.path (python -I).
_spec = importlib.util.spec_from_file_location('sample_csv_loader', HERE / 'load.py')
_loader = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_loader)


def write_csv(service, rows, root):
    target = root / service
    target.mkdir(exist_ok=True)
    for table, columns in _loader.TABLES[service].items():
        with (target / (table + '.csv')).open('w', encoding='utf-8', newline='') as stream:
            writer = csv.writer(stream, lineterminator='\n')
            writer.writerow(columns)
            for row in rows.get(table, []):
                values = []
                for column in columns:
                    value = row[column]
                    if value is None:
                        value = _loader.NULL
                    elif isinstance(value, bool):
                        value = str(value).lower()
                    elif isinstance(value, str) and value.startswith('\\'):
                        value = '\\' + value
                    values.append(value)
                writer.writerow(values)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='Separate existing directory; never overwrite authoritative CSVs')
    args = parser.parse_args()
    if args.output.resolve() == HERE or any((args.output / service).exists() for service in ('core', 'content')):
        parser.error('Use a separate empty output directory; import inputs are not regenerated in place')
    source = json.loads((HERE / 'source-inventory.json').read_text(encoding='utf-8'))
    for service, rows in (('core', core_rows(source)), ('content', content_rows(source))):
        write_csv(service, rows, args.output)
    print('Reproduced deterministic Core/Content CSVs offline; no database access.')
