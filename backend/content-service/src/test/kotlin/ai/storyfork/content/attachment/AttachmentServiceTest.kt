package ai.storyfork.content.attachment

import ai.storyfork.content.attachment.controller.AttachmentExceptionHandler
import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.attachment.service.dto.AttachmentRenameRequest
import ai.storyfork.content.attachment.service.dto.EpisodeImageAltTextRequest
import ai.storyfork.content.attachment.service.dto.EpisodeImageListResponse
import ai.storyfork.content.attachment.service.dto.PublicEpisodeImageListResponse
import ai.storyfork.content.attachment.service.dto.PublicEpisodeImageResponse
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
import ai.storyfork.content.attachment.helper.AttachmentUploadHelper
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
        AttachmentUploadHelper.validate(MockMultipartFile("file", name, type, bytes))

    @BeforeEach fun repositories() {
        `when`(manager.getTransaction(any())).thenReturn(SimpleTransactionStatus())
        `when`(settings.lockOwnedLocal("work", "setting", "owner")).thenReturn(AttachmentSetting(id = "document"))
        `when`(works.lockOwned("work", "owner")).thenReturn(ImageWork(id = "work", ownerId = "owner"))
        `when`(attachments.saveAndFlush(any(SettingAttachment::class.java) ?: SettingAttachment())).thenAnswer { it.arguments[0] }
        `when`(images.saveAndFlush(any(ContentImage::class.java) ?: ContentImage())).thenAnswer { it.arguments[0] }
        `when`(episodeService.read("work", "owner", 1)).thenReturn(WritingEpisode(1, Draft(), emptyList(), null, false, null))
        `when`(imageEpisodes.existsByWorkIdAndSequence("work",1)).thenReturn(true)
    }

    @Test fun `setting attachments of a soft deleted work are not found`() {
        `when`(works.lockOwned("work", "owner")).thenReturn(ImageWork(id = "work", ownerId = "owner", deletedAt = java.time.Instant.now()))
        assertEquals("ATTACHMENT_NOT_FOUND", assertThrows(AttachmentFailure::class.java) { service.requireSettingUploadAccess("work", "setting", "owner") }.code)
        verify(settings, never()).lockOwnedLocal("work", "setting", "owner")
    }

    @Test fun `upload access is checked with the existing ownership rules before any file is read`() {
        service.requireSettingUploadAccess("work", "setting", "owner")
        service.requireWorkUploadAccess("work", "owner")
        fun failure(code: String, action: () -> Any?) { assertEquals(code, assertThrows(AttachmentFailure::class.java) { action() }.code) }
        failure("ATTACHMENT_NOT_FOUND") { service.requireSettingUploadAccess("work", "setting", "stranger") }
        failure("IMAGE_NOT_FOUND") { service.requireWorkUploadAccess("work", "stranger") }
        failure("ATTACHMENT_UNAUTHENTICATED") { service.requireSettingUploadAccess("work", "setting", "") }
        failure("IMAGE_UNAUTHENTICATED") { service.requireWorkUploadAccess("work", "") }
        verifyNoInteractions(storage)
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
        // 설정 첨부도 삭제 여부를 보려고 작품 행을 잠근다(설정·표지·회차 이미지 각 1회).
        verify(works, times(3)).lockOwned("work", "owner")
        verify(episodeService).read("work", "owner", 1)
        verify(storage, never()).delete(anyString())
    }

    @Test fun `the owner cannot read or replace the cover of a soft deleted work`() {
        `when`(works.lockOwned("work", "owner")).thenReturn(ImageWork(id = "work", ownerId = "owner", deletedAt = java.time.Instant.now()))
        assertEquals("IMAGE_NOT_FOUND", assertThrows(AttachmentFailure::class.java) { service.readCover("work", "owner") }.code)
        assertEquals("IMAGE_NOT_FOUND", assertThrows(AttachmentFailure::class.java) { service.requireWorkUploadAccess("work", "owner") }.code)
        verifyNoInteractions(images, storage)
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

    @Test fun `episode upload access checks the episode before the file is read`() {
        `when`(episodeService.read("work", "owner", 1)).thenReturn(WritingEpisode(1, Draft(), emptyList(), null, true, null))
        assertEquals(403, assertThrows(AttachmentFailure::class.java) { service.requireEpisodeUploadAccess("work", 1, "owner") }.status)
        `when`(episodeService.read("work", "owner", 2)).thenReturn(WritingEpisode(2, Draft(), emptyList(), null, false, null))
        service.requireEpisodeUploadAccess("work", 2, "owner")
        verify(episodeService).read("work", "owner", 2)
    }

    @Test fun `inherited episode images use frozen body references and cannot be created`() {
        val image = ContentImage(workId = "original", episodeNo = 1, objectKey = "episode-images/old", filename = "map.png", mediaType = "image/png", byteSize = png.size.toLong())
        `when`(images.findById(image.id)).thenReturn(Optional.of(image))
        `when`(episodeService.permitsImageReference("work", 1, image)).thenReturn(true)
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
        `when`(episodeService.permitsImageReference("work", 1, image)).thenReturn(true)
        `when`(storage.read(image.objectKey)).thenReturn(AttachmentObjectResult(png))
        `when`(content.publicEpisodes("work")).thenReturn(listOf(Episode(1, 1, "version", "1화", "공개[[image:${image.id}]]")))
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
        // 표지·이미지 공개 열람은 작가명 조회(WorkService.publicRead)가 아니라 이름 없는 공개 회차 확인만 쓴다.
        verify(content, times(4)).publicEpisodes("work")
        verify(content, never()).publicRead("work")
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

    private fun stored(filename: String = "map.png") = SettingAttachment(id = "attachment", settingDocumentId = "document", objectKey = "setting-attachments/old",
        filename = filename, mediaType = "image/png", kind = "IMAGE", byteSize = png.size.toLong())
        .also { `when`(attachments.findByIdAndSettingDocumentId("attachment", "document")).thenReturn(it) }

    @Test fun `setting attachment rename changes only the stored filename and ignores extension case`() {
        val attachment = stored()
        val renamed = service.renameSettingAttachment("work", "setting", "attachment", "owner", AttachmentRenameRequest("지도 최종 (2).PNG"))
        assertEquals("지도 최종 (2).PNG", attachment.filename)
        assertEquals("지도 최종 (2).PNG", renamed.filename)
        assertEquals("attachment", renamed.id); assertEquals("image/png", renamed.mediaType); assertEquals("IMAGE", renamed.kind)
        assertEquals(png.size.toLong(), renamed.byteSize)
        assertEquals("/api/v1/works/work/settings/setting/attachments/attachment/content", renamed.url)
        assertEquals("setting-attachments/old", attachment.objectKey)
        verify(attachments).saveAndFlush(attachment)
        verifyNoInteractions(storage)
    }

    @Test fun `setting attachment rename rejects rule violations and extension changes before saving`() {
        val attachment = stored()
        for (name in listOf(null, "", "map.jpg", "map.jpeg", "map", "map.", ".png", " map.png", "map.png ", "../map.png", "a/b.png", "a..b.png", "m".repeat(117) + ".png")) {
            val failure = assertThrows(AttachmentFailure::class.java) { service.renameSettingAttachment("work", "setting", "attachment", "owner", AttachmentRenameRequest(name)) }
            assertEquals(422, failure.status, name); assertEquals("ATTACHMENT_INVALID", failure.code, name)
        }
        assertEquals("map.png", attachment.filename)
        verify(attachments, never()).saveAndFlush(any(SettingAttachment::class.java) ?: SettingAttachment())
        verifyNoInteractions(storage)
    }

    @Test fun `setting attachment rename keeps ownership and existence checks first`() {
        stored()
        fun failure(status: Int, code: String, owner: String = "owner", id: String = "attachment") = assertThrows(AttachmentFailure::class.java) {
            service.renameSettingAttachment("work", "setting", id, owner, AttachmentRenameRequest("new.png"))
        }.also { assertEquals(status, it.status); assertEquals(code, it.code) }
        failure(404, "ATTACHMENT_NOT_FOUND", owner = "stranger")
        failure(404, "ATTACHMENT_NOT_FOUND", id = "missing")
        failure(401, "ATTACHMENT_UNAUTHENTICATED", owner = "")
        verify(attachments, never()).saveAndFlush(any(SettingAttachment::class.java) ?: SettingAttachment())
    }

    @Test fun `failed import images are discarded only while no draft or saved version references them`() {
        val loose = ContentImage(workId = "work", episodeNo = 1, objectKey = "episode-images/loose")
        val inDraft = ContentImage(workId = "work", episodeNo = 1, objectKey = "episode-images/draft")
        val inVersion = ContentImage(workId = "work", episodeNo = 1, objectKey = "episode-images/version")
        for (image in listOf(loose, inDraft, inVersion)) `when`(images.findById(image.id)).thenReturn(Optional.of(image))
        `when`(episodeService.read("work", "owner", 1)).thenReturn(WritingEpisode(1, Draft(body = "초안[[image:${inDraft.id}]]"),
            listOf(ai.storyfork.content.episode_version.service.dto.VersionResponse("v1", "1화", "저장[[image:${inVersion.id}]]", 1, 1, "2026-11-09T00:00:00Z")), null, false, null))
        for (image in listOf(loose, inDraft, inVersion)) service.discardUnreferencedEpisodeImage("work", 1, image.id, "owner")
        verify(images).delete(loose); verify(images).flush(); verify(storage).delete("episode-images/loose")
        verify(images, never()).delete(inDraft); verify(images, never()).delete(inVersion)
        verify(storage, times(1)).delete(anyString())
    }

    @Test fun `discard ignores missing images and images of another episode or work`() {
        val otherEpisode = ContentImage(workId = "work", episodeNo = 2, objectKey = "episode-images/two")
        val otherWork = ContentImage(workId = "other", episodeNo = 1, objectKey = "episode-images/other")
        for (image in listOf(otherEpisode, otherWork)) `when`(images.findById(image.id)).thenReturn(Optional.of(image))
        for (id in listOf(otherEpisode.id, otherWork.id, "missing")) service.discardUnreferencedEpisodeImage("work", 1, id, "owner")
        verify(images, never()).delete(any(ContentImage::class.java) ?: ContentImage())
        verifyNoInteractions(storage)
    }

    private fun episodeImage(id: String = java.util.UUID.randomUUID().toString(), episode: Int = 1, work: String = "work", alt: String = "") =
        ContentImage(id = id, workId = work, episodeNo = episode, objectKey = "episode-images/$id", filename = "map.png", mediaType = "image/png", byteSize = png.size.toLong(), altText = alt)
            .also { `when`(images.findById(it.id)).thenReturn(Optional.of(it)) }
    private fun draftBody(body: String, inherited: Boolean = false) = `when`(episodeService.read("work", "owner", 1)).thenReturn(WritingEpisode(1, Draft(body = body), emptyList(), null, inherited, null))

    @Test fun `owner image list holds this episode's images in creation order with alt text and body references`() {
        val first = episodeImage(alt = "지도"); val second = episodeImage()
        `when`(images.findAllByWorkIdAndEpisodeNoOrderByCreatedAtAscIdAsc("work", 1)).thenReturn(listOf(first, second))
        draftBody("앞[[image:${first.id}]]뒤")
        val listed = service.listEpisodeImages("work", 1, "owner").images
        assertEquals(listOf(first.id, second.id), listed.map { it.id })
        assertEquals(listOf(true, false), listed.map { it.referenced })
        assertEquals(listOf("지도", ""), listed.map { it.altText })
        assertEquals("/api/v1/works/work/episodes/1/images/${first.id}/content", listed[0].url)
        assertEquals(listOf("map.png", "image/png", png.size.toLong(), first.createdAt), listOf(listed[0].filename, listed[0].mediaType, listed[0].byteSize, listed[0].createdAt))
        verify(images).findAllByWorkIdAndEpisodeNoOrderByCreatedAtAscIdAsc("work", 1)
    }

    @Test fun `inherited episodes list no images and missing episodes keep the content error`() {
        draftBody("기준[[image:abc]]", inherited = true)
        assertTrue(service.listEpisodeImages("work", 1, "owner").images.isEmpty())
        verify(images, never()).findAllByWorkIdAndEpisodeNoOrderByCreatedAtAscIdAsc(anyString(), anyInt())
        `when`(episodeService.read("work", "stranger", 1)).thenThrow(ai.storyfork.content._common.exception.ContentFailure(404, "작품을 찾을 수 없어요."))
        assertEquals(404, assertThrows(ai.storyfork.content._common.exception.ContentFailure::class.java) { service.listEpisodeImages("work", 1, "stranger") }.status)
    }

    @Test fun `alt text is trimmed stored and returned with its body reference`() {
        val image = episodeImage(alt = "예전")
        draftBody("본문[[image:${image.id}]]")
        for ((input, expected) in listOf("  지도 그림  " to "지도 그림", "" to "", "   " to "", "가".repeat(300) to "가".repeat(300))) {
            val updated = service.updateEpisodeImageAltText("work", 1, image.id, "owner", EpisodeImageAltTextRequest(input))
            assertEquals(expected, image.altText); assertEquals(expected, updated.altText)
            assertEquals(listOf(image.id, true, "/api/v1/works/work/episodes/1/images/${image.id}/content"), listOf(updated.id, updated.referenced, updated.url))
        }
        verify(images, times(4)).saveAndFlush(image)
        verifyNoInteractions(storage)
    }

    @Test fun `alt text over 300 characters or with control characters is refused without saving`() {
        val image = episodeImage(alt = "그대로")
        draftBody("")
        val invalid = listOf(null, "가".repeat(301), "a" + Char(0) + "b", "a" + Char(7), "a" + Char(10) + "b", "a" + Char(9) + "b", "a" + Char(0x85) + "b", Char(0).toString())
        for (alt in invalid) {
            val failure = assertThrows(AttachmentFailure::class.java) { service.updateEpisodeImageAltText("work", 1, image.id, "owner", EpisodeImageAltTextRequest(alt)) }
            assertEquals(422, failure.status, alt); assertEquals("IMAGE_INVALID", failure.code, alt)
        }
        assertEquals("그대로", image.altText)
        verify(images, never()).saveAndFlush(any(ContentImage::class.java) ?: ContentImage())
    }

    @Test fun `alt text of another episode another work a missing image or a stranger is a 404`() {
        draftBody("")
        val otherEpisode = episodeImage(episode = 2); val otherWork = episodeImage(work = "other")
        for (id in listOf(otherEpisode.id, otherWork.id, "missing")) {
            val failure = assertThrows(AttachmentFailure::class.java) { service.updateEpisodeImageAltText("work", 1, id, "owner", EpisodeImageAltTextRequest("설명")) }
            assertEquals(404, failure.status); assertEquals("IMAGE_NOT_FOUND", failure.code)
        }
        assertEquals("", otherEpisode.altText); assertEquals("", otherWork.altText)
        `when`(episodeService.read("work", "stranger", 1)).thenThrow(ai.storyfork.content._common.exception.ContentFailure(404, "작품을 찾을 수 없어요."))
        assertEquals(404, assertThrows(ai.storyfork.content._common.exception.ContentFailure::class.java) {
            service.updateEpisodeImageAltText("work", 1, otherEpisode.id, "stranger", EpisodeImageAltTextRequest("설명"))
        }.status)
        verify(images, never()).saveAndFlush(any(ContentImage::class.java) ?: ContentImage())
    }

    @Test fun `public alt texts list only images the published body references and the public rule permits`() {
        val first = episodeImage(alt = "첫째"); val second = episodeImage(alt = "둘째"); val foreign = episodeImage(episode = 2, alt = "남의 것"); val draftOnly = episodeImage(alt = "초안만")
        `when`(episodeService.permitsImageReference("work", 1, first)).thenReturn(true)
        `when`(episodeService.permitsImageReference("work", 1, second)).thenReturn(true)
        `when`(episodeService.permitsImageReference("work", 1, foreign)).thenReturn(false)
        `when`(images.findAllById(listOf(second.id, first.id, foreign.id, "gone"))).thenReturn(listOf(first, foreign, second))
        `when`(content.publicEpisodes("work")).thenReturn(listOf(
            Episode(1, 1, "version", "1화", "앞[[image:${second.id}]]중[[image:${first.id}]]뒤[[image:${second.id}]][[image:${foreign.id}]][[image:gone]]"),
            Episode(2, 1, "version2", "2화", "[[image:${draftOnly.id}]]")))
        val listed = service.publicEpisodeImageAltTexts("work", 1).images
        assertEquals(listOf(second.id to "둘째", first.id to "첫째"), listed.map { it.id to it.altText })
        assertTrue(service.publicEpisodeImageAltTexts("work", 3).images.isEmpty())
        verifyNoInteractions(works)
        `when`(content.publicEpisodes("private")).thenThrow(ai.storyfork.content._common.exception.ContentFailure(404, "공개 작품을 찾을 수 없어요."))
        assertEquals(404, assertThrows(ai.storyfork.content._common.exception.ContentFailure::class.java) { service.publicEpisodeImageAltTexts("private", 1) }.status)
        // 대체 텍스트 공개 조회도 작가명(Core 닉네임) 조회가 필요 없어 publicRead를 부르지 않는다. Core 장애가 공개 이미지 설명을 막지 않는다.
        verify(content, never()).publicRead("work"); verify(content, never()).publicRead("private")
    }

    @Test fun `an uploaded episode image can carry an alt text but an invalid one is refused before any upload`() {
        val withAlt = ArgumentCaptor.forClass(ContentImage::class.java)
        service.createEpisodeImage("work", 1, "owner", request(), "  EPUB 대체 텍스트 ")
        verify(images).saveAndFlush(withAlt.capture() ?: ContentImage())
        assertEquals("EPUB 대체 텍스트", withAlt.value.altText)
        clearInvocations(images)
        val withoutAlt = ArgumentCaptor.forClass(ContentImage::class.java)
        service.createEpisodeImage("work", 1, "owner", request())
        verify(images).saveAndFlush(withoutAlt.capture() ?: ContentImage())
        assertEquals("", withoutAlt.value.altText)
        clearInvocations(storage)
        for (alt in listOf("a" + Char(0), "가".repeat(301))) {
            assertEquals("IMAGE_INVALID", assertThrows(AttachmentFailure::class.java) { service.createEpisodeImage("work", 1, "owner", request(), alt) }.code)
        }
        verifyNoInteractions(storage)
    }

    @Test fun `image list and public alt text responses keep the contract field names`() {
        val mapper = tools.jackson.databind.json.JsonMapper.builder().findAndAddModules().build()
        val one = ai.storyfork.content.attachment.service.dto.EpisodeImageResponse("id", "map.png", "image/png", 3, "설명", java.time.Instant.parse("2026-11-09T00:00:00Z"), "/u", true)
        val list = mapper.readTree(mapper.writeValueAsString(EpisodeImageListResponse(listOf(one))))
        assertEquals(setOf("images"), list.propertyNames().toSet())
        assertEquals(setOf("id", "filename", "mediaType", "byteSize", "altText", "createdAt", "url", "referenced"), list.path("images").get(0).propertyNames().toSet())
        val public = mapper.readTree(mapper.writeValueAsString(PublicEpisodeImageListResponse(listOf(PublicEpisodeImageResponse("id", "설명")))))
        assertEquals(setOf("id", "altText"), public.path("images").get(0).propertyNames().toSet())
    }

    @Test fun `unreadable rename body is reported as an invalid attachment input`() {
        val unreadable = org.springframework.http.converter.HttpMessageNotReadableException("bad json", mock(org.springframework.http.HttpInputMessage::class.java))
        assertEquals("invalid", org.springframework.web.method.annotation.ExceptionHandlerMethodResolver(AttachmentExceptionHandler::class.java).resolveMethodByThrowable(unreadable)?.name)
        val response = AttachmentExceptionHandler().invalid()
        assertEquals(422, response.statusCode.value())
        assertEquals("ATTACHMENT_INVALID", response.body?.code)
    }
}
