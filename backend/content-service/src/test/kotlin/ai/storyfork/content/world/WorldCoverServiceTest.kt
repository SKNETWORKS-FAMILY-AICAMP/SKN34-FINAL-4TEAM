package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.world.domain.WorldCoverFile
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.service.WorldCoverService
import ai.storyfork.content.world.service.dto.WorldCoverResponse
import ai.storyfork.content.world.studio.entity.StudioWorld
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
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

/** 소유자 세계관 표지의 저장·삭제·조회: 저장소(DB)와 객체 저장소(MinIO)는 대역이다. 실제 HTTP·DB는 CI의 WorldCoverHttpIntegrationTest가 확인한다. */
class WorldCoverServiceTest {
    private val worlds = mock(StudioWorldRepository::class.java)
    private val storage = mock(AttachmentStorageClient::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val service = WorldCoverService(worlds, storage, manager)
    private val id = UUID.randomUUID()
    private val owner = UUID.randomUUID()
    private val png = WorldCoverFile(byteArrayOf(1, 2, 3), "image/png")
    private val empty = AttachmentObjectPayload(ByteArray(0), "")
    private val storageDown = AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "첨부 저장소 요청을 완료하지 못했어요. 다시 시도해 주세요.")

    /** 소유자의 세계관 하나(표지는 인자대로)를 잠금 조회·일반 조회 양쪽에 건다. */
    private fun world(key: String? = null, type: String? = null) = StudioWorld(id, owner, coverObjectKey = key, coverContentType = type).also {
        `when`(worlds.lockOwned(id, owner)).thenReturn(it)
        `when`(worlds.findById(id)).thenReturn(Optional.of(it))
    }

    @Test fun `put stores the new object first and only then points the world at it`() {
        val entity = world()
        doAnswer { assertNull(entity.coverObjectKey, "DB는 새 객체가 저장된 뒤에 바뀐다") }.`when`(storage).upload(anyString(), any(AttachmentObjectPayload::class.java) ?: empty)
        assertEquals(WorldCoverResponse(id, true), service.put(id, owner, png))
        val key = ArgumentCaptor.forClass(String::class.java)
        val payload = ArgumentCaptor.forClass(AttachmentObjectPayload::class.java)
        verify(storage).upload(key.capture() ?: "", payload.capture() ?: empty)
        assertTrue(key.value.startsWith("world-covers/"))
        assertEquals(key.value, entity.coverObjectKey)
        assertEquals("image/png", entity.coverContentType)
        assertEquals("image/png", payload.value.mediaType)
        assertArrayEquals(png.bytes, payload.value.bytes)
        verify(storage, never()).delete(anyString())
    }

    @Test fun `replacing deletes the previous object only after the world points at the new one and a failed delete is not an error`() {
        val entity = world("world-covers/old", "image/jpeg")
        doAnswer {
            assertNotEquals("world-covers/old", entity.coverObjectKey, "이전 객체는 DB가 새 객체를 가리킨 뒤에 지운다")
            throw storageDown
        }.`when`(storage).delete("world-covers/old")
        assertEquals(WorldCoverResponse(id, true), service.put(id, owner, WorldCoverFile(byteArrayOf(9), "image/webp")))
        assertEquals("image/webp", entity.coverContentType)
        assertNotEquals("world-covers/old", entity.coverObjectKey)
        verify(storage).delete("world-covers/old")
    }

    @Test fun `a failed upload keeps the world and the previous object as they were`() {
        val entity = world("world-covers/old", "image/jpeg")
        doThrow(storageDown).`when`(storage).upload(anyString(), any(AttachmentObjectPayload::class.java) ?: empty)
        val failure = assertThrows(ContentFailure::class.java) { service.put(id, owner, png) }
        assertEquals(503, failure.status)
        assertEquals("world-covers/old", entity.coverObjectKey)
        assertEquals("image/jpeg", entity.coverContentType)
        verify(storage, never()).delete(anyString())
    }

    @Test fun `someone else's or an unknown world is a 404 before anything is stored`() {
        assertThrows(WorldNotFound::class.java) { service.put(id, UUID.randomUUID(), png) }
        assertThrows(WorldNotFound::class.java) { service.delete(id, UUID.randomUUID()) }
        assertThrows(WorldNotFound::class.java) { service.read(id, UUID.randomUUID()) }
        world()
        assertThrows(WorldNotFound::class.java) { service.put(id, UUID.randomUUID(), png) }
        assertThrows(WorldNotFound::class.java) { service.read(id, UUID.randomUUID()) }
        verifyNoInteractions(storage)
    }

    @Test fun `delete clears the reference first, then removes the object, and a failed removal is not an error`() {
        val entity = world("world-covers/old", "image/png")
        doAnswer {
            assertNull(entity.coverObjectKey, "객체는 DB가 참조를 지운 뒤에 지운다")
            throw storageDown
        }.`when`(storage).delete("world-covers/old")
        service.delete(id, owner)
        assertNull(entity.coverObjectKey)
        assertNull(entity.coverContentType)
        verify(storage).delete("world-covers/old")
    }

    @Test fun `deleting a world that has no cover changes nothing and never touches storage`() {
        world()
        service.delete(id, owner)
        verifyNoInteractions(storage)
    }

    @Test fun `the owner reads the stored cover with its type and a world without one is a 404`() {
        world("world-covers/a", "image/webp")
        `when`(storage.read("world-covers/a")).thenReturn(AttachmentObjectResult(byteArrayOf(9, 8, 7)))
        val image = service.read(id, owner)
        assertEquals("image/webp", image.contentType)
        assertArrayEquals(byteArrayOf(9, 8, 7), image.bytes)
        world()
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.read(id, owner) }.status)
        world("world-covers/a", "image/webp")
        `when`(storage.read("world-covers/a")).thenThrow(storageDown)
        assertEquals(503, assertThrows(ContentFailure::class.java) { service.read(id, owner) }.status)
    }
}
