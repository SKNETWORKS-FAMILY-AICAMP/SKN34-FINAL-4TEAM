"""허용된 원문 판·UTF-16 인용 및 검색 실패 경계."""
from unittest.mock import Mock
import pytest
from app.retrieval.live import manuscript_chunks, search_manuscripts
from app.retrieval.content_client import SourceVersion

REF = SourceVersion("work", "manuscript", "doc", "version")
EPISODE = {"documentId":"doc", "number": 2, "versionId": "version", "excerpts": [{"start": 5, "end": 10, "text": "가😀나다"}]}

def test_hits_are_resolved_from_authorized_source_only():
    chunks = manuscript_chunks([EPISODE], [REF], "work", None, 2)
    key, citation = next(iter(chunks.items()))
    assert citation.span == (5, 10) and citation.quote == "가😀나다"
    search = Mock(return_value={"hits":{"hits":[{"_id":key, "_source":{"text":"변조"}}]}})
    assert search_manuscripts(chunks, "질문", search) == [citation]
    body = search.call_args.args[-1]
    assert key in str(body["query"]["bool"]["filter"])
    search.return_value = {"hits":{"hits":[{"_id":"other-work"}]}}
    with pytest.raises(ValueError):
        search_manuscripts(chunks, "질문", search)

def test_future_or_unbound_source_rejected_before_indexing():
    for refs, basis in [([], 2), ([REF], 1)]:
        with pytest.raises(ValueError):
            manuscript_chunks([EPISODE], refs, "work", None, basis)

def test_index_writes_only_missing_ids_and_fails_bulk_partial_errors():
    from app.retrieval.live import index_manuscripts
    chunks = manuscript_chunks([EPISODE], [REF], "work", None, 2)
    chunks = {key:c.quote for key,c in chunks.items()}
    key = next(iter(chunks))
    send = Mock(side_effect=[{"docs":[{"_id":key,"found":True}]}])
    index_manuscripts(chunks, send)
    assert send.call_count == 1
    send = Mock(side_effect=[{"docs":[{"_id":key,"found":False}]},{"items":[{"create":{"status":429}}]}])
    with pytest.raises(ValueError,match="incomplete_index_write"):
        index_manuscripts(chunks, send)
    assert key.encode() in send.call_args.args[-1]

def test_trace_failure_has_no_original_text_or_exception(monkeypatch):
    import asyncio, io, json
    from app.retrieval import tracing
    monkeypatch.setenv("LANGFUSE_BASE_URL","https://trace.example")
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY","public")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY","private")
    transport=Mock()
    transport.open.return_value=io.BytesIO(b"{}")
    monkeypatch.setattr(tracing,"build_opener",lambda *a:transport)
    trace=tracing.RagTrace("run-1")
    with pytest.raises(ValueError):
        with trace.step("rag.search"):
            raise ValueError("PRIVATE ORIGINAL")
    asyncio.run(trace.finish(False))
    data=transport.open.call_args.args[0].data
    assert b"PRIVATE ORIGINAL" not in data and b"private" not in data
    spans=json.loads(data)["resourceSpans"][0]["scopeSpans"][0]["spans"]
    assert spans[1]["parentSpanId"]==spans[0]["spanId"] and spans[1]["status"]["code"]==2

def test_public_indexer_pages_and_indexes_full_published_text_but_never_drafts():
    from app.retrieval.ingestion import index_page
    page=[{"id":"w","visibility":"public","source":None,"draft":None,
           "episodes":[{"number":1,"versionId":"v","body":"가"*410}]}]
    write=Mock()
    index_page(page,write)
    texts=write.call_args.args[0]
    assert list(texts.values())==["가"*400,"가"*10]
    page[0]["draft"]={"body":"비밀"}
    with pytest.raises(ValueError):
        index_page(page,write)
    assert write.call_count==1

def test_concurrent_create_conflict_refreshes_before_search():
    from app.retrieval.live import index_manuscripts
    send=Mock(side_effect=[{"docs":[{"_id":"key","found":False}]},
        {"items":[{"create":{"status":409}}]}, {"_shards":{"failed":0}}])
    index_manuscripts({"key":"원문"},send)
    assert send.call_args_list[-1].args == ("POST","/_refresh")
