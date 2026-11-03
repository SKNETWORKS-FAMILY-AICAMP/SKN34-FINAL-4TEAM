package ai.storyfork.core.episode_version.service.dto

import com.fasterxml.jackson.annotation.JsonValue

data class VersionListResponse(@get:JsonValue val items: List<VersionResponse>)
