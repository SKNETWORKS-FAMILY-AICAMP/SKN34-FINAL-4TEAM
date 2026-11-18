package ai.storyfork.content.search.domain

import ai.storyfork.content._common.helper.contentKey
import java.util.UUID
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

private val hashMapper = JsonMapper.builder().build()

/** 색인 문서 종류다. [code]는 색인의 `kind` 값이고 문서 키(`종류:ID`)의 앞부분이다. */
enum class SearchKind(val code: String) { WORK("work"), WORLD("world"), CARD("card") }

/** 후보 검색 결과 한 건이다. [id]는 작품·세계관·카드의 ID이고, 카드면 [worldId]는 그 카드가 든 세계관이다. */
data class SearchHit(val id: String, val worldId: String?)

/** Elasticsearch `wildcard` 질의에서 사용자가 입력한 `\`·`*`·`?`가 글자 그대로 찾아지도록 이스케이프한다. */
fun escapeWildcard(text: String): String = text.replace("\\", "\\\\").replace("*", "\\*").replace("?", "\\?")

/**
 * [kind] 문서 중 [fields]의 어느 한 곳(필드 → 찾을 말)에 그 말이 대소문자 무시로 들어 있는 것의 ID(카드는 세계관 ID도)만 최대 [limit]개 찾는 요청 본문이다.
 * 점수·본문은 필요 없어 후보 ID만 받는다. 사용자가 입력한 `*`·`?`는 [escapeWildcard]로 글자 그대로 찾는다.
 */
fun candidateRequest(kind: SearchKind, fields: Map<String, String>, limit: Int): Map<String, Any> {
    val matches = fields.map { (field, term) ->
        mapOf("wildcard" to mapOf(field to mapOf("value" to "*" + escapeWildcard(term) + "*", "case_insensitive" to true)))
    }
    return mapOf(
        "size" to limit, "_source" to listOf("world_id"),
        "query" to mapOf("bool" to mapOf("filter" to listOf(
            mapOf("term" to mapOf("kind" to kind.code)),
            mapOf("bool" to mapOf("should" to matches, "minimum_should_match" to 1)),
        ))),
    )
}

/** 후보 검색 응답을 읽는다. 시간 초과·일부 샤드 실패·모양 오류는 결과가 아니라 [IllegalStateException]이다(일부만 보고 성공으로 치지 않는다). */
fun parseHits(response: JsonNode, kind: SearchKind): List<SearchHit> {
    val hits = response.path("hits").path("hits")
    check(!response.path("timed_out").asBoolean(true) && response.path("_shards").path("failed").asInt(-1) == 0 && hits.isArray) { "Incomplete search" }
    return hits.toList().map { SearchHit(it.path("_id").asString().removePrefix(kind.code + ":"), it.path("_source").path("world_id").asString(null)) }
}

/**
 * 색인 문서 하나다. 키는 `종류:ID`이고 [hash]가 같으면 내용이 같다(주기 대조가 바뀐 문서만 다시 쓴다).
 * 해시 입력은 필드를 키 순서로 JSON으로 쓴 것이라 필드·목록 경계가 보존된다(`["a","b"]`와 `["a, b"]`는 다른 문서다).
 */
data class SearchDocument(val kind: SearchKind, val id: String, val fields: Map<String, Any>) {
    val key: String get() = kind.code + ":" + id
    val hash: String = contentKey(kind.code, id, hashMapper.writeValueAsString(fields.toSortedMap()))

    /** 색인에 쓰는 문서 본문이다: 검색하는 값에 종류와 내용 해시가 더해진다. */
    fun source(): Map<String, Any> = buildMap {
        put("kind", kind.code)
        putAll(fields)
        put("hash", hash)
    }
}

/** 작품 문서: 제목·작가 닉네임·태그(앞 `#` 제외, 작품 검색 규칙)·장르다. */
fun workDocument(id: String, title: String, author: String, tags: List<String>, genres: List<String>) =
    SearchDocument(SearchKind.WORK, id, mapOf("title" to title, "author" to author, "tags" to tags.map { it.trimStart('#') }, "genres" to genres))

/** 세계관 문서: 확정 버전의 이름·설명과 작가 닉네임이다. */
fun worldDocument(id: UUID, name: String, description: String, author: String) =
    SearchDocument(SearchKind.WORLD, id.toString(), mapOf("name" to name, "description" to description, "author" to author))

/** 설정 카드 문서: 제목·별칭·태그와 카드가 든 세계관 ID다(본문은 넣지 않는다). */
fun cardDocument(id: UUID, worldId: UUID, title: String, aliases: List<String>, tags: List<String>) =
    SearchDocument(SearchKind.CARD, id.toString(), mapOf("world_id" to worldId.toString(), "title" to title, "aliases" to aliases, "tags" to tags))
