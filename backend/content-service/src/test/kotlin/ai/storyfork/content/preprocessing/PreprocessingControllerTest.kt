package ai.storyfork.content.preprocessing

import ai.storyfork.content._common.exception.ContentExceptionHandler
import ai.storyfork.content.preprocessing.controller.InternalPreprocessingController
import ai.storyfork.content.preprocessing.controller.PreprocessingController
import ai.storyfork.content.preprocessing.service.PreprocessingService
import ai.storyfork.content.preprocessing.service.dto.PreprocessingJobListResponse
import ai.storyfork.content.preprocessing.service.dto.PreprocessingJobResponse
import ai.storyfork.content.preprocessing.service.dto.PreprocessingProgressRequest
import java.security.Principal
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestControllerAdvice

/** 전처리 HTTP 조립(#343): 로그인 회원을 소유자로 넘기고, 계약 경로·상태 코드를 지키며, 오류 변환 범위에 든다. 서비스는 대역이다. */
class PreprocessingControllerTest {
    private val service = mock(PreprocessingService::class.java)
    private val owner = PreprocessingController(service)
    private val internal = InternalPreprocessingController(service)
    private val principal = Principal { "member" }
    private val job = PreprocessingJobResponse("job", "work", "queued", 0, 3, emptyList(), null, null, null)

    @Test fun `start and latest hand the signed-in member to the service as the owner`() {
        `when`(service.start("work", "member")).thenReturn(job)
        `when`(service.latest("work", "member")).thenReturn(job)
        assertSame(job, owner.start("work", principal))
        assertSame(job, owner.latest("work", principal))
    }

    @Test fun `internal list progress and retry pass their inputs through as sent`() {
        val page = PreprocessingJobListResponse(listOf(job), 1)
        val report = PreprocessingProgressRequest("extracting", 1, 3, emptyList(), null)
        `when`(service.list("failed", "1", "50")).thenReturn(page)
        `when`(service.progress("job", report)).thenReturn(job)
        `when`(service.retry("job")).thenReturn(job)
        assertSame(page, internal.list("failed", "1", "50"))
        assertSame(job, internal.progress("job", report))
        assertSame(job, internal.retry("job"))
    }

    @Test fun `routes are the contract paths and the content error handler covers the controller package`() {
        fun route(type: Class<*>, name: String) = type.methods.first { it.name == name }
        assertEquals(listOf("/api/v1"), AnnotatedElementUtils.findMergedAnnotation(PreprocessingController::class.java, RequestMapping::class.java)!!.value.toList())
        assertEquals(listOf("/works/{id}/world-preprocessing"), AnnotatedElementUtils.findMergedAnnotation(route(PreprocessingController::class.java, "start"), PostMapping::class.java)!!.value.toList())
        assertEquals(listOf("/works/{id}/world-preprocessing"), AnnotatedElementUtils.findMergedAnnotation(route(PreprocessingController::class.java, "latest"), GetMapping::class.java)!!.value.toList())
        assertEquals(HttpStatus.ACCEPTED, AnnotatedElementUtils.findMergedAnnotation(route(PreprocessingController::class.java, "start"), ResponseStatus::class.java)!!.value)

        assertEquals(listOf("/internal/v1/preprocessing-jobs"), AnnotatedElementUtils.findMergedAnnotation(InternalPreprocessingController::class.java, RequestMapping::class.java)!!.value.toList())
        assertEquals(listOf<String>(), AnnotatedElementUtils.findMergedAnnotation(route(InternalPreprocessingController::class.java, "list"), GetMapping::class.java)!!.value.toList())
        assertEquals(listOf("/{id}/progress"), AnnotatedElementUtils.findMergedAnnotation(route(InternalPreprocessingController::class.java, "progress"), PostMapping::class.java)!!.value.toList())
        assertEquals(listOf("/{id}/retry"), AnnotatedElementUtils.findMergedAnnotation(route(InternalPreprocessingController::class.java, "retry"), PostMapping::class.java)!!.value.toList())
        assertEquals(HttpStatus.ACCEPTED, AnnotatedElementUtils.findMergedAnnotation(route(InternalPreprocessingController::class.java, "retry"), ResponseStatus::class.java)!!.value)

        val covered = ContentExceptionHandler::class.java.getAnnotation(RestControllerAdvice::class.java).basePackages.toList()
        assertTrue("ai.storyfork.content.preprocessing.controller" in covered, "ContentFailure(404·409·422·502)가 500이 되지 않게 한다")
    }
}
