package ai.storyfork.content.work.service.dto

import ai.storyfork.content.fork.service.dto.SourceResponse

data class WorkAccessResult(val id: String, val ownerId: String, val title: String, val summary: String, val revision: Int, val worldId: String, val visibility: String, val allowFork: Boolean, val allowForkPublication: Boolean, val source: SourceResponse?, val restricted: Boolean = false) {
    fun publiclyVisible() = visibility=="public" && !restricted
}
