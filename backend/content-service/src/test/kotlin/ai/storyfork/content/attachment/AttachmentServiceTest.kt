package ai.storyfork.content.attachment

import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.work.service.dto.WorkResponse
import ai.storyfork.content.episode.service.dto.DraftResponse as Draft
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse as Episode
import ai.storyfork.content.episode.service.dto.EpisodeResponse as WritingEpisode
import ai.storyfork.content.work.service.WorkService as ContentService
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.attachment.entity.ContentImage
import ai.storyfork.content.attachment.entity.ImageWork
import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.attachment.repository.ImageWorkRepository
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.entity.AttachmentSetting
import ai.storyfork.content.attachment.entity.SettingAttachment
import ai.storyfork.content.attachment.repository.AttachmentSettingRepository
import ai.storyfork.content.attachment.repository.SettingAttachmentRepository
import ai.storyfork.content.attachment.service.dto.AttachmentUploadRequest
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.util.Optional
import javax.imageio.ImageIO
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.mock.web.MockMultipartFile
import org.springframework.transaction.TransactionSystemException
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

class AttachmentServiceTest {
    private val settings = mock(AttachmentSettingRepository::class.java)
    private val attachments = mock(SettingAttachmentRepository::class.java)
    private val images = mock(ContentImageRepository::class.java)
    private val works = mock(ImageWorkRepository::class.java)
    private val content = mock(ContentService::class.java)
    private val episodeService = mock(EpisodeService::class.java)
    private val storage = mock(AttachmentStorageClient::class.java)
    private val manager = mock(PlatformTransactionManager::class.java)
    private val imageEpisodes=mock(ai.storyfork.content.attachment.repository.ImageEpisodeRepository::class.java)
    private val service = AttachmentService(settings, attachments, images, works, content, episodeService, storage, TransactionTemplate(manager), imageEpisodes)
    private val png = ByteArrayOutputStream().also {
        ImageIO.write(BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "png", it)
    }.toByteArray()
    private fun request(name: String = "map.png", type: String = "image/png", bytes: ByteArray = png) =
        AttachmentUploadRequest(MockMultipartFile("file", name, type, bytes))

    @BeforeEach fun repositories() {
        `when`(manager.getTransaction(any())).thenReturn(SimpleTransactionStatus())
        `when`(settings.lockOwnedLocal("work", "setting", "owner")).thenReturn(AttachmentSetting(id = "document"))
        `when`(works.lockOwned("work", "owner")).thenReturn(ImageWork(id = "work", ownerId = "owner"))
        `when`(attachments.saveAndFlush(any(SettingAttachment::class.java) ?: SettingAttachment())).thenAnswer { it.arguments[0] }
        `when`(images.saveAndFlush(any(ContentImage::class.java) ?: ContentImage())).thenAnswer { it.arguments[0] }
        `when`(episodeService.read("work", "owner", 1)).thenReturn(WritingEpisode(1, Draft(), emptyList(), null, false, null))
        `when`(imageEpisodes.existsByWorkIdAndSequence("work",1)).thenReturn(true)
    }

    @Test fun `upload rechecks deleted episode under the work lock before writing a file`() {
        `when`(imageEpisodes.existsByWorkIdAndSequence("work",1)).thenReturn(false)
        assertThrows(AttachmentFailure::class.java) {service.createEpisodeImage("work",1,"owner",request())}
        val ordered=inOrder(works,imageEpisodes)
        ordered.verify(works).lockOwned("work","owner")
        ordered.verify(imageEpisodes).existsByWorkIdAndSequence("work",1)
        verifyNoInteractions(storage)
    }
    @Test fun `one attachment service stores setting files work covers and episode images through shared storage`() {
        val file = "설정 문서".toByteArray()
        val setting = service.createSettingAttachment("work", "setting", "owner", request("note.txt", "text/plain", file))
        val cover = service.putCover("work", "owner", request())
        val episode = service.createEpisodeImage("work", 1, "owner", request())

        assertEquals("FILE", setting.kind)
        assertEquals("/api/v1/works/work/settings/setting/attachments/${setting.id}/content", setting.url)
        assertEquals("IMAGE", cover.kind)
        assertEquals("/api/v1/works/work/cover/content", cover.url)
        assertEquals("IMAGE", episode.kind)
        assertEquals("/api/v1/works/work/episodes/1/images/${episode.id}/content", episode.url)
        val keys = ArgumentCaptor.forClass(String::class.java)
        val payloads = ArgumentCaptor.forClass(AttachmentObjectPayload::class.java)
        verify(storage, times(3)).upload(keys.capture() ?: "", payloads.capture() ?: AttachmentObjectPayload(ByteArray(0), ""))
        assertEquals(listOf("setting-attachments", "work-covers", "episode-images"), keys.allValues.map { it.substringBefore('/') })
        assertArrayEquals(file, payloads.allValues[0].bytes)
        assertArrayEquals(png, payloads.allValues[1].bytes)
        assertArrayEquals(png, payloads.allValues[2].bytes)
        verify(settings).lockOwnedLocal("work", "setting", "owner")
        verify(works, times(2)).lockOwned("work", "owner")
        verify(episodeService).read("work", "owner", 1)
        verify(storage, never()).delete(anyString())
    }

    @Test fun `unified service preserves distinct authentication ownership and database errors`() {
        fun failure(code: String, action: () -> Any?) {
            assertEquals(code, assertThrows(AttachmentFailure::class.java) { action() }.code)
        }
        failure("ATTACHMENT_UNAUTHENTICATED") { service.listSettingAttachments("work", "setting", "") }
        failure("IMAGE_UNAUTHENTICATED") { service.readCover("work", "") }
        failure("ATTACHMENT_NOT_FOUND") { service.listSettingAttachments("work", "source-setting", "owner") }
        failure("IMAGE_NOT_FOUND") { service.readCover("other-work", "owner") }
        for (cause in listOf(DataAccessResourceFailureException("private SQL"), TransactionSystemException("private commit"))) {
            doThrow(cause).`when`(manager).getTransaction(any())
            failure("ATTACHMENT_DATABASE_FAILURE") { service.listSettingAttachments("work", "setting", "owner") }
            failure("IMAGE_DATABASE_FAILURE") { service.readCover("work", "owner") }
        }
        verifyNoInteractions(storage)
    }

    @Test fun `setting and episode limits remain separate and general files are not image uploads`() {
        `when`(attachments.countBySettingDocumentIdAndKind("document", "IMAGE")).thenReturn(10L)
        `when`(images.countByWorkIdAndEpisodeNo("work", 1)).thenReturn(10L)
        assertEquals("ATTACHMENT_IMAGE_LIMIT", assertThrows(AttachmentFailure::class.java) {
            service.createSettingAttachment("work", "setting", "owner", request())
        }.code)
        assertEquals("IMAGE_LIMIT", assertThrows(AttachmentFailure::class.java) {
            service.createEpisodeImage("work", 1, "owner", request())
        }.code)
        assertEquals("FILE", service.createSettingAttachment("work", "setting", "owner", request("note.txt", "text/plain", "본문".toByteArray())).kind)
        assertEquals("IMAGE_INVALID", assertThrows(AttachmentFailure::class.java) {
            service.putCover("work", "owner", request("note.txt", "text/plain", "본문".toByteArray()))
        }.code)
        assertEquals("IMAGE_INVALID", assertThrows(AttachmentFailure::class.java) {
            service.createEpisodeImage("work", 1, "owner", request("note.txt", "text/plain", "본문".toByteArray()))
        }.code)
        verify(storage, times(1)).upload(anyString(), any(AttachmentObjectPayload::class.java) ?: AttachmentObjectPayload(ByteArray(0), ""))
    }

    @Test fun `inherited episode images use frozen body references and cannot be created`() {
        val image = ContentImage(workId = "original", episodeNo = 1, objectKey = "episode-images/old", filename = "map.png", mediaType = "image/png", byteSize = png.size.toLong())
        `when`(images.findById(image.id)).thenReturn(Optional.of(image))
        `when`(storage.read(image.objectKey)).thenReturn(AttachmentObjectResult(png))
        `when`(episodeService.read("work", "owner", 1)).thenReturn(WritingEpisode(1, Draft(body = "기준[[image:${image.id}]]"), emptyList(), null, true, null))
        assertArrayEquals(png, service.downloadEpisodeImage("work", 1, image.id, "owner", false).bytes)
        assertEquals("IMAGE_INHERITED", assertThrows(AttachmentFailure::class.java) {
            service.createEpisodeImage("work", 1, "owner", request())
        }.code)
        `when`(episodeService.read("work", "owner", 1)).thenReturn(WritingEpisode(1, Draft(body = "새 본문"), emptyList(), null, true, null))
        assertEquals("IMAGE_NOT_FOUND", assertThrows(AttachmentFailure::class.java) {
            service.downloadEpisodeImage("work", 1, image.id, "owner", false)
        }.code)
        verify(storage, times(1)).read(image.objectKey)
        verify(storage, never()).upload(anyString(), any(AttachmentObjectPayload::class.java) ?: AttachmentObjectPayload(ByteArray(0), ""))
    }

    @Test fun `public image access requires exact published episode references and cover publication access`() {
        val image = ContentImage(workId = "work", episodeNo = 1, objectKey = "episode-images/old", byteSize = png.size.toLong())
        `when`(images.findById(image.id)).thenReturn(Optional.of(image))
        `when`(storage.read(image.objectKey)).thenReturn(AttachmentObjectResult(png))
        `when`(content.publicRead("work")).thenReturn(WorkResponse("work", "공개 작품", "", "public", false, false, null,
            listOf(Episode(1, 1, "version", "1화", "공개[[image:${image.id}]]")), null))
        assertArrayEquals(png, service.downloadEpisodeImage("work", 1, image.id, null, true).bytes)
        assertEquals("IMAGE_NOT_FOUND", assertThrows(AttachmentFailure::class.java) {
            service.downloadEpisodeImage("work", 2, image.id, null, true)
        }.code)
        assertEquals("IMAGE_NOT_FOUND", assertThrows(AttachmentFailure::class.java) {
            service.downloadEpisodeImage("work", 1, "unpublished", null, true)
        }.code)
        val cover = ContentImage(workId = "work", objectKey = "work-covers/old", byteSize = png.size.toLong())
        `when`(images.findByWorkIdAndEpisodeNo("work", 0)).thenReturn(listOf(cover))
        `when`(storage.read(cover.objectKey)).thenReturn(AttachmentObjectResult(png))
        val downloaded = service.downloadCover("work", null, true)
        assertArrayEquals(png, downloaded.bytes)
        assertEquals("/api/v1/works/work/cover/content", downloaded.attachment.url)
        verify(content, times(4)).publicRead("work")
        verifyNoInteractions(works)
    }

    @Test fun `setting delete restores old bytes on ambiguous failure and reports failed recovery`() {
        val attachment = SettingAttachment(id = "attachment", settingDocumentId = "document", objectKey = "setting-attachments/old", mediaType = "image/png", byteSize = png.size.toLong())
        `when`(attachments.findByIdAndSettingDocumentId("attachment", "document")).thenReturn(attachment)
        `when`(storage.read(attachment.objectKey)).thenReturn(AttachmentObjectResult(png))
        doThrow(AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "저장소 실패")).`when`(storage).delete(attachment.objectKey)
        assertEquals("ATTACHMENT_STORAGE_FAILURE", assertThrows(AttachmentFailure::class.java) {
            service.deleteSettingAttachment("work", "setting", "attachment", "owner")
        }.code)
        val backup = ArgumentCaptor.forClass(AttachmentObjectPayload::class.java)
        verify(storage).upload(eq(attachment.objectKey) ?: "", backup.capture() ?: AttachmentObjectPayload(ByteArray(0), ""))
        assertArrayEquals(png, backup.value.bytes)
        doThrow(AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "복원 실패")).`when`(storage)
            .upload(eq(attachment.objectKey) ?: "", any(AttachmentObjectPayload::class.java) ?: AttachmentObjectPayload(ByteArray(0), ""))
        assertEquals("ATTACHMENT_RECOVERY_REQUIRED", assertThrows(AttachmentFailure::class.java) {
            service.deleteSettingAttachment("work", "setting", "attachment", "owner")
        }.code)
    }

    @Test fun `cover replacement and deletion retain superseded objects and episode bytes remain immutable`() {
        val cover = ContentImage(workId = "work", objectKey = "work-covers/old")
        `when`(images.findByWorkIdAndEpisodeNo("work", 0)).thenReturn(listOf(cover))
        assertEquals(cover.id, service.putCover("work", "owner", request()).id)
        assertNotEquals("work-covers/old", cover.objectKey)
        service.deleteCover("work", "owner")
        verify(images).delete(cover)
        verify(storage, never()).delete(anyString())
        assertFalse(AttachmentService::class.java.methods.any { it.name in setOf("replaceEpisodeImage", "deleteEpisodeImage") })
    }
}
