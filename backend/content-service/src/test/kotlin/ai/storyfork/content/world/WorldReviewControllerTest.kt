package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentExceptionHandler
import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.world.controller.WorldReviewController
import ai.storyfork.content.world.controller.WorldStudioExceptionHandler
import ai.storyfork.content.world.service.WorldReviewService
import ai.storyfork.content.world.service.dto.WorldReviewRequest
import ai.storyfork.content.world.service.dto.WorldReviewResponse
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

/** 설정집 검토 컨트롤러의 바인딩: 소유자는 로그인한 회원, 동의는 본문, 응답은 캐시하지 않는다. 서비스는 대역이다. */
class WorldReviewControllerTest {
    private val service = mock(WorldReviewService::class.java)
    private val controller = WorldReviewController(service)
    private val world = UUID.randomUUID()
    private val owner = UUID.randomUUID()
    private val principal = Principal { owner.toString() }

    @Test fun `hands the verified member and the consent flag to the service and never caches the answer`() {
        val result = WorldReviewResponse(3, 2, 2, emptyList(), "gpt-6-luna")
        `when`(service.review(world, owner, true)).thenReturn(result)

        val response = controller.review(world, principal, WorldReviewRequest(true))

        assertEquals(200, response.statusCode.value())
        assertEquals(result, response.body)
        assertEquals("no-store", response.headers.cacheControl)
    }

    @Test fun `a missing body reaches the service as a missing consent`() {
        `when`(service.review(world, owner, null)).thenThrow(ContentFailure(422, "동의해 주세요.", "AI_CONSENT_REQUIRED"))

        assertEquals("AI_CONSENT_REQUIRED", assertThrows<ContentFailure> { controller.review(world, principal, null) }.code)
    }

    @Test fun `the route is the contract path and errors are handled like the other world studio endpoints`() {
        assertEquals(listOf("/api/v1/world-studios/{worldId}/reviews"),
            AnnotatedElementUtils.findMergedAnnotation(WorldReviewController::class.java, RequestMapping::class.java)!!.value.toList())
        val method = WorldReviewController::class.java.methods.first { it.name == "review" }
        assertNotNull(AnnotatedElementUtils.findMergedAnnotation(method, PostMapping::class.java))
        // 소유자 404(WorldNotFound)·관계 저장소 오류는 소유자 쪽 처리기가, 동의·AI 실패(ContentFailure)는 콘텐츠 처리기가 맡는다.
        assertTrue(WorldReviewController::class in AnnotatedElementUtils.findMergedAnnotation(WorldStudioExceptionHandler::class.java, RestControllerAdvice::class.java)!!.assignableTypes)
        assertTrue(WorldReviewController::class.java.packageName in AnnotatedElementUtils.findMergedAnnotation(ContentExceptionHandler::class.java, RestControllerAdvice::class.java)!!.basePackages)
    }
}
