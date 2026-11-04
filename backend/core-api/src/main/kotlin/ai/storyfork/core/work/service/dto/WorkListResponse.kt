package ai.storyfork.core.work.service.dto

import com.fasterxml.jackson.annotation.JsonValue

data class WorkListResponse(@get:JsonValue val items: List<WorkResponse>)
