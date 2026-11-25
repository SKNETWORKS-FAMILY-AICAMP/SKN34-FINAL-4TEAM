package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentExceptionHandler
import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.world.controller.WorldDocFillController
import ai.storyfork.content.world.controller.WorldStudioExceptionHandler
import ai.storyfork.content.world.service.WorldDocFillService
import ai.storyfork.content.world.service.dto.WorldDocFillResponse
import ai.storyfork.content.world.service.dto.WorldReviewRequest
import java.security.Principal
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.mockito.Mockito.*
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestControllerAdvice

/** 인물 문서 채우기 컨트롤러의 바인딩: 소유자는 로그인한 회원, 동의는 본문, 응답은 캐시하지 않는다. 서비스는 대역이다. */
class WorldDocFillControllerTest {
    private val service = mock(WorldDocFillService::class.java)
    private val controller = WorldDocFillController(service)
    private val world = UUID.randomUUID()
    private val card = UUID.randomUUID()
    private val owner = UUID.randomUUID()
    private val principal = Principal { owner.toString() }
    private val result = WorldDocFillResponse(emptyList(), 0, "gpt-6-luna")

    @Test fun `hands the verified member, the card and the consent flag to the service and never caches the answer`() {
        `when`(service.fill(world, card, owner, true)).thenReturn(result)

        val response = controller.fill(world, card, principal, WorldReviewRequest(true))

        assertEquals(200, response.statusCode.value())
        assertEquals(result, response.body)
        assertEquals("no-store", response.headers.cacheControl)
    }

    @Test fun `a missing body reaches the service as a missing consent`() {
        `when`(service.fill(world, card, owner, null)).thenThrow(ContentFailure(422, "동의해 주세요.", "AI_CONSENT_REQUIRED"))

        assertEquals("AI_CONSENT_REQUIRED", assertThrows<ContentFailure> { controller.fill(world, card, principal, null) }.code)
    }

    @Test fun `the route is the contract path and errors are handled like the other world studio endpoints`() {
        assertEquals(listOf("/api/v1/world-studios/{worldId}/cards/{cardId}/doc-suggestions"),
            AnnotatedElementUtils.findMergedAnnotation(WorldDocFillController::class.java, RequestMapping::class.java)!!.value.toList())
        val method = WorldDocFillController::class.java.methods.first { it.name == "fill" }
        assertNotNull(AnnotatedElementUtils.findMergedAnnotation(method, PostMapping::class.java))
        // 소유자 404(WorldNotFound)는 소유자 쪽 처리기가, 동의·AI 실패(ContentFailure)는 콘텐츠 처리기가 맡는다.
        assertTrue(WorldDocFillController::class in AnnotatedElementUtils.findMergedAnnotation(WorldStudioExceptionHandler::class.java, RestControllerAdvice::class.java)!!.assignableTypes)
        assertTrue(WorldDocFillController::class.java.packageName in AnnotatedElementUtils.findMergedAnnotation(ContentExceptionHandler::class.java, RestControllerAdvice::class.java)!!.basePackages)
    }
}
