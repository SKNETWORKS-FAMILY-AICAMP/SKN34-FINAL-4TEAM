package ai.storyfork.content.storage

import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.storage.service.StorageUsageService
import ai.storyfork.content.storage.service.dto.StorageItem
import ai.storyfork.content.world.repository.SettingDocumentRepository
import ai.storyfork.content.world.studio.repository.SettingCardDraftRepository
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`

class StorageUsageServiceTest {
    private val owner = UUID.fromString("00000000-0000-0000-0000-000000000036")
    private val manuscripts = mock(EpisodeRepository::class.java)
    private val documents = mock(SettingDocumentRepository::class.java)
    private val cards = mock(SettingCardDraftRepository::class.java)
    private val images = mock(ContentImageRepository::class.java)
    private val service = StorageUsageService(manuscripts, documents, cards, images)

    @Test fun `items from every owner scoped source are listed largest first`() {
        val episode = StorageItem("episode", "manuscript", "1화 · 시작", "작품", 3)
        val legacy = StorageItem("setting", "setting", "옛 장소", "세계관", 6)
        val studio = StorageItem("card", "setting", "등장인물", "설정집", 9)
        val image = StorageItem("image", "manuscript_image", "시장.png", "작품 · 1화", 3_000_000_000L)
        val tie = StorageItem("a-episode", "manuscript", "2화", "작품", 3)
        `when`(manuscripts.storageItems(owner.toString())).thenReturn(listOf(episode, tie))
        `when`(documents.storageItems(owner.toString())).thenReturn(listOf(legacy))
        `when`(cards.storageItems(owner)).thenReturn(listOf(studio))
        `when`(images.storageItems(owner.toString())).thenReturn(listOf(image))

        assertEquals(listOf(image, studio, legacy, tie, episode), service.read(owner).items)
    }

    @Test fun `a member with no qualifying rows has an empty list`() {
        assertEquals(emptyList<StorageItem>(), service.read(owner).items)
    }
}
