package ai.storyfork.content.search

import ai.storyfork.content.search.domain.SearchHit
import ai.storyfork.content.search.domain.SearchKind
import ai.storyfork.content.search.domain.candidateRequest
import ai.storyfork.content.search.domain.escapeWildcard
import ai.storyfork.content.search.domain.parseHits
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** 검색 색인(Elasticsearch)에 보내는 후보 검색 요청과 응답 읽기다. 순수 함수라 HTTP 없이 본문만 확인한다. */
class SearchQueryTest {
    private val mapper = JsonMapper.builder().build()
    private fun tree(value: Any): JsonNode = mapper.readTree(mapper.writeValueAsString(value))

    @Test fun `wildcard characters typed by a user are escaped so they match literally`() {
        assertEquals("a\\*b\\?c\\\\d", escapeWildcard("a*b?c\\d"))
        assertEquals("달빛 Moon", escapeWildcard("달빛 Moon"))
    }

    @Test fun `a candidate request filters by kind and ORs a case-insensitive contains pattern per field`() {
        val body = candidateRequest(SearchKind.CARD, linkedMapOf("title" to "별*칭", "tags" to "x?"), 500)
        assertEquals(mapper.readTree("""{
            "size": 500, "_source": ["world_id"],
            "query": {"bool": {"filter": [
                {"term": {"kind": "card"}},
                {"bool": {"should": [
                    {"wildcard": {"title": {"value": "*별\\*칭*", "case_insensitive": true}}},
                    {"wildcard": {"tags": {"value": "*x\\?*", "case_insensitive": true}}}
                ], "minimum_should_match": 1}}
            ]}}}"""), tree(body))
    }

    @Test fun `the kind filter follows the searched kind`() {
        listOf(SearchKind.WORK to "work", SearchKind.WORLD to "world", SearchKind.CARD to "card").forEach { (kind, code) ->
            val filter = tree(candidateRequest(kind, mapOf("title" to "a"), 10)).path("query").path("bool").path("filter").get(0)
            assertEquals(mapper.readTree("""{"term": {"kind": "$code"}}"""), filter)
        }
    }

    @Test fun `hits carry the entity id without the kind prefix and the world of a card`() {
        val response = mapper.readTree("""{"timed_out": false, "_shards": {"failed": 0}, "hits": {"hits": [
            {"_id": "card:c1", "_source": {"world_id": "w1"}}, {"_id": "card:c2", "_source": {}}]}}""")
        assertEquals(listOf(SearchHit("c1", "w1"), SearchHit("c2", null)), parseHits(response, SearchKind.CARD))
    }

    @Test fun `a timed out, partly failed or malformed search is not a result`() {
        listOf(
            """{"timed_out": true, "_shards": {"failed": 0}, "hits": {"hits": []}}""",
            """{"timed_out": false, "_shards": {"failed": 1}, "hits": {"hits": []}}""",
            """{"timed_out": false, "_shards": {"failed": 0}}""",
        ).forEach { json -> assertThrows(IllegalStateException::class.java, { parseHits(mapper.readTree(json), SearchKind.WORK) }, json) }
    }
}
