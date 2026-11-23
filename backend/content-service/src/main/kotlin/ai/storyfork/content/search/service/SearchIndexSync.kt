package ai.storyfork.content.search.service

import ai.storyfork.content.search.client.SearchElasticsearch
import ai.storyfork.content.search.domain.SearchDocument

/** 한 번의 대조로 쓴 문서 수([put], 추가·갱신)와 지운 문서 수([removed])다. */
data class SearchIndexChanges(val put: Int, val removed: Int)

/** 지금 공개 대상 문서와 색인을 맞춘다: 없는 것은 쓰고, 해시가 다른 것은 다시 쓰고, 대상에서 빠진 것은 지운다. */
class SearchIndexSync(private val index: SearchElasticsearch) {
    fun reconcile(wanted: List<SearchDocument>): SearchIndexChanges {
        val byKey = wanted.associateBy { it.key }
        val existing = index.hashes()
        val stale = (existing.keys - byKey.keys).toList()
        val changed = byKey.values.filter { existing[it.key] != it.hash }
        stale.chunked(BATCH).forEach(index::remove)
        changed.chunked(BATCH).forEach(index::put)
        return SearchIndexChanges(put = changed.size, removed = stale.size)
    }
}

private const val BATCH = 100
