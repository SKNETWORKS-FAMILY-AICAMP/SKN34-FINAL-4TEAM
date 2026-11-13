package ai.storyfork.content.context.service.dto

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
data class ManuscriptQaResponse(
    val status: String, val claims: List<QaClaim>, val sources: List<QaCitation>,
    val gaps: List<QaGap>, val coverage: QaCoverage,
)
