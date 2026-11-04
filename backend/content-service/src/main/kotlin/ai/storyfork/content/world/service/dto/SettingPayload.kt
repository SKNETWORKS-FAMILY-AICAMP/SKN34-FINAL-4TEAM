package ai.storyfork.content.world.service.dto

import ai.storyfork.content.world.domain.Setting


data class SettingPayload(val id: String = "", val versionId: String = "", val name: String = "", val content: String = "", val category: String = "규칙", val tags: List<String> = emptyList(), val visibility: String = "private", val fromEpisode: Int = 1, val toEpisode: Int? = null, val knownBy: List<String> = emptyList(), val evidence: String = "")


internal fun SettingPayload.toDomain() = Setting(id,versionId,name,content,category,tags,visibility,fromEpisode,toEpisode,knownBy,evidence)
internal fun Setting.toPayload() = SettingPayload(id,versionId,name,content,category,tags,visibility,fromEpisode,toEpisode,knownBy,evidence)
