package ai.storyfork.content.work.service.dto

data class UpdateWorkSettingsRequest(val revision: Int?, val writingMode: String?)

data class WorkSettingsVersionResponse(val revision: Int, val writingMode: String?, val changedAt: String?)

data class WorkSettingsResponse(
    val current: WorkSettingsVersionResponse,
    val history: List<WorkSettingsVersionResponse>,
    val worldUpdateMode: String = "manual",
    val proofreadingMode: String = "review",
    val autoserialState: String = "off",
)
