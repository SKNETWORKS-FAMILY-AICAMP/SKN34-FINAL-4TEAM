package ai.storyfork.content.fork.service.dto


data class SourceResponse(val workId: String, val title: String, val episode: Int, val version: Int, val direction: String, val confirmedPolicyRevision: Int? = null, val conditionsConfirmedAt: String? = null, val deleted: Boolean = false)
