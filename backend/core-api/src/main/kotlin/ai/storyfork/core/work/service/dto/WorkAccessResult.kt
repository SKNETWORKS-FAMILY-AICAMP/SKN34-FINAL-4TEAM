package ai.storyfork.core.work.service.dto

import ai.storyfork.core.fork.service.dto.SourceResponse

data class WorkAccessResult(val id: String, val ownerId: String, val title: String, val summary: String, val revision: Int, val worldId: String, val visibility: String, val allowFork: Boolean, val allowForkPublication: Boolean, val source: SourceResponse?)
