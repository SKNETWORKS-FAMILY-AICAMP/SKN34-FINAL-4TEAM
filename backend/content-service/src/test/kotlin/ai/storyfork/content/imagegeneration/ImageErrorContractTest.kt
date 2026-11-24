package ai.storyfork.content.imagegeneration

import ai.storyfork.content._common.exception.ContentExceptionHandler
import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.imagegeneration.controller.ImageJobController
import ai.storyfork.content.imagegeneration.controller.ImageJobInternalController
import ai.storyfork.content.world.controller.WorldStudioExceptionHandler
import ai.storyfork.content.world.domain.WorldNotFound
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.support.StaticListableBeanFactory
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.ControllerAdvice
import org.springframework.web.method.ControllerAdviceBean
import org.springframework.web.method.annotation.ExceptionHandlerMethodResolver

/** HTTP 서버 없이 실제 Spring advice 선택 규칙과 오류 응답을 검사한다. */
class ImageErrorContractTest {
    private fun assertHandled(handler: Any, error: Exception, status: Int) {
        val factory = StaticListableBeanFactory(mapOf("handler" to handler))
        val annotation = requireNotNull(AnnotatedElementUtils.findMergedAnnotation(handler.javaClass, ControllerAdvice::class.java))
        val advice = ControllerAdviceBean("handler", factory, annotation)
        for (controller in listOf(ImageJobController::class.java, ImageJobInternalController::class.java)) {
            assertTrue(advice.isApplicableToBeanType(controller), "${handler.javaClass.simpleName} must cover ${controller.simpleName}")
        }
        val method = requireNotNull(ExceptionHandlerMethodResolver(handler.javaClass).resolveMethod(error))
        val response = (if (method.parameterCount == 0) method.invoke(handler) else method.invoke(handler, error)) as ResponseEntity<*>
        assertEquals(status, response.statusCode.value())
    }

    @Test fun `request conflicts and owner lookup failures keep their public status`() {
        for (status in listOf(404, 409, 410, 422)) {
            assertHandled(ContentExceptionHandler(), ContentFailure(status, "이미지 작업 오류"), status)
        }
    }

    @Test fun `storage failures are reported as unavailable`() {
        assertHandled(ContentExceptionHandler(), AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "저장소 오류"), 503)
    }

    @Test fun `an inaccessible world remains not found`() {
        assertHandled(WorldStudioExceptionHandler(), WorldNotFound(), 404)
    }
}
