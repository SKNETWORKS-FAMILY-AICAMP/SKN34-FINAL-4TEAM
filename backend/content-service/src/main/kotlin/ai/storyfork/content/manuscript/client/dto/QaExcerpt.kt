package ai.storyfork.content.manuscript.client.dto

/** AI 오케스트레이션 Retrieval 응답의 발췌. AI Q&A 입력(`Excerpt`)과 같은 모양이다. */
internal data class QaExcerpt(
    val id: String, val episode: Int, val quote: String, val kind: String = "manuscript", val title: String = "",
)
