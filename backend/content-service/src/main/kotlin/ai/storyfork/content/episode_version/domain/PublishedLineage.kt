package ai.storyfork.content.episode_version.domain

data class VersionLink(val episodeId: String, val id: String, val restoredFromId: String?)

/** 시간순 저장본 중 현재 발행본의 선행 버전만 찾는다. 복원은 직전 저장 대신 원본을 잇는다. */
fun publishedLineage(versions: List<VersionLink>, published: String?): Set<String> {
    if (published == null) return emptySet()
    val parent = mutableMapOf<String, String?>()
    var previous: String? = null
    for (version in versions) {
        parent[version.id] = version.restoredFromId ?: previous
        previous = version.id
    }
    val result = mutableSetOf<String>()
    var id: String? = published
    while (id != null && id in parent && result.add(id)) id = parent[id]
    return result
}
