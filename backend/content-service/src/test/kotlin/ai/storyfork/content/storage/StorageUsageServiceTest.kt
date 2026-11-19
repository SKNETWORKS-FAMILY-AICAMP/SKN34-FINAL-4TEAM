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

    @Test fun `totals are based on the same owner scoped rows as the list`() {
        val episode = StorageItem("episode", "manuscript", "1화 · 시작", "작품", 3)
        val legacy = StorageItem("setting", "setting", "옛 장소", "세계관", 6)
        val studio = StorageItem("card", "setting", "등장인물", "설정집", 9)
        val image = StorageItem("image", "manuscript_image", "시장.png", "작품 · 1화", 3_000_000_000L)
        `when`(manuscripts.storageItems(owner.toString())).thenReturn(listOf(episode))
        `when`(documents.storageItems(owner.toString())).thenReturn(listOf(legacy))
        `when`(cards.storageItems(owner)).thenReturn(listOf(studio))
        `when`(images.storageItems(owner.toString())).thenReturn(listOf(image))

        val usage = service.read(owner)

        assertEquals(3_000_000_018L, usage.totalBytes)
        assertEquals(3L, usage.manuscriptBytes)
        assertEquals(15L, usage.settingBytes)
        assertEquals(3_000_000_000L, usage.manuscriptImageBytes)
        assertEquals(setOf(episode, legacy, studio, image), usage.items.toSet())
    }

    @Test fun `a member with no qualifying rows has zero usage and an empty list`() {
        val usage = service.read(owner)

        assertEquals(0L, usage.totalBytes)
        assertEquals(0L, usage.manuscriptBytes)
        assertEquals(0L, usage.settingBytes)
        assertEquals(0L, usage.manuscriptImageBytes)
        assertEquals(emptyList<StorageItem>(), usage.items)
    }
}
