package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.world.domain.WORLD_COVER_MAX_BYTES
import ai.storyfork.content.world.domain.coverStorage
import ai.storyfork.content.world.domain.worldCoverFile
import ai.storyfork.content.world.domain.worldCoverType
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockMultipartFile

/** 세계관 표지 업로드의 순수 검증(형식·크기·바이트 시그니처). Spring·DB·저장소 없이 돈다. */
class WorldCoverRulesTest {
    private fun image(format: String): ByteArray =
        ByteArrayOutputStream().also { ImageIO.write(BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), format, it) }.toByteArray()

    private fun le(value: Int) = byteArrayOf(value.toByte(), (value shr 8).toByte(), (value shr 16).toByte(), (value shr 24).toByte())

    /** RIFF 컨테이너 구조만 맞춘 WebP다. JDK가 WebP를 못 읽어 디코딩 대신 구조(시그니처·크기·첫 chunk)만 검사한다. */
    private fun webp(chunk: String = "VP8L", payload: ByteArray = ByteArray(10), form: String = "WEBP", declared: Int? = null): ByteArray {
        val body = form.toByteArray() + chunk.toByteArray() + le(payload.size) + payload
        return "RIFF".toByteArray() + le(declared ?: body.size) + body
    }

    private fun assertInvalid(bytes: ByteArray) {
        val failure = assertThrows(ContentFailure::class.java) { worldCoverType(bytes) }
        assertEquals(422, failure.status)
        assertEquals("WORLD_INPUT_INVALID", failure.code)
    }

    @Test fun `png jpeg and webp are told apart by their bytes`() {
        assertEquals("image/png", worldCoverType(image("png")))
        assertEquals("image/jpeg", worldCoverType(image("jpeg")))
        listOf("VP8 ", "VP8L", "VP8X").forEach { assertEquals("image/webp", worldCoverType(webp(it))) }
    }

    @Test fun `empty, oversized and unknown signatures are a 422 input error`() {
        assertInvalid(ByteArray(0))
        assertInvalid(ByteArray(WORLD_COVER_MAX_BYTES + 1))
        listOf("GIF89a\u0001\u0000\u0001\u0000", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", "%PDF-1.7\n%%EOF", "그냥 글자").forEach {
            assertInvalid(it.toByteArray())
        }
    }

    @Test fun `a png or jpeg signature is not enough, the body must decode like an attachment image`() {
        val png = image("png")
        assertInvalid(png.copyOf(png.size - 1).also { it[it.size - 1] = 0 })
        assertInvalid(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10) + ByteArray(40))
        assertInvalid(byteArrayOf(-1, -40, -1) + ByteArray(20))
        assertInvalid(image("jpeg").let { it.copyOf(it.size / 2) })
    }

    @Test fun `a webp must be a well formed riff container`() {
        val riff = webp().size - 8                        // 올바른 RIFF 크기(전체 − 8)
        assertInvalid(webp(declared = riff - 8))          // 실제보다 작다(뒤에 남는 바이트)
        assertInvalid(webp(declared = riff + 2))          // 실제보다 크다(잘린 파일)
        assertInvalid(webp() + byteArrayOf(0, 0))         // 뒤에 덧붙은 바이트
        assertInvalid(webp(chunk = "JUNK"))
        assertInvalid(webp(form = "WAVE"))
        assertInvalid("RIFF".toByteArray())
    }

    @Test fun `the multipart file is read by its bytes and the sent name and content type are ignored`() {
        val file = worldCoverFile(MockMultipartFile("file", "cover.txt", "text/plain", image("png")))
        assertEquals("image/png", file.contentType)
        assertArrayEquals(image("png"), file.bytes)
    }

    @Test fun `a missing or oversized multipart file is a 422 before the bytes are read`() {
        listOf(null, MockMultipartFile("file", "cover.png", "image/png", ByteArray(WORLD_COVER_MAX_BYTES + 1))).forEach {
            val failure = assertThrows(ContentFailure::class.java) { worldCoverFile(it) }
            assertEquals(422, failure.status)
            assertEquals("WORLD_INPUT_INVALID", failure.code)
        }
    }

    @Test fun `storage failures keep their safe status and message as a world API failure`() {
        val failure = assertThrows(ContentFailure::class.java) {
            coverStorage { throw AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "첨부 저장소 요청을 완료하지 못했어요. 다시 시도해 주세요.") }
        }
        assertEquals(503, failure.status)
        assertEquals("첨부 저장소 요청을 완료하지 못했어요. 다시 시도해 주세요.", failure.message)
        assertEquals("ATTACHMENT_STORAGE_FAILURE", failure.code)
        assertEquals("값", coverStorage { "값" })
    }
}
