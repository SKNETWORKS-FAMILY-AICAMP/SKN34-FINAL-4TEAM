package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.world.domain.WorldCoverFile
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.service.WorldCardImageService
import ai.storyfork.content.world.service.dto.WorldCardImageResponse
import ai.storyfork.content.world.studio.entity.SettingCardImage
import ai.storyfork.content.world.studio.entity.StudioWorld
import ai.storyfork.content.world.studio.repository.SettingCardImageRepository
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus

/** 소유자 설정 카드 이미지의 업로드·읽기(#401): 저장소(DB)와 객체 저장소(MinIO)는 대역이다. 실제 HTTP·DB는 CI의 WorldCardImageHttpIntegrationTest가 확인한다. */
class WorldCardImageServiceTest {
    private val worlds = mock(StudioWorldRepository::class.java)
    private val images = mock(SettingCardImageRepository::class.java)
    private val storage = mock(AttachmentStorageClient::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val service = WorldCardImageService(worlds, images, storage, manager)
    private val id = UUID.randomUUID()
    private val owner = UUID.randomUUID()
    private val png = WorldCoverFile(byteArrayOf(1, 2, 3), "image/png")
    private val empty = AttachmentObjectPayload(ByteArray(0), "")
    private val blank = SettingCardImage(UUID(0, 0), UUID(0, 0), "", "image/png")
    private val storageDown = AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "첨부 저장소 요청을 완료하지 못했어요. 다시 시도해 주세요.")

    /** 소유자의 세계관 하나를 잠금 조회·일반 조회 양쪽에 건다. */
    private fun owned() = StudioWorld(id, owner).also {
        `when`(worlds.lockOwned(id, owner)).thenReturn(it)
        `when`(worlds.findById(id)).thenReturn(Optional.of(it))
    }

    @Test fun `put stores the object under world-card-images first and only then records the image row`() {
        owned()
        var uploaded = false
        doAnswer { uploaded = true; Unit }.`when`(storage).upload(anyString(), any(AttachmentObjectPayload::class.java) ?: empty)
        `when`(images.save(any(SettingCardImage::class.java) ?: blank)).thenAnswer {
            assertTrue(uploaded, "DB 행은 객체가 저장된 뒤에 만든다")
            it.arguments[0]
        }
        val result = service.put(id, owner, png)
        val key = ArgumentCaptor.forClass(String::class.java)
        val payload = ArgumentCaptor.forClass(AttachmentObjectPayload::class.java)
        verify(storage).upload(key.capture() ?: "", payload.capture() ?: empty)
        val row = ArgumentCaptor.forClass(SettingCardImage::class.java)
        verify(images).save(row.capture() ?: blank)
        assertEquals("world-card-images/${row.value.id}", key.value)
        assertEquals(key.value, row.value.objectKey)
        assertEquals(id, row.value.worldId)
        assertEquals("image/png", row.value.contentType)
        assertEquals("image/png", payload.value.mediaType)
        assertArrayEquals(png.bytes, payload.value.bytes)
        assertEquals(WorldCardImageResponse(row.value.id, "image/png"), result)
        verify(storage, never()).delete(anyString())
    }

    @Test fun `each upload is a new image and nothing already uploaded is replaced`() {
        owned()
        val first = service.put(id, owner, png).imageId
        val second = service.put(id, owner, WorldCoverFile(byteArrayOf(9), "image/webp"))
        assertNotEquals(first, second.imageId)
        assertEquals("image/webp", second.contentType)
        verify(storage, never()).delete(anyString())
    }

    @Test fun `a failed upload records no row and keeps the storage failure's status`() {
        owned()
        doThrow(storageDown).`when`(storage).upload(anyString(), any(AttachmentObjectPayload::class.java) ?: empty)
        val failure = assertThrows(ContentFailure::class.java) { service.put(id, owner, png) }
        assertEquals(503, failure.status)
        verify(images, never()).save(any(SettingCardImage::class.java) ?: blank)
    }

    @Test fun `someone else's or an unknown world is a 404 before anything is stored or read`() {
        assertThrows(WorldNotFound::class.java) { service.put(id, UUID.randomUUID(), png) }
        assertThrows(WorldNotFound::class.java) { service.read(id, UUID.randomUUID(), UUID.randomUUID()) }
        owned()
        assertThrows(WorldNotFound::class.java) { service.put(id, UUID.randomUUID(), png) }
        assertThrows(WorldNotFound::class.java) { service.read(id, UUID.randomUUID(), UUID.randomUUID()) }
        verifyNoInteractions(storage, images)
    }

    @Test fun `a deleted world's card image is a 404 for its owner and neither the row nor the object is read`() {
        owned().deletedAt = Instant.now()
        assertThrows(WorldNotFound::class.java) { service.read(id, owner, UUID.randomUUID()) }
        verifyNoInteractions(storage, images)
    }

    @Test fun `the owner reads the stored image with its type`() {
        owned()
        val image = UUID.randomUUID()
        `when`(images.findById(image)).thenReturn(Optional.of(SettingCardImage(image, id, "world-card-images/${image}", "image/webp")))
        `when`(storage.read("world-card-images/${image}")).thenReturn(AttachmentObjectResult(byteArrayOf(9, 8, 7)))
        val read = service.read(id, owner, image)
        assertEquals("image/webp", read.contentType)
        assertArrayEquals(byteArrayOf(9, 8, 7), read.bytes)
    }

    @Test fun `an unknown image id and an image of another world are a 404 that never reads storage`() {
        owned()
        val foreign = UUID.randomUUID()
        `when`(images.findById(foreign)).thenReturn(Optional.of(SettingCardImage(foreign, UUID.randomUUID(), "world-card-images/${foreign}", "image/png")))
        listOf(foreign, UUID.randomUUID()).forEach {
            assertEquals(404, assertThrows(ContentFailure::class.java) { service.read(id, owner, it) }.status)
        }
        verifyNoInteractions(storage)
    }

    @Test fun `a storage failure on the owner read keeps its status`() {
        owned()
        val image = UUID.randomUUID()
        `when`(images.findById(image)).thenReturn(Optional.of(SettingCardImage(image, id, "world-card-images/${image}", "image/png")))
        `when`(storage.read("world-card-images/${image}")).thenThrow(storageDown)
        assertEquals(503, assertThrows(ContentFailure::class.java) { service.read(id, owner, image) }.status)
    }
}
