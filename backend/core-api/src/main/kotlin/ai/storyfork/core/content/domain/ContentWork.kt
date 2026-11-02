package ai.storyfork.core.content.domain

import java.time.Instant
import java.util.UUID

fun contentId(): String = UUID.randomUUID().toString()
data class Draft(val title: String = "새 회차", val body: String = "", val revision: Int = 0)
data class Episode(val number: Int, val version: Int, val versionId: String, val title: String, val body: String, val inherited: Boolean = false)
data class Source(val workId: String, val title: String, val episode: Int, val version: Int, val direction: String)
data class Version(val id: String = contentId(), val title: String, val body: String, val revision: Int, val episode: Int, val savedAt: String = Instant.now().toString())
data class Setting(
    val id: String = "", val versionId: String = "", val name: String = "", val content: String = "",
    val category: String = "규칙", val tags: List<String> = emptyList(), val visibility: String = "private",
    val fromEpisode: Int = 1, val toEpisode: Int? = null, val knownBy: List<String> = emptyList(), val evidence: String = "",
)
data class Basis(val episode: Int, val version: Int, val settings: List<Setting>)
data class WorldState(
    var revision: Int = 0, var mode: String = "own", var basis: Basis? = null,
    var history: MutableList<Setting> = mutableListOf(), var draft: Setting? = null,
    val drafts: MutableMap<String, Setting> = linkedMapOf(), var sourceSnapshot: List<Setting> = emptyList(),
    val decisions: MutableMap<String, String> = linkedMapOf(),
)
data class Usage(val inputTokens: Int, val outputTokens: Int)
data class Proposal(
    val id: String = contentId(), val text: String, val model: String, val revision: Int,
    var status: String = "pending", val prompt: String, val baseBody: String, val context: StoryContext,
    val providerResponseId: String? = null, val usage: Usage? = null, val createdAt: String = Instant.now().toString(),
)
data class Publication(val episode: Int, val versionId: String, val publishedAt: String = Instant.now().toString())
data class Policy(val allowFork: Boolean, val allowForkPublication: Boolean, val changedAt: String = Instant.now().toString())
data class ContentWork(
    val id: String = contentId(), val ownerId: String, val title: String, val summary: String = "",
    var visibility: String = "private", var allowFork: Boolean = false, var allowForkPublication: Boolean = false,
    val source: Source? = null, val episodes: MutableList<Episode> = mutableListOf(), var draft: Draft = Draft(),
    val versions: MutableList<Version> = mutableListOf(), val proposals: MutableList<Proposal> = mutableListOf(),
    val policyHistory: MutableList<Policy> = mutableListOf(), val publicationHistory: MutableList<Publication> = mutableListOf(),
    val world: WorldState = WorldState(),
)
class ContentFailure(val status: Int, override val message: String): RuntimeException(message)
fun checkContent(ok: Boolean, status: Int = 422, message: String) { if (!ok) throw ContentFailure(status, message) }

fun validateSetting(s: Setting) {
    checkContent(s.name.isNotBlank() && s.name.length <= 120 && s.content.isNotBlank() && s.content.length <= 8000, message="설정 이름과 본문 길이를 확인해 주세요.")
    checkContent(s.visibility in setOf("private", "public") && s.category in setOf("규칙", "인물", "장소", "광물", "상태", "지식", "관계"), message="설정 종류와 공개 범위를 확인해 주세요.")
    checkContent(s.fromEpisode >= 1 && (s.toEpisode == null || s.toEpisode >= s.fromEpisode), message="설정 회차 범위를 확인해 주세요.")
    checkContent(s.tags.size <= 20 && s.knownBy.size <= 30 && (s.tags+s.knownBy).all { it.isNotBlank() && it.length <= 80 } && s.evidence.length <= 1000, message="태그·인물명·근거의 길이를 확인해 주세요.")
}
