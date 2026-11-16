package ai.storyfork.content.manuscript

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.attachment.service.dto.AttachmentDownloadResult
import ai.storyfork.content.attachment.service.dto.AttachmentResponse
import ai.storyfork.content.attachment.service.dto.EpisodeImageListResponse
import ai.storyfork.content.attachment.service.dto.EpisodeImageResponse
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.DraftResponse
import ai.storyfork.content.episode.service.dto.EpisodeListResponse
import ai.storyfork.content.episode.service.dto.EpisodeResponse
import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.manuscript.domain.EpubManuscript
import ai.storyfork.content.manuscript.domain.IMAGE_PLACEHOLDER
import ai.storyfork.content.manuscript.service.ManuscriptExportService
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.anyInt
import org.mockito.ArgumentMatchers.anyString
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.*

class ManuscriptExportServiceTest {
    private val access = mock(WorkAccessService::class.java)
    private val episodes = mock(EpisodeService::class.java)
    private val attachments = mock(AttachmentService::class.java)
    private val service = ManuscriptExportService(access, episodes, attachments)
    private val rows = mutableListOf<EpisodeResponse>()
    private val imageId = "11111111-1111-1111-1111-111111111111"
    private val goneId = "22222222-2222-2222-2222-222222222222"

    private fun str(value: String) = eq(value) ?: value
    private fun row(number: Int, title: String, body: String, inherited: Boolean = false, published: VersionResponse? = null) =
        EpisodeResponse(number, DraftResponse(title, body, 3), listOfNotNull(published), published?.id, inherited, null).also { rows += it }
    private fun version(title: String, body: String) = VersionResponse("version-$title", title, body, 1, 1, "2026-11-09T00:00:00Z")
    private fun txt(result: ai.storyfork.content.manuscript.service.dto.ManuscriptExportResult) = String(result.bytes, 3, result.bytes.size - 3, Charsets.UTF_8)
    private fun failure(action: () -> Any?) = assertThrows(ContentFailure::class.java) { action() }

    @BeforeEach fun wire() {
        `when`(access.own("work", "owner")).thenReturn(WorkAccessResult("work", "owner", "내 소설", "", 0, "world", "private", false, false, null))
        `when`(episodes.list("work", "owner")).thenAnswer { EpisodeListResponse(rows.toList()) }
        `when`(episodes.read(str("work"), str("owner"), anyInt())).thenAnswer { n -> rows.firstOrNull { it.number == n.getArgument<Int>(2) } ?: throw ContentFailure(404, "회차를 찾을 수 없어요.") }
    }

    @Test fun `whole work TXT holds only this work's drafts and starts with the title`() {
        row(1, "원작 1화", "원작 본문", inherited = true); row(2, "2화 시작", "초안 본문[[image:$imageId]]끝"); row(3, "3화", "셋째")
        val result = service.export("work", "owner", "txt", "draft", null)
        assertEquals("text/plain;charset=UTF-8", result.contentType); assertEquals("내 소설.txt", result.filename)
        assertEquals("내 소설\n\n\n2화 시작\n\n초안 본문끝\n\n\n3화\n\n셋째\n", txt(result))
        assertArrayEquals(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()), result.bytes.copyOf(3))
    }

    @Test fun `one episode export names the file after the episode and omits the work title`() {
        row(1, "1화", "본문1"); row(2, "둘째/화: 시작?", "본문2")
        val result = service.export("work", "owner", "txt", "draft", 2)
        assertEquals("둘째_화_ 시작_.txt", result.filename)
        assertEquals("둘째/화: 시작?\n\n본문2\n", txt(result))
    }

    @Test fun `published source uses the published version and skips unpublished episodes`() {
        row(1, "발행 1화(초안 제목)", "고친 초안", published = version("발행 1화", "발행본 본문")); row(2, "미발행", "초안만")
        val result = service.export("work", "owner", "txt", "published", null)
        assertEquals("내 소설\n\n\n발행 1화\n\n발행본 본문\n", txt(result))
        assertEquals("발행 1화\n\n발행본 본문\n", txt(service.export("work", "owner", "txt", "published", 1)))
        assertEquals(422, failure { service.export("work", "owner", "txt", "published", 2) }.status)
    }

    @Test fun `inherited episodes cannot be exported alone and an empty export is refused`() {
        row(1, "원작", "본문", inherited = true)
        assertEquals(403, failure { service.export("work", "owner", "txt", "draft", 1) }.status)
        val empty = failure { service.export("work", "owner", "txt", "draft", null) }
        assertEquals(422, empty.status); assertEquals("내보낼 수 있는 회차가 없어요.", empty.message)
        assertEquals(404, failure { service.export("work", "owner", "txt", "draft", 9) }.status)
        rows.clear()
        assertEquals(422, failure { service.export("work", "owner", "epub", "published", null) }.status)
    }

    @Test fun `format and source are checked after ownership`() {
        row(1, "1화", "본문")
        for ((format, source) in listOf(null to "draft", "pdf" to "draft", "TXT" to "draft", "txt" to null, "txt" to "all", "txt" to "")) {
            assertEquals(422, failure { service.export("work", "owner", format, source, null) }.status, "$format $source")
        }
        `when`(access.own("work", "stranger")).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))
        assertEquals(404, failure { service.export("work", "stranger", "pdf", "all", null) }.status)
    }

    @Test fun `file names replace characters a file cannot hold and never come out empty`() {
        row(1, "a/b\\c:d*e?f\"g<h>i|j", "본문"); row(2, "   ", "본문")
        assertEquals("a_b_c_d_e_f_g_h_i_j.txt", service.export("work", "owner", "txt", "draft", 1).filename)
        assertEquals("원고.epub", service.export("work", "owner", "epub", "draft", 2).filename)
    }

    @Test fun `EPUB carries the chapters with images and alt texts and drops images that cannot be read`() {
        row(1, "그림 회차", "앞\n\n[[image:$imageId]]\n\n[[image:$goneId]]\n\n뒤")
        val png = EpubFixture.png
        `when`(attachments.listEpisodeImages("work", 1, "owner")).thenReturn(EpisodeImageListResponse(listOf(
            EpisodeImageResponse(imageId, "map.png", "image/png", png.size.toLong(), "지도 & <그림>", Instant.now(), "/u", true))))
        `when`(attachments.downloadEpisodeImage("work", 1, imageId, "owner", false)).thenReturn(
            AttachmentDownloadResult(AttachmentResponse(imageId, "map.png", "image/png", "IMAGE", png.size.toLong(), Instant.now(), "/u"), png))
        `when`(attachments.downloadEpisodeImage("work", 1, goneId, "owner", false)).thenThrow(AttachmentFailure(404, "IMAGE_NOT_FOUND", "이미지를 찾을 수 없어요."))
        val result = service.export("work", "owner", "epub", "draft", null)
        assertEquals("application/epub+zip", result.contentType); assertEquals("내 소설.epub", result.filename)
        val book = EpubManuscript.parse(result.bytes)
        val chapter = book.episodes.single()
        assertEquals(listOf("그림 회차", "앞\n$IMAGE_PLACEHOLDER\n뒤"), listOf(chapter.title, chapter.text))
        assertArrayEquals(png, chapter.images.single().bytes); assertEquals("지도 & <그림>", chapter.images.single().altText)
        // 이미지가 없는 회차는 이미지 목록을 조회하지 않는다.
        rows.clear(); row(2, "글만", "본문")
        service.export("work", "owner", "epub", "draft", null)
        verify(attachments, times(1)).listEpisodeImages(anyString(), anyInt(), anyString())
    }
}
