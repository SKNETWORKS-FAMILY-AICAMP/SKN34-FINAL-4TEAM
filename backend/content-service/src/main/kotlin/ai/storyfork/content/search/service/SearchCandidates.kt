package ai.storyfork.content.search.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.search.client.SearchElasticsearch
import ai.storyfork.content.search.domain.SearchHit
import ai.storyfork.content.search.domain.SearchKind
import ai.storyfork.content.work.domain.SearchField
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

/**
 * 색인이 한 번에 돌려주는 후보의 상한이다.
 * ponytail: 후보는 이 수까지만 받아 그 안에서 DB로 거른다. 상한을 넘는 일치는 잘린다(시연 규모). 늘면 공개 조건을 색인 필터로 옮기고 페이지도 색인에서 자른다.
 */
const val SEARCH_CANDIDATE_LIMIT = 500

/**
 * 검색 경로 선택은 이 한 곳이다(#505). 색인([SearchElasticsearch], `app.search-index.enabled=true`일 때만 빈이 있다)이 없으면 모든 함수가 null이고 호출자가 DB 전체를 읽는다.
 * 색인이 있으면 그것이 찾은 **후보 ID**를 돌려주고, 공개 여부·일치·정렬·페이지·작가명은 호출자가 DB에서 지금처럼 정한다. 색인 호출이 실패하면 DB로 대신하지 않고 503이다.
 */
@Service
class SearchCandidates(private val index: SearchElasticsearch?) {
    private val log = LoggerFactory.getLogger(SearchCandidates::class.java)

    /**
     * 작품 후보 ID다. [q]가 없거나 공백이면 검색이 아니라 전체 목록이라 null이다. 찾는 곳([field])과 해시태그의 앞 `#` 무시는 DB 일치 규칙
     * ([ai.storyfork.content.work.domain.matchesSearch])과 같다.
     */
    fun works(q: String?, field: SearchField): Set<String>? {
        val term = q?.trim().orEmpty().ifEmpty { return null }
        val tag = term.trimStart('#')
        val fields = when (field) {
            SearchField.TITLE -> mapOf("title" to term)
            SearchField.AUTHOR -> mapOf("author" to term)
            SearchField.TAG -> mapOf("tags" to tag)
            SearchField.GENRE -> mapOf("genres" to term)
            SearchField.ALL -> mapOf("title" to term, "author" to term, "tags" to tag, "genres" to term)
        }
        return ask(SearchKind.WORK, fields) { it.id }
    }

    /** 세계관 후보 ID다([term]은 앞뒤 공백을 자른 비어 있지 않은 검색어). 이름·설명·작가 닉네임에서 찾는다. */
    fun worlds(term: String): Set<UUID>? =
        ask(SearchKind.WORLD, mapOf("name" to term, "description" to term, "author" to term)) { UUID.fromString(it.id) }

    /** 제목·별칭·태그에 [term]이 든 설정 카드가 있는 세계관 ID다. 카드가 보이는지는 호출자가 상세와 같은 기준으로 다시 정한다. */
    fun cardWorlds(term: String): Set<UUID>? =
        ask(SearchKind.CARD, mapOf("title" to term, "aliases" to term, "tags" to term)) { UUID.fromString(checkNotNull(it.worldId)) }

    private fun <T> ask(kind: SearchKind, fields: Map<String, String>, pick: (SearchHit) -> T): Set<T>? {
        val es = index ?: return null
        return try {
            es.candidates(kind, fields, SEARCH_CANDIDATE_LIMIT).mapTo(mutableSetOf(), pick)
        } catch (error: RuntimeException) {
            log.warn("search index request failed: {}", error.toString())
            throw ContentFailure(503, "검색을 완료할 수 없어요. 잠시 뒤 다시 시도해 주세요.")
        }
    }
}
