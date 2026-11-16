package ai.storyfork.content.manuscript.client

import ai.storyfork.content.context.service.dto.QaScope
import ai.storyfork.content.manuscript.service.ManuscriptChunk
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

internal data class ManuscriptHit(
    val id: String, val workId: String, val sourceWorkId: String?, val episodeId: String,
    val episode: Int, val versionId: String, val sourceHash: String, val start: Int, val end: Int, val generation: Int,
)

internal class ManuscriptElasticsearch(
    private val http: RestClient,
    private val mapper: JsonMapper,
    private val index: String,
) {
    init {
        require(index.matches(Regex("storyfork-manuscript-v1(?:-[a-z0-9]+)*"))) { "Expected a dedicated manuscript v1 index" }
    }

    /** 인덱스가 없을 때만 v1 정의로 만들고 매핑을 검증한다. 기존 인덱스는 바꾸거나 지우지 않는다. */
    fun ensureIndex(definition: String) {
        val exists = http.head().uri("/$index").exchange { _, response ->
            when (response.statusCode.value()) {
                200 -> true
                404 -> false
                else -> error("Unexpected manuscript index status ${response.statusCode.value()}")
            }
        }
        if (!exists) {
            val created = json(http.put().uri("/$index").contentType(MediaType.APPLICATION_JSON).body(definition))
            // 디스크 워터마크 등으로 샤드를 배정하지 못하면 인덱스는 생겨도 쓸 수 없다.
            check(created.path("acknowledged").asBoolean(false) && created.path("shards_acknowledged").asBoolean(false)) {
                "Manuscript index shards were not allocated"
            }
        }
        verifyMapping()
    }

    fun search(scope: QaScope, vector: List<Float>): List<ManuscriptHit> {
        if (scope.episodes.isEmpty()) return emptyList()
        verifyMapping()
        fun term(field: String, value: Any) = mapOf("term" to mapOf(field to value))
        val lineage = scope.sourceWorkId?.let { term("source_work_id", it) }
            ?: mapOf("bool" to mapOf("must_not" to mapOf("exists" to mapOf("field" to "source_work_id"))))
        // 회차·판본을 짝지은 필터가 Elasticsearch 절 수 한도를 넘지 않게 나눠 같은 지표의 점수로 합친다.
        return scope.episodes.chunked(128).flatMap { episodes ->
            val pairs = episodes.map {
                mapOf("bool" to mapOf("filter" to listOf(term("episode_number", it.number), term("source_revision", it.versionId))))
            }
            val filter = listOf(term("work_id", scope.workId), lineage, term("index_generation", 1),
                mapOf("bool" to mapOf("should" to pairs, "minimum_should_match" to 1)))
            val response = json(http.post().uri("/$index/_search?allow_partial_search_results=false")
                .contentType(MediaType.APPLICATION_JSON).body(mapOf("size" to 8, "knn" to mapOf(
                    "field" to "embedding", "query_vector" to vector, "k" to 8, "num_candidates" to 48, "filter" to filter,
                ))))
            val hits = response.path("hits").path("hits")
            check(!response.path("timed_out").asBoolean(true) && response.path("_shards").path("failed").asInt(-1) == 0 &&
                hits.isArray) { "Incomplete manuscript search" }
            hits.toList().map { node ->
                val source = node.path("_source")
                node.path("_score").asDouble() to ManuscriptHit(
                    node.path("_id").asString(), source.path("work_id").asString(),
                    source.path("source_work_id").asString(null), source.path("episode_id").asString(),
                    source.path("episode_number").asInt(), source.path("source_revision").asString(),
                    source.path("source_hash").asString(), source.path("start_utf16").asInt(-1),
                    source.path("end_utf16").asInt(-1), source.path("index_generation").asInt(),
                )
            }
        }.sortedByDescending { it.first }.take(8).map { it.second }
    }

    fun ids(): Set<String> {
        verifyMapping()
        var pit = json(http.post().uri("/$index/_pit?keep_alive=1m")).path("id").asString()
        check(pit.isNotBlank()) { "Missing Elasticsearch PIT ID" }
        val ids = mutableSetOf<String>()
        var after: JsonNode? = null
        try {
            while (true) {
                val page = json(http.post().uri("/_search?allow_partial_search_results=false").contentType(MediaType.APPLICATION_JSON)
                    .body(buildMap<String, Any> {
                        put("size", 1000)
                        put("_source", false)
                        put("track_total_hits", false)
                        put("sort", listOf("_shard_doc"))
                        put("pit", mapOf("id" to pit, "keep_alive" to "1m"))
                        after?.let { put("search_after", it) }
                    }))
                pit = page.path("pit_id").asString(pit)
                val hits = page.path("hits").path("hits")
                check(!page.path("timed_out").asBoolean(true) && hits.isArray) { "Incomplete manuscript index scan" }
                if (hits.isEmpty) return ids
                hits.forEach { hit ->
                    val id = hit.path("_id").asString()
                    check(id.isNotBlank() && ids.add(id)) { "Invalid manuscript scan page" }
                }
                after = hits.last().path("sort")
                check(after.isArray && !after.isEmpty) { "Missing manuscript scan cursor" }
            }
        } finally {
            http.method(HttpMethod.DELETE).uri("/_pit").contentType(MediaType.APPLICATION_JSON)
                .body(mapOf("id" to pit)).retrieve().toBodilessEntity()
        }
    }

    fun remove(ids: List<String>) = bulk("delete", ids.size, buildString {
        ids.forEach { appendLine(action("delete", it)) }
    })

    fun put(chunks: List<ManuscriptChunk>, vectors: List<List<Float>>) = bulk("index", chunks.size, buildString {
        check(chunks.size == vectors.size)
        chunks.zip(vectors).forEach { (chunk, vector) ->
            appendLine(action("index", chunk.id))
            appendLine(mapper.writeValueAsString(chunk.document(vector)))
        }
    })

    private fun verifyMapping() {
        val mapping = json(http.get().uri("/$index/_mapping")).path(index).path("mappings")
        val meta = mapping.path("_meta")
        val vector = mapping.path("properties").path("embedding")
        check(mapping.path("dynamic").asString() == "strict" && meta.path("embedding_model").asString() == manuscriptModel &&
            meta.path("embedding_revision").asString() == manuscriptModelRevision &&
            meta.path("embedding_artifact").asString() == manuscriptModelArtifact &&
            vector.path("type").asString() == "dense_vector" && vector.path("dims").asInt() == manuscriptDimensions &&
            vector.path("similarity").asString() == "cosine" && vector.path("index_options").path("type").asString() == "int8_hnsw"
        ) { "Unexpected manuscript v1 mapping" }
    }

    private fun action(kind: String, id: String) = mapper.writeValueAsString(mapOf(kind to mapOf("_id" to id)))

    private fun bulk(kind: String, count: Int, body: String) {
        val items = json(http.post().uri("/$index/_bulk?refresh=wait_for")
            .contentType(MediaType.parseMediaType("application/x-ndjson")).body(body)).path("items")
        check(items.isArray && items.size() == count && items.all {
            val status = it.path(kind).path("status").asInt()
            status in 200..299 || (kind == "delete" && status == 404 && it.path(kind).path("result").asString() == "not_found")
        }) { "Manuscript bulk $kind failed" }
    }

    private fun json(request: RestClient.RequestHeadersSpec<*>): JsonNode = checkNotNull(request.retrieve().body(JsonNode::class.java))
}
