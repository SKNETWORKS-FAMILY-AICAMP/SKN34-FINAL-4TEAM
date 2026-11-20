package ai.storyfork.content.storage.service

import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.storage.service.dto.StorageItem
import ai.storyfork.content.storage.service.dto.StorageUsageResponse
import ai.storyfork.content.world.repository.SettingDocumentRepository
import ai.storyfork.content.world.studio.repository.SettingCardDraftRepository
import java.util.UUID
import org.springframework.stereotype.Service

@Service
class StorageUsageService(
    private val manuscripts: EpisodeRepository,
    private val documents: SettingDocumentRepository,
    private val cards: SettingCardDraftRepository,
    private val images: ContentImageRepository,
) {
    fun read(owner: UUID): StorageUsageResponse {
        val subject = owner.toString()
        val items = manuscripts.storageItems(subject) + documents.storageItems(subject) + cards.storageItems(owner) + images.storageItems(subject)
        return StorageUsageResponse(items.sortedWith(compareByDescending<StorageItem> { it.bytes }.thenBy { it.kind }.thenBy { it.id }))
    }
}
