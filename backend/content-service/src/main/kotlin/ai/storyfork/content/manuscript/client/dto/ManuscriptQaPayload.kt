package ai.storyfork.content.manuscript.client.dto

internal data class ManuscriptQaPayload(val question: String, val excerpts: List<QaExcerpt>)

internal data class QaExcerpt(
    val id: String, val episode: Int, val quote: String, val kind: String = "manuscript", val title: String = "",
)
