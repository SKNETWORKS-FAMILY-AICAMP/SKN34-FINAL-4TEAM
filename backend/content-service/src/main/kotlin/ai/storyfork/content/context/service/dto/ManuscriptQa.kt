package ai.storyfork.content.context.service.dto

import ai.storyfork.content.manuscript.client.dto.QaExcerpt
import java.util.UUID
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class ManuscriptQaRequest(
    @field:Min(1) val episode: Int,
    @field:NotBlank @field:Size(max=100) val episodeVersionId: String,
    @field:NotBlank @field:Size(max=500) val question: String,
    val consent: Boolean = false,
    val target: String = "manuscript",
)

data class QaClaim(val text: String, val kind: String, val sourceIds: List<String>)
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

data class QaSettingSource(
    override val id: String, override val workId: String, override val sourceWorkId: String?,
    override val episode: Int, override val quote: String, val settingId: String, val versionId: String, val title: String,
) : QaCitation {
    override val kind = "setting"
}

data class QaRelationshipSource(
    override val id: String, override val workId: String, override val sourceWorkId: String?,
    override val episode: Int, override val quote: String, val worldId: UUID, val graphVersion: Long,
    val relationshipId: UUID, val title: String,
) : QaCitation {
    override val kind = "relationship"
}

data class QaGap(val code: String, val detail: String)
data class QaCoverage(
    val expected: List<QaEpisodeRef>,
    val withVerifiedExcerpt: List<QaEpisodeRef>,
    val withoutVerifiedExcerpt: List<QaEpisodeRef>,
)
/** AI Retrieval 도구 요청. owner는 Content가 오케스트레이션에 넘긴 회원 UUID이며 범위는 Content가 다시 확정한다. */
data class QaRetrievalRequest(
    @field:Size(max=100) val owner: String? = null,
    @field:Min(1) val episode: Int,
    @field:NotBlank @field:Size(max=100) val episodeVersionId: String,
    @field:NotBlank @field:Size(max=500) val question: String,
    val target: String = "manuscript",
)
/** 검색 단계 하나의 공급자(embedding·elasticsearch·postgres_verify·postgres_settings·neo4j), 소요 시간, 결과 수. */
data class QaRetrievalStep(val provider: String, val ms: Long, val hits: Int)
/** status는 found 또는 insufficient다. excerpts는 AI Q&A 입력 형식, sources는 출처 원본 참조다. */
internal data class QaRetrievalResponse(
    val status: String, val sources: List<QaCitation>, val excerpts: List<QaExcerpt>,
    val gaps: List<QaGap>, val coverage: QaCoverage, val steps: List<QaRetrievalStep>,
)
data class ManuscriptQaResponse(
    val status: String, val claims: List<QaClaim>, val sources: List<QaCitation>,
    val gaps: List<QaGap>, val coverage: QaCoverage,
)
