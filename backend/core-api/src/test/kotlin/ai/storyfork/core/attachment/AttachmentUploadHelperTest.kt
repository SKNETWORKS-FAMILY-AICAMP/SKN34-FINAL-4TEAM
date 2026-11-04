package ai.storyfork.core.attachment

import ai.storyfork.core.attachment.domain.AttachmentFailure
import ai.storyfork.core.attachment.helper.AttachmentUploadHelper
import ai.storyfork.core.attachment.service.dto.AttachmentUploadRequest
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockMultipartFile

class AttachmentUploadHelperTest {
    private fun request(name: String, type: String?, bytes: ByteArray) = AttachmentUploadRequest(MockMultipartFile("file", name, type, bytes))
    private fun png(width: Int = 2) = ByteArrayOutputStream().also { ImageIO.write(BufferedImage(width, 2, BufferedImage.TYPE_INT_RGB), "png", it) }.toByteArray()

    @Test fun `supported bytes are validated and classified without trusting MIME alone`() {
        assertEquals("IMAGE", AttachmentUploadHelper.validate(request("map.png", "image/png", png())).kind)
        for ((name, type) in listOf("note.txt" to "text/plain", "note.md" to "text/markdown", "table.csv" to "text/csv")) {
            val result = AttachmentUploadHelper.validate(request(name, type, "일반 UTF-8 본문".toByteArray()))
            assertEquals("FILE", result.kind); assertEquals(type, result.mediaType)
        }
        assertEquals("FILE", AttachmentUploadHelper.validate(request("doc.pdf", "application/pdf", "%PDF-1.7\n%%EOF\n".toByteArray())).kind)
    }

    @Test fun `normal browser MIME aliases and missing types still require validated bytes`() {
        for ((name, mime, expected) in listOf(
            Triple("note.md", "text/x-markdown", "text/markdown"),
            Triple("table.csv", "application/vnd.ms-excel", "text/csv"),
            Triple("note.txt", "", "text/plain"),
            Triple("note.txt", "text/plain; charset=utf-8", "text/plain"),
        )) assertEquals(expected, AttachmentUploadHelper.validate(request(name, mime, "본문".toByteArray())).mediaType)
        assertThrows(AttachmentFailure::class.java) { AttachmentUploadHelper.validate(request("table.csv", "application/vnd.ms-excel", byteArrayOf(0))) }
    }

    @Test fun `unsafe names unsupported active types oversized and invalid image data are rejected`() {
        for (name in listOf("../a.png", "folder/a.png", "folder\\a.png", ".a.png", "a\r\nb.png", "a‮b.png", "a.svg", "a.html", "a.exe")) {
            assertEquals(422, assertThrows(AttachmentFailure::class.java) { AttachmentUploadHelper.validate(request(name, "image/png", png())) }.status, name)
        }
        for (bytes in listOf(ByteArray(0), "<svg/>".toByteArray(), png().copyOf(30), png(4097))) {
            assertEquals(422, assertThrows(AttachmentFailure::class.java) { AttachmentUploadHelper.validate(request("a.png", "image/png", bytes)) }.status)
        }
        for (name in listOf("a.png", "a.txt")) assertEquals(413, assertThrows(AttachmentFailure::class.java) {
            AttachmentUploadHelper.validate(request(name, "application/octet-stream", ByteArray(AttachmentUploadHelper.MAX_BYTES+1)))
        }.status)
        assertThrows(AttachmentFailure::class.java) { AttachmentUploadHelper.validate(request("a.png", "text/plain", png())) }
        assertThrows(AttachmentFailure::class.java) { AttachmentUploadHelper.validate(request("a.txt", "text/plain", byteArrayOf(0))) }
        assertThrows(AttachmentFailure::class.java) { AttachmentUploadHelper.validate(request("a.txt", "text/plain", byteArrayOf(-1))) }
        assertThrows(AttachmentFailure::class.java) { AttachmentUploadHelper.validate(request("a.pdf", "application/pdf", "not PDF".toByteArray())) }
    }
}
