package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.work.controller.WorkWorldController
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.controller.PublicWorldController
import ai.storyfork.content.world.controller.WorldStudioController
import ai.storyfork.content.world.domain.WorldCoverFile
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.WorldCardImageService
import ai.storyfork.content.world.service.WorldCoverService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.WorldCardImageResponse
import ai.storyfork.content.world.service.dto.WorldCoverImage
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.security.Principal
import java.util.UUID
import javax.imageio.ImageIO
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.*
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.http.HttpHeaders
import org.springframework.mock.web.MockMultipartFile
import org.springframework.web.bind.annotation.*

/** 설정 카드 이미지 컨트롤러의 바인딩(#401): 소유자는 로그인한 회원으로, 읽기 응답은 표지와 같이 캐시하지 않는 이미지로 나간다. 서비스는 대역이다. */
class WorldCardImageControllerTest {
    private val cardImages = mock(WorldCardImageService::class.java)
    private val publicWorlds = mock(PublicWorldService::class.java)
    private val links = mock(WorkWorldService::class.java)
    private val studios = WorldStudioController(mock(WorldStudioService::class.java), mock(WorldCoverService::class.java), links, cardImages)
    private val publics = PublicWorldController(publicWorlds)
    private val readers = WorkWorldController(links)
    private val id = UUID.randomUUID()
    private val image = UUID.randomUUID()
    private val owner = UUID.randomUUID()
    private val principal = Principal { owner.toString() }
    private val png = ByteArrayOutputStream().also { ImageIO.write(BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "png", it) }.toByteArray()

    @Test fun `upload answers 201 with the new image id and hands the owner and the checked bytes with their real type to the service`() {
        val body = WorldCardImageResponse(image, "image/png")
        doReturn(body).`when`(cardImages).put(eq(id) ?: id, eq(owner) ?: owner, any(WorldCoverFile::class.java) ?: WorldCoverFile(ByteArray(0), ""))
        val response = studios.uploadCardImage(id, principal, MockMultipartFile("file", "portrait.txt", "text/plain", png))
        assertEquals(201, response.statusCode.value())
        assertEquals(body, response.body)
        val file = ArgumentCaptor.forClass(WorldCoverFile::class.java)
        verify(cardImages).put(eq(id) ?: id, eq(owner) ?: owner, file.capture() ?: WorldCoverFile(ByteArray(0), ""))
        assertEquals("image/png", file.value.contentType)
        assertArrayEquals(png, file.value.bytes)
    }

    @Test fun `a missing or broken file is a 422 before the service sees the request`() {
        listOf(null, MockMultipartFile("file", "portrait.png", "image/png", byteArrayOf(1, 2))).forEach {
            val failure = assertThrows(ContentFailure::class.java) { studios.uploadCardImage(id, principal, it) }
            assertEquals(422, failure.status)
            assertEquals("WORLD_INPUT_INVALID", failure.code)
        }
        verifyNoInteractions(cardImages)
    }

    private fun assertUncachedImage(response: org.springframework.http.ResponseEntity<ByteArray>, type: String, bytes: ByteArray) {
        assertEquals(200, response.statusCode.value())
        assertArrayEquals(bytes, response.body)
        assertEquals(type, response.headers.getFirst(HttpHeaders.CONTENT_TYPE))
        assertEquals(bytes.size.toLong(), response.headers.contentLength)
        assertEquals("private, no-store", response.headers.cacheControl)
        assertEquals("nosniff", response.headers.getFirst("X-Content-Type-Options"))
    }

    @Test fun `the owner read and both public reads are uncached images with the stored type`() {
        val bytes = byteArrayOf(9, 8, 7)
        `when`(cardImages.read(id, owner, image)).thenReturn(WorldCoverImage(bytes, "image/webp"))
        `when`(publicWorlds.cardImage(id, image)).thenReturn(WorldCoverImage(png, "image/png"))
        `when`(links.readerCardImage("work", image, "3")).thenReturn(WorldCoverImage(bytes, "image/jpeg"))
        assertUncachedImage(studios.readCardImage(id, image, principal), "image/webp", bytes)
        assertUncachedImage(publics.cardImage(id, image), "image/png", png)
        assertUncachedImage(readers.readerCardImage("work", image, "3"), "image/jpeg", bytes)
    }

    @Test fun `routes are the contract paths`() {
        fun method(type: Class<*>, name: String) = type.methods.first { it.name == name }
        val upload = AnnotatedElementUtils.findMergedAnnotation(method(WorldStudioController::class.java, "uploadCardImage"), PostMapping::class.java)!!
        assertEquals(listOf("/{id}/card-images"), upload.value.toList())
        assertEquals(listOf("multipart/form-data"), upload.consumes.toList())
        assertEquals(listOf("/{id}/card-images/{imageId}"), AnnotatedElementUtils.findMergedAnnotation(method(WorldStudioController::class.java, "readCardImage"), GetMapping::class.java)!!.value.toList())
        assertEquals(listOf("/{id}/card-images/{imageId}"), AnnotatedElementUtils.findMergedAnnotation(method(PublicWorldController::class.java, "cardImage"), GetMapping::class.java)!!.value.toList())
        assertEquals(listOf("/public/works/{id}/world-card-images/{imageId}"), AnnotatedElementUtils.findMergedAnnotation(method(WorkWorldController::class.java, "readerCardImage"), GetMapping::class.java)!!.value.toList())
        assertEquals(listOf("/api/v1/world-studios"), AnnotatedElementUtils.findMergedAnnotation(WorldStudioController::class.java, RequestMapping::class.java)!!.value.toList())
        assertEquals(listOf("/api/v1/public/world-studios"), AnnotatedElementUtils.findMergedAnnotation(PublicWorldController::class.java, RequestMapping::class.java)!!.value.toList())
        assertEquals(listOf("/api/v1"), AnnotatedElementUtils.findMergedAnnotation(WorkWorldController::class.java, RequestMapping::class.java)!!.value.toList())
    }
}
