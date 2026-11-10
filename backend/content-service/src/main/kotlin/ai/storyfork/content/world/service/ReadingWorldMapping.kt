package ai.storyfork.content.world.service

import ai.storyfork.content.world.domain.Setting
import ai.storyfork.content.world.entity.SettingReadingDetailEntity
import ai.storyfork.content.world.service.dto.*

fun toReadingResponse(setting: Setting, detail: SettingReadingDetailEntity?, episode: Int, visibleIds: Set<String>, sourceBasis: Int? = null): ReadingDocumentResponse {
    val epoch=minOf(episode,detail?.sourceBasisEpisode ?: episode,sourceBasis ?: episode)
    return ReadingDocumentResponse(
        setting.id, setting.versionId,
        detail?.wikiCategory ?: when (setting.category) { "인물" -> "char"; "장소" -> "place"; else -> "world" },
        setting.name, setting.content, detail?.aliases.orEmpty().toList(), setting.tags,
        detail?.properties.orEmpty().filter { it.episode <= epoch && it.publicFromEpisode?.let {from -> from <= epoch} == true }.sortedBy { it.episode }
            .associateBy { it.name }.values.map { ReadingPropertyResponse(it.name, it.value) },
        detail?.color ?: "#7C8A9E", detail?.image, detail?.eventEpisode, detail?.eventLine, detail?.participants.orEmpty().toList(),
        detail?.knowledge.orEmpty().filter { it.knownAt <= epoch && it.publicAt != null && it.publicAt!! <= epoch }
            .map { ReadingKnowledgeResponse(it.text, it.knownAt, it.publicAt!!) },
        detail?.links.orEmpty().filter { it.target in visibleIds }.map { ReadingLinkResponse(it.target, it.kind) },
    )
}
