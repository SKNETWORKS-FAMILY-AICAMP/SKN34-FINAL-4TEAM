package ai.storyfork.content.search

import ai.storyfork.content.search.client.SearchElasticsearch
import ai.storyfork.content.search.domain.SearchHit
import ai.storyfork.content.search.domain.SearchKind
import ai.storyfork.content.search.domain.candidateRequest
import ai.storyfork.content.search.domain.workDocument
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.core.io.ClassPathResource
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.content
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientResponseException
import tools.jackson.databind.json.JsonMapper

/** 메모리 안의 가짜 HTTP(MockRestServiceServer)로 검색 색인 클라이언트의 요청·응답 모양만 검증한다. 실제 Elasticsearch는 쓰지 않는다(CI 통합 단계에서만 실행). */
class SearchElasticsearchIntegrationTest {
    private val builder = RestClient.builder().baseUrl("http://es")
    private val server = MockRestServiceServer.bindTo(builder).build()
    private val mapper = JsonMapper.builder().build()
    private val index = SearchElasticsearch(builder.build(), mapper)
    private val definition = ClassPathResource("search/search-v1.json").getContentAsString(Charsets.UTF_8)
    private val url = "http://es/storyfork-search-v1"

    private fun mapping(type: String = "wildcard") = """{"storyfork-search-v1":{"mappings":{"dynamic":"strict","properties":{
        "kind":{"type":"keyword"},"world_id":{"type":"keyword"},"hash":{"type":"keyword"},
        "title":{"type":"$type"},"name":{"type":"$type"},"description":{"type":"$type"},"author":{"type":"$type"},
        "tags":{"type":"$type"},"genres":{"type":"$type"},"aliases":{"type":"$type"}}}}}"""

    private fun expectMapping(body: String = mapping()) =
        server.expect(requestTo("${url}/_mapping")).andExpect(method(HttpMethod.GET)).andRespond(withSuccess(body, MediaType.APPLICATION_JSON))

    /** 두 인스턴스가 동시에 시작해 늦은 쪽의 생성이 받는 Elasticsearch 응답이다. */
    private fun alreadyExists() = withStatus(HttpStatus.BAD_REQUEST).contentType(MediaType.APPLICATION_JSON)
        .body("""{"error":{"type":"resource_already_exists_exception","reason":"index [storyfork-search-v1] already exists"},"status":400}""")

    private fun expectBulk(body: String, response: String) =
        server.expect(requestTo("${url}/_bulk?refresh=wait_for")).andExpect(method(HttpMethod.POST)).andExpect(content().string(body))
            .andRespond(withSuccess(response, MediaType.APPLICATION_JSON))

    @Test fun `a missing index is created from the bundled definition and its mapping is verified`() {
        server.expect(requestTo(url)).andExpect(method(HttpMethod.HEAD)).andRespond(withStatus(HttpStatus.NOT_FOUND))
        server.expect(requestTo(url)).andExpect(method(HttpMethod.PUT)).andExpect(content().json(definition))
            .andRespond(withSuccess("""{"acknowledged":true,"shards_acknowledged":true}""", MediaType.APPLICATION_JSON))
        expectMapping()

        index.ensureIndex(definition)

        server.verify()
    }

    @Test fun `an existing index is not recreated, only its mapping is verified`() {
        server.expect(requestTo(url)).andExpect(method(HttpMethod.HEAD)).andRespond(withStatus(HttpStatus.OK))
        expectMapping()

        index.ensureIndex(definition)

        server.verify()
    }

    @Test fun `an existing index whose fields are not wildcard fields fails the start`() {
        server.expect(requestTo(url)).andExpect(method(HttpMethod.HEAD)).andRespond(withStatus(HttpStatus.OK))
        expectMapping(mapping(type = "keyword"))

        assertThrows(IllegalStateException::class.java) { index.ensureIndex(definition) }
    }

    @Test fun `losing the creation race to another instance goes on to verify the index it created`() {
        server.expect(requestTo(url)).andExpect(method(HttpMethod.HEAD)).andRespond(withStatus(HttpStatus.NOT_FOUND))
        server.expect(requestTo(url)).andExpect(method(HttpMethod.PUT)).andRespond(alreadyExists())
        expectMapping()

        index.ensureIndex(definition)

        server.verify()
    }

    @Test fun `losing the race to an index with another mapping still fails the start`() {
        server.expect(requestTo(url)).andExpect(method(HttpMethod.HEAD)).andRespond(withStatus(HttpStatus.NOT_FOUND))
        server.expect(requestTo(url)).andExpect(method(HttpMethod.PUT)).andRespond(alreadyExists())
        expectMapping(mapping(type = "keyword"))

        assertThrows(IllegalStateException::class.java) { index.ensureIndex(definition) }
    }

    @Test fun `any other creation error fails the start as it is and never looks at the mapping`() {
        listOf(
            withStatus(HttpStatus.BAD_REQUEST).contentType(MediaType.APPLICATION_JSON)
                .body("""{"error":{"type":"illegal_argument_exception","reason":"bad settings"},"status":400}"""),
            withStatus(HttpStatus.BAD_REQUEST).contentType(MediaType.APPLICATION_JSON).body("not json"),
            withStatus(HttpStatus.INTERNAL_SERVER_ERROR),
        ).forEach { response ->
            server.reset()
            server.expect(requestTo(url)).andExpect(method(HttpMethod.HEAD)).andRespond(withStatus(HttpStatus.NOT_FOUND))
            server.expect(requestTo(url)).andExpect(method(HttpMethod.PUT)).andRespond(response)

            assertThrows(RestClientResponseException::class.java) { index.ensureIndex(definition) }

            server.verify()
        }
    }

    @Test fun `an index whose shards were not allocated is not a success`() {
        server.expect(requestTo(url)).andExpect(method(HttpMethod.HEAD)).andRespond(withStatus(HttpStatus.NOT_FOUND))
        server.expect(requestTo(url)).andExpect(method(HttpMethod.PUT))
            .andRespond(withSuccess("""{"acknowledged":true,"shards_acknowledged":false}""", MediaType.APPLICATION_JSON))

        assertThrows(IllegalStateException::class.java) { index.ensureIndex(definition) }
    }

    @Test fun `a candidate search posts the request body and reads the ids`() {
        val fields = mapOf("name" to "달")
        server.expect(requestTo("${url}/_search?allow_partial_search_results=false")).andExpect(method(HttpMethod.POST))
            .andExpect(content().json(mapper.writeValueAsString(candidateRequest(SearchKind.WORLD, fields, 500))))
            .andRespond(withSuccess("""{"timed_out":false,"_shards":{"failed":0},"hits":{"hits":[{"_id":"world:w1","_source":{}}]}}""", MediaType.APPLICATION_JSON))

        assertEquals(listOf(SearchHit("w1", null)), index.candidates(SearchKind.WORLD, fields, 500))
        server.verify()
    }

    @Test fun `the hash scan reads every page of a point in time and closes it, without re-checking the mapping`() {
        server.expect(requestTo("${url}/_pit?keep_alive=1m")).andExpect(method(HttpMethod.POST))
            .andRespond(withSuccess("""{"id":"pit-1"}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://es/_search?allow_partial_search_results=false")).andExpect(method(HttpMethod.POST))
            .andExpect(content().json("""{"size":1000,"_source":["hash"],"track_total_hits":false,"sort":["_shard_doc"],"pit":{"id":"pit-1","keep_alive":"1m"}}"""))
            .andRespond(withSuccess("""{"pit_id":"pit-2","timed_out":false,"hits":{"hits":[
                {"_id":"work:w1","_source":{"hash":"h1"},"sort":[1]},{"_id":"card:c1","_source":{"hash":"h2"},"sort":[2]}]}}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://es/_search?allow_partial_search_results=false")).andExpect(method(HttpMethod.POST))
            .andExpect(content().json("""{"pit":{"id":"pit-2","keep_alive":"1m"},"search_after":[2]}"""))
            .andRespond(withSuccess("""{"pit_id":"pit-2","timed_out":false,"hits":{"hits":[]}}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://es/_pit")).andExpect(method(HttpMethod.DELETE)).andExpect(content().json("""{"id":"pit-2"}"""))
            .andRespond(withSuccess("""{"succeeded":true}""", MediaType.APPLICATION_JSON))

        assertEquals(mapOf("work:w1" to "h1", "card:c1" to "h2"), index.hashes())
        server.verify()
    }

    @Test fun `a failed point-in-time close is only logged, the scanned hashes are still returned`() {
        server.expect(requestTo("${url}/_pit?keep_alive=1m")).andExpect(method(HttpMethod.POST))
            .andRespond(withSuccess("""{"id":"pit-1"}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://es/_search?allow_partial_search_results=false")).andExpect(method(HttpMethod.POST))
            .andRespond(withSuccess("""{"pit_id":"pit-1","timed_out":false,"hits":{"hits":[]}}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://es/_pit")).andExpect(method(HttpMethod.DELETE)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR))

        assertEquals(emptyMap<String, String>(), index.hashes())
        server.verify()
    }

    @Test fun `a failed scan keeps its own error even when closing the point in time fails too`() {
        server.expect(requestTo("${url}/_pit?keep_alive=1m")).andExpect(method(HttpMethod.POST))
            .andRespond(withSuccess("""{"id":"pit-1"}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://es/_search?allow_partial_search_results=false")).andExpect(method(HttpMethod.POST))
            .andRespond(withSuccess("""{"pit_id":"pit-1","timed_out":true,"hits":{"hits":[]}}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://es/_pit")).andExpect(method(HttpMethod.DELETE)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR))

        val failure = assertThrows(IllegalStateException::class.java) { index.hashes() }

        assertEquals("Incomplete search index scan", failure.message)
        server.verify()
    }

    @Test fun `put sends one index action and one source line per document`() {
        val a = workDocument("a", "작품 a", "작가", emptyList(), emptyList())
        val b = workDocument("b", "작품 b", "작가", emptyList(), emptyList())
        val ndjson = listOf(a, b).joinToString("") { """{"index":{"_id":"${it.key}"}}""" + "\n" + mapper.writeValueAsString(it.source()) + "\n" }
        expectBulk(ndjson, """{"errors":false,"items":[{"index":{"status":201}},{"index":{"status":200}}]}""")

        index.put(listOf(a, b))

        server.verify()
    }

    @Test fun `remove deletes by key and tolerates a document that is already gone`() {
        expectBulk("{\"delete\":{\"_id\":\"work:a\"}}\n{\"delete\":{\"_id\":\"card:b\"}}\n",
            """{"errors":false,"items":[{"delete":{"status":200}},{"delete":{"status":404,"result":"not_found"}}]}""")

        index.remove(listOf("work:a", "card:b"))

        server.verify()
    }

    @Test fun `a rejected bulk item fails the run`() {
        val a = workDocument("a", "작품 a", "작가", emptyList(), emptyList())
        server.expect(requestTo("${url}/_bulk?refresh=wait_for")).andExpect(method(HttpMethod.POST))
            .andRespond(withSuccess("""{"errors":true,"items":[{"index":{"status":400}}]}""", MediaType.APPLICATION_JSON))

        assertThrows(IllegalStateException::class.java) { index.put(listOf(a)) }
    }
}
