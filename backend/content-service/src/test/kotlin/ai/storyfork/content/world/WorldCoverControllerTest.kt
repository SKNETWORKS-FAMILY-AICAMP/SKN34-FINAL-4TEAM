package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentExceptionHandler
import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.world.controller.PublicWorldController
import ai.storyfork.content.world.controller.WorldStudioController
import ai.storyfork.content.world.controller.WorldStudioExceptionHandler
import ai.storyfork.content.world.domain.WorldCoverFile
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.WorldCoverService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.WorldCoverImage
import ai.storyfork.content.world.service.dto.WorldCoverResponse
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

/** 세계관 표지 컨트롤러의 바인딩: 소유자는 로그인한 회원으로, 응답은 캐시하지 않는 이미지로 나간다. 서비스는 대역이다. */
class WorldCoverControllerTest {
    private val covers = mock(WorldCoverService::class.java)
    private val publicWorlds = mock(PublicWorldService::class.java)
    private val studios = WorldStudioController(mock(WorldStudioService::class.java), covers, mock(ai.storyfork.content.work.service.WorkWorldService::class.java))
    private val publics = PublicWorldController(publicWorlds)
    private val id = UUID.randomUUID()
    private val owner = UUID.randomUUID()
    private val principal = Principal { owner.toString() }
    private val png = ByteArrayOutputStream().also { ImageIO.write(BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "png", it) }.toByteArray()

    @Test fun `put hands the owner and the checked bytes with their real type to the service`() {
        doReturn(WorldCoverResponse(id, true)).`when`(covers).put(eq(id) ?: id, eq(owner) ?: owner, any(WorldCoverFile::class.java) ?: WorldCoverFile(ByteArray(0), ""))
        val result = studios.putCover(id, principal, MockMultipartFile("file", "cover.txt", "text/plain", png))
        assertEquals(WorldCoverResponse(id, true), result)
        val file = ArgumentCaptor.forClass(WorldCoverFile::class.java)
        verify(covers).put(eq(id) ?: id, eq(owner) ?: owner, file.capture() ?: WorldCoverFile(ByteArray(0), ""))
        assertEquals("image/png", file.value.contentType)
        assertArrayEquals(png, file.value.bytes)
    }

    @Test fun `a missing or broken file is a 422 before the service sees the request`() {
        listOf(null, MockMultipartFile("file", "cover.png", "image/png", byteArrayOf(1, 2))).forEach {
            val failure = assertThrows(ContentFailure::class.java) { studios.putCover(id, principal, it) }
            assertEquals(422, failure.status)
            assertEquals("WORLD_INPUT_INVALID", failure.code)
        }
        verifyNoInteractions(covers)
    }

    @Test fun `delete answers 204 and the owner read is an uncached image with the stored type`() {
        val bytes = byteArrayOf(9, 8, 7)
        `when`(covers.read(id, owner)).thenReturn(WorldCoverImage(bytes, "image/webp"))
        val response = studios.readCover(id, principal)
        assertEquals(200, response.statusCode.value())
        assertArrayEquals(bytes, response.body)
        assertEquals("image/webp", response.headers.getFirst(HttpHeaders.CONTENT_TYPE))
        assertEquals(3L, response.headers.contentLength)
        assertEquals("private, no-store", response.headers.cacheControl)
        assertEquals("nosniff", response.headers.getFirst("X-Content-Type-Options"))
        assertEquals(204, studios.deleteCover(id, principal).statusCode.value())
        verify(covers).delete(id, owner)
    }

    @Test fun `the public read is the same uncached image`() {
        `when`(publicWorlds.cover(id)).thenReturn(WorldCoverImage(png, "image/png"))
        val response = publics.cover(id)
        assertEquals("image/png", response.headers.getFirst(HttpHeaders.CONTENT_TYPE))
        assertEquals("private, no-store", response.headers.cacheControl)
        assertEquals("nosniff", response.headers.getFirst("X-Content-Type-Options"))
        assertArrayEquals(png, response.body)
    }

    @Test fun `routes are the contract paths and each controller keeps its own error body`() {
        fun method(type: Class<*>, name: String) = type.methods.first { it.name == name }
        val put = AnnotatedElementUtils.findMergedAnnotation(method(WorldStudioController::class.java, "putCover"), PutMapping::class.java)!!
        assertEquals(listOf("/{id}/cover"), put.value.toList())
        assertEquals(listOf("multipart/form-data"), put.consumes.toList())
        assertEquals(listOf("/{id}/cover"), AnnotatedElementUtils.findMergedAnnotation(method(WorldStudioController::class.java, "deleteCover"), DeleteMapping::class.java)!!.value.toList())
        assertEquals(listOf("/{id}/cover"), AnnotatedElementUtils.findMergedAnnotation(method(WorldStudioController::class.java, "readCover"), GetMapping::class.java)!!.value.toList())
        assertEquals(listOf("/{id}/cover"), AnnotatedElementUtils.findMergedAnnotation(method(PublicWorldController::class.java, "cover"), GetMapping::class.java)!!.value.toList())
        assertEquals(listOf("/api/v1/world-studios"), AnnotatedElementUtils.findMergedAnnotation(WorldStudioController::class.java, RequestMapping::class.java)!!.value.toList())
        assertEquals(listOf("/api/v1/public/world-studios"), AnnotatedElementUtils.findMergedAnnotation(PublicWorldController::class.java, RequestMapping::class.java)!!.value.toList())
        // 소유자 쪽은 WorldNotFound→404 WORLD_NOT_FOUND, 공개 쪽은 ContentFailure {detail}이다.
        assertTrue(WorldStudioController::class in AnnotatedElementUtils.findMergedAnnotation(WorldStudioExceptionHandler::class.java, RestControllerAdvice::class.java)!!.assignableTypes)
        assertFalse(PublicWorldController::class in AnnotatedElementUtils.findMergedAnnotation(WorldStudioExceptionHandler::class.java, RestControllerAdvice::class.java)!!.assignableTypes)
        assertTrue("ai.storyfork.content.world.controller" in AnnotatedElementUtils.findMergedAnnotation(ContentExceptionHandler::class.java, RestControllerAdvice::class.java)!!.basePackages)
    }
}
