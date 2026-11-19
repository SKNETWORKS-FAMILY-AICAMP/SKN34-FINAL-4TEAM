package ai.storyfork.content.context.service.dto

import ai.storyfork.content.manuscript.client.dto.QaExcerpt
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

sealed interface QaCitation {
    val kind: String
    val id: String
    val workId: String
    val sourceWorkId: String?
    val episode: Int
    val quote: String
}

data class QaSource(
    override val id: String, override val workId: String, override val sourceWorkId: String?, val episodeId: String,
    override val episode: Int, val versionId: String, val startUtf16: Int, val endUtf16: Int, override val quote: String,
) : QaCitation {
    override val kind = "manuscript"
}

data class QaGap(val code: String, val detail: String)
data class QaCoverage(
    val expected: List<QaEpisodeRef>,
    val withVerifiedExcerpt: List<QaEpisodeRef>,
    val withoutVerifiedExcerpt: List<QaEpisodeRef>,
)
/** AI Retrieval 도구 요청. scopeToken은 Content가 `QaScopeGrants`로 서명해 오케스트레이션에 넘긴 조회 키다. */
data class QaRetrievalRequest(
    @field:NotBlank @field:Size(max=1000) val scopeToken: String,
    @field:NotBlank @field:Size(max=500) val question: String,
)
/** 검색 단계 하나의 공급자(embedding·elasticsearch·postgres_verify), 소요 시간, 결과 수. */
data class QaRetrievalStep(val provider: String, val ms: Long, val hits: Int)
/** status는 found 또는 insufficient다. excerpts는 AI Q&A 입력 형식, sources는 출처 원본 참조다. */
internal data class QaRetrievalResponse(
    val status: String, val sources: List<QaCitation>, val excerpts: List<QaExcerpt>,
    val gaps: List<QaGap>, val coverage: QaCoverage, val steps: List<QaRetrievalStep>,
)
