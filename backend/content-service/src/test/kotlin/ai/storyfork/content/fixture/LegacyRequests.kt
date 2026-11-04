package ai.storyfork.content.fixture

import ai.storyfork.content.fixture.model.*
import jakarta.validation.constraints.*

data class CreateWorkRequest(@field:NotBlank @field:Size(max=120) val title: String, @field:Size(max=2000) val summary: String = "")
data class DraftRequest(@field:NotBlank @field:Size(max=120) val title: String, @field:Size(max=40000) val body: String, @field:Min(0) val revision: Int)
data class RevisionRequest(@field:Min(0) val revision: Int)
data class PublishRequest(@field:Min(0) val revision: Int, val rightsConfirmed: Boolean, val allowFork: Boolean = false, val allowForkPublication: Boolean = false, val versionId: String? = null)
data class PolicyRequest(@field:Min(0) val revision: Int, val allowFork: Boolean, val allowForkPublication: Boolean)
data class ForkRequest(@field:Min(1) val episode: Int, @field:NotBlank @field:Size(max=120) val title: String, @field:Size(max=2000) val summary: String = "", @field:Size(max=2000) val direction: String = "")
data class ProposalRequest(@field:Min(0) val revision: Int, @field:NotBlank @field:Size(max=2000) val prompt: String, val consent: Boolean, @field:Min(1) val episode: Int? = null, @field:Size(max=80) val character: String = "")
data class SettingRequest(@field:Min(0) val revision: Int, val setting: Setting, @field:NotBlank val sourceToken: String)
data class RevertRequest(@field:Min(0) val revision: Int, @field:NotBlank val versionId: String)
data class ChangeRequest(@field:Min(0) val revision: Int, @field:NotBlank val changeId: String, @field:Pattern(regexp="apply|reject") val decision: String)
data class WorkResponse(val id: String, val title: String, val summary: String, val visibility: String, val allowFork: Boolean, val allowForkPublication: Boolean, val source: Source?, val episodes: List<Episode>, val draft: Draft?)
data class HistoryResponse(val versions: List<Version>, val proposals: List<Proposal>, val policyHistory: List<Policy>, val publicationHistory: List<Publication>)
