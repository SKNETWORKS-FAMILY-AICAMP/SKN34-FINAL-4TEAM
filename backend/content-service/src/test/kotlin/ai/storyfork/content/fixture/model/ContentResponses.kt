package ai.storyfork.content.fixture.model

import java.time.Instant
import java.util.UUID

// Test-only response shapes retain the original business assertions through ContentTestDriver.
// No legacy aggregate, importer, persistence implementation or duplicated business logic lives here.
fun contentId(): String = UUID.randomUUID().toString()
data class Draft(val title: String = "새 회차", val body: String = "", val revision: Int = 0)
data class WritingEpisode(val number: Int, val draft: Draft, val versions: List<Version>, val publishedVersionId: String?, val inherited: Boolean, val updatedAt: String?, val checkpointStatus: String = "content_only")
data class Episode(val number: Int, val version: Int, val versionId: String, val title: String, val body: String, val inherited: Boolean = false)
data class Source(val workId: String, val title: String, val episode: Int, val version: Int, val direction: String,
    val confirmedPolicyRevision: Int? = null, val conditionsConfirmedAt: String? = null)
data class Version(val id: String = contentId(), val title: String, val body: String, val revision: Int, val episode: Int, val savedAt: String = Instant.now().toString())
data class Setting(
    val id: String = "", val versionId: String = "", val name: String = "", val content: String = "",
    val category: String = "규칙", val tags: List<String> = emptyList(), val visibility: String = "private",
    val fromEpisode: Int = 1, val toEpisode: Int? = null, val knownBy: List<String> = emptyList(), val evidence: String = "",
)
data class Basis(val episode: Int, val version: Int, val settings: List<Setting>)
data class Usage(val inputTokens: Int, val outputTokens: Int)
data class Proposal(
    val id: String = contentId(), val text: String, val model: String, val revision: Int,
    var status: String = "pending", val prompt: String, val baseBody: String, val context: StoryContext,
    val providerResponseId: String? = null, val usage: Usage? = null, val createdAt: String = Instant.now().toString(),
    val targetEpisode: Int? = null, var appliedVersionId: String? = null,
)
data class Publication(val episode: Int, val versionId: String, val publishedAt: String = Instant.now().toString())
data class Policy(val allowFork: Boolean, val allowForkPublication: Boolean, val changedAt: String = Instant.now().toString())
typealias ContentFailure = ai.storyfork.content._common.exception.ContentFailure
data class Excerpt(val start: Int, val end: Int, val text: String)
data class ContextEpisode(val number: Int, val version: Int, val versionId: String, val title: String, val sourceCharacters: Int, val excerpts: List<Excerpt>)
data class Selection(val omittedCharacters: Int, val eligibleEpisodes: Int, val method: String = "source-excerpts", val note: String = "선택된 원문 발췌입니다. 전체 원고 요약이 아닙니다. 인물 시점은 허용 설정만 사용합니다.")
data class StoryContext(val title: String, val summary: String, val basisEpisode: Int, val character: String, val settings: List<Setting>, val draft: String, val episodes: List<ContextEpisode>, val selection: Selection)
data class WorldChange(val id: String, val settingId: String, val before: Setting?, val after: Setting?, val decision: String)
data class WorldView(val id: String, val name: String, val revision: Int, val mode: String, val basis: Basis?, val draft: Setting?, val drafts: List<Setting>, val settings: List<Setting>, val history: List<Setting>, val sourceToken: String, val changes: List<WorldChange>)
