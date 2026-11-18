package ai.storyfork.content.search.client

import ai.storyfork.content.search.domain.SearchDocument
import ai.storyfork.content.search.domain.SearchHit
import ai.storyfork.content.search.domain.SearchKind
import ai.storyfork.content.search.domain.candidateRequest
import ai.storyfork.content.search.domain.parseHits
import org.slf4j.LoggerFactory
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientResponseException
import tools.jackson.core.JacksonException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

private const val INDEX = "storyfork-search-v1"

/** 색인에서 부분 일치로 찾는 필드다. 모두 Elasticsearch 내장 `wildcard` 필드라 한국어 분석 플러그인이 필요 없다. */
internal val SEARCH_WILDCARD_FIELDS = listOf("title", "name", "description", "author", "tags", "genres", "aliases")

/**
 * 작품·세계관·설정 카드 검색 색인(`storyfork-search-v1`) 클라이언트다. 후보 ID만 찾고 공개 여부 판정은 하지 않는다. 원고 색인([ai.storyfork.content.manuscript.client.ManuscriptElasticsearch])과 같은 서버를 쓴다.
 * 실패는 호출 결과를 성공으로 바꾸지 않고 [org.springframework.web.client.RestClientException]·[IllegalStateException]으로 알린다.
 */
class SearchElasticsearch(private val http: RestClient, private val mapper: JsonMapper) {
    private val log = LoggerFactory.getLogger(SearchElasticsearch::class.java)

    /** 인덱스가 없을 때만 v1 정의로 만들고 매핑을 검증한다. 기존 인덱스는 바꾸거나 지우지 않는다. */
    fun ensureIndex(definition: String) {
        val exists = http.head().uri("/$INDEX").exchange { _, response ->
            when (response.statusCode.value()) {
                200 -> true
                404 -> false
                else -> error("Unexpected search index status ${response.statusCode.value()}")
            }
        }
        if (!exists) {
            try {
                val created = json(http.put().uri("/$INDEX").contentType(MediaType.APPLICATION_JSON).body(definition))
                // 디스크 워터마크 등으로 샤드를 배정하지 못하면 인덱스는 생겨도 쓸 수 없다.
                check(created.path("acknowledged").asBoolean(false) && created.path("shards_acknowledged").asBoolean(false)) { "Search index shards were not allocated" }
            } catch (error: RestClientResponseException) {
                // 두 인스턴스가 동시에 시작해 둘 다 인덱스가 없다고 보면 늦은 쪽 생성이 '이미 있음'으로 실패한다. 그 오류일 때만 먼저 만들어진 인덱스의 매핑 검증으로 넘어가고, 다른 생성 오류는 그대로 던진다.
                if (!alreadyExists(error)) throw error
            }
        }
        verifyMapping()
    }

    /** [kind] 문서 중 [fields](필드 → 찾을 말)에 일치하는 후보를 최대 [limit]개 돌려준다. */
    fun candidates(kind: SearchKind, fields: Map<String, String>, limit: Int): List<SearchHit> =
        parseHits(json(http.post().uri("/$INDEX/_search?allow_partial_search_results=false").contentType(MediaType.APPLICATION_JSON)
            .body(candidateRequest(kind, fields, limit))), kind)

    /** 색인에 있는 모든 문서의 키 → 내용 해시다. 주기 대조가 바뀐 문서와 사라진 문서를 가린다. */
    fun hashes(): Map<String, String> {
        var pit = json(http.post().uri("/$INDEX/_pit?keep_alive=1m")).path("id").asString()
        check(pit.isNotBlank()) { "Missing Elasticsearch PIT ID" }
        val hashes = mutableMapOf<String, String>()
        var after: JsonNode? = null
        try {
            while (true) {
                val page = json(http.post().uri("/_search?allow_partial_search_results=false").contentType(MediaType.APPLICATION_JSON)
                    .body(buildMap<String, Any> {
                        put("size", 1000)
                        put("_source", listOf("hash"))
                        put("track_total_hits", false)
                        put("sort", listOf("_shard_doc"))
                        put("pit", mapOf("id" to pit, "keep_alive" to "1m"))
                        after?.let { put("search_after", it) }
                    }))
                pit = page.path("pit_id").asString(pit)
                val hits = page.path("hits").path("hits")
                check(!page.path("timed_out").asBoolean(true) && hits.isArray) { "Incomplete search index scan" }
                if (hits.isEmpty) return hashes
                hits.forEach { hit ->
                    val id = hit.path("_id").asString()
                    check(id.isNotBlank() && hashes.put(id, hit.path("_source").path("hash").asString()) == null) { "Invalid search scan page" }
                }
                after = hits.last().path("sort")
                check(after.isArray && !after.isEmpty) { "Missing search scan cursor" }
            }
        } finally {
            // PIT는 keep_alive(1분)가 지나면 저절로 닫히므로, 닫기 실패는 읽은 결과나 읽다 난 원래 예외를 가리지 않게 로그만 남긴다.
            try {
                http.method(HttpMethod.DELETE).uri("/_pit").contentType(MediaType.APPLICATION_JSON).body(mapOf("id" to pit)).retrieve().toBodilessEntity()
            } catch (error: RuntimeException) {
                log.warn("search index PIT close failed: {}", error.toString())
            }
        }
    }

    fun remove(keys: List<String>) = bulk("delete", keys.size, buildString {
        keys.forEach { appendLine(action("delete", it)) }
    })

    fun put(documents: List<SearchDocument>) = bulk("index", documents.size, buildString {
        documents.forEach {
            appendLine(action("index", it.key))
            appendLine(mapper.writeValueAsString(it.source()))
        }
    })

    private fun alreadyExists(error: RestClientResponseException): Boolean =
        try {
            mapper.readTree(error.responseBodyAsString).path("error").path("type").asString() == "resource_already_exists_exception"
        } catch (_: JacksonException) {
            false
        }

    private fun verifyMapping() {
        val mapping = json(http.get().uri("/$INDEX/_mapping")).path(INDEX).path("mappings")
        val properties = mapping.path("properties")
        check(mapping.path("dynamic").asString() == "strict" && properties.path("kind").path("type").asString() == "keyword" &&
            SEARCH_WILDCARD_FIELDS.all { properties.path(it).path("type").asString() == "wildcard" }) { "Unexpected search v1 mapping" }
    }

    private fun action(kind: String, id: String) = mapper.writeValueAsString(mapOf(kind to mapOf("_id" to id)))

    private fun bulk(kind: String, count: Int, body: String) {
        // 문자열 본문은 변환기의 기본 charset으로 쓰이는데 순수 RestClient는 ISO-8859-1이라 한글 문서가 `?`로 깨진다(Boot는 UTF-8로 맞춰 둠). 전역 설정에 기대지 않고 색인이 읽는 UTF-8 바이트로 직접 보낸다.
        val items = json(http.post().uri("/$INDEX/_bulk?refresh=wait_for")
            .contentType(MediaType.parseMediaType("application/x-ndjson")).body(body.toByteArray(Charsets.UTF_8))).path("items")
        check(items.isArray && items.size() == count && items.all {
            val status = it.path(kind).path("status").asInt()
            status in 200..299 || (kind == "delete" && status == 404 && it.path(kind).path("result").asString() == "not_found")
        }) { "Search bulk $kind failed" }
    }

    private fun json(request: RestClient.RequestHeadersSpec<*>): JsonNode = checkNotNull(request.retrieve().body(JsonNode::class.java))
}
