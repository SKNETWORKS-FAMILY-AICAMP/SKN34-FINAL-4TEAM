"""Content 승인 발췌의 자동 증분 적재와 Elasticsearch 의미 검색."""
from hashlib import sha256
import json
import os
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

from app.runs.remote_content import NoRedirect
from app.runs.state import Citation

INDEX = "storyfork-manuscript-e5-v1"
MAPPING = {"mappings": {"dynamic": "strict", "properties": {
    "text": {"type": "semantic_text", "inference_id": ".multilingual-e5-small-elasticsearch"}}}}


def split_excerpt(work, fork, number, revision, start, text):
    for pos in range(0, len(text), 400):
        quote = text[pos:pos + 400]
        end = start + len(quote.encode("utf-16-le")) // 2
        digest = sha256(quote.encode()).hexdigest()
        key = sha256(json.dumps([work, fork, number, revision, start, end, digest]).encode()).hexdigest()
        yield key, quote, start, end, digest
        start = end


def manuscript_chunks(episodes, refs, work, fork, basis):
    """원본 UTF-16 좌표를 유지하고 작품·Fork·판·구간·원문 해시에 묶인 키를 만든다."""
    chunks = {}
    for episode in episodes:
        number = episode["number"]
        matches = [r for r in refs if r.work_id == work and r.kind == "manuscript"
                   and r.document_id == episode["documentId"] and r.revision == episode["versionId"]]
        if len(matches) != 1 or not 1 <= number <= basis:
            raise ValueError("invalid_manuscript_scope")
        source = matches[0]
        for excerpt in episode["excerpts"]:
            start, text = excerpt["start"], excerpt["text"]
            if start < 0 or start + len(text.encode("utf-16-le")) // 2 != excerpt["end"]:
                raise ValueError("invalid_excerpt")
            for key, quote, start, end, digest in split_excerpt(work,fork,number,source.revision,start,text):
                chunks[key] = Citation(evidence_ref=key, source_revision=source, episode=number,
                                       span=(start, end), quote=quote, source_hash=digest, is_mock=False)
    return chunks


def elastic(method, path, data=None):
    url = os.environ["ELASTICSEARCH_URL"].rstrip("/")
    headers = {"Content-Type": "application/json"}
    if key := os.environ.get("ELASTICSEARCH_API_KEY"):
        headers["Authorization"] = "ApiKey " + key
    if isinstance(data, bytes):
        headers["Content-Type"] = "application/x-ndjson"
    elif data is not None:
        data = json.dumps(data, ensure_ascii=False).encode()
    request = Request(f"{url}/{INDEX}{path}", method=method, data=data, headers=headers)
    with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=20) as response:
        return json.load(response)


def index_manuscripts(chunks, send=elastic):
    if not chunks:
        return
    try:
        docs = send("POST", "/_mget?realtime=false&_source=false", {"ids": list(chunks)})["docs"]
    except HTTPError as error:
        if error.code != 404:
            raise
        try:
            send("PUT", "", MAPPING)
        except HTTPError as race:
            if race.code != 400 or json.load(race).get("error", {}).get("type") != "resource_already_exists_exception":
                raise
        docs = send("POST", "/_mget?realtime=false&_source=false", {"ids": list(chunks)})["docs"]
    if (len(docs) != len(chunks) or {d["_id"] for d in docs} != chunks.keys()
            or any(type(d.get("found")) is not bool for d in docs)):
        raise ValueError("incomplete_index_inventory")
    lines = []
    for doc in docs:
        if not doc["found"]:
            key = doc["_id"]
            lines.extend([json.dumps({"create": {"_id": key}}), json.dumps({"text": chunks[key]}, ensure_ascii=False)])
    if lines:
        result = send("POST", "/_bulk?refresh=wait_for", ("\n".join(lines) + "\n").encode())
        items = result["items"]
        if len(items) != len(lines)//2 or any(i["create"]["status"] not in (201, 409) for i in items):
            raise ValueError("incomplete_index_write")
        # 다른 worker의 create가 아직 검색에 보이지 않는 경쟁만 명시적으로 동기화한다.
        if any(i["create"]["status"] == 409 for i in items):
            if send("POST", "/_refresh").get("_shards", {}).get("failed"):
                raise ValueError("incomplete_index_refresh")


def search_manuscripts(chunks, query, send=elastic):
    if not chunks:
        return []
    body = {"size": min(5, len(chunks)), "_source": False, "query": {"bool": {
        "filter": [{"ids": {"values": list(chunks)}}],
        "must": [{"match": {"text": query}}]}}}
    result = send("POST", "/_search?allow_partial_search_results=false", body)
    if result.get("timed_out") or result.get("_shards", {}).get("failed"):
        raise ValueError("incomplete_search")
    hits = [hit["_id"] for hit in result["hits"]["hits"]]
    if any(key not in chunks for key in hits) or len(set(hits)) != len(hits):
        raise ValueError("invalid_search_scope")
    return [chunks[key] for key in hits]
