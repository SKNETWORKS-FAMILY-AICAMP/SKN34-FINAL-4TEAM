package ai.storyfork.content.attachment.controller

import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.service.dto.AttachmentErrorResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice

@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = [SettingAttachmentController::class, WorkCoverController::class, EpisodeImageController::class])
class AttachmentExceptionHandler {
    @ExceptionHandler(AttachmentFailure::class)
    fun failure(e: AttachmentFailure) = ResponseEntity.status(e.status).body(AttachmentErrorResponse(e.code, e.message))
    @ExceptionHandler(ai.storyfork.content._common.exception.ContentFailure::class)
    fun content(e: ai.storyfork.content._common.exception.ContentFailure) = ResponseEntity.status(e.status).body(AttachmentErrorResponse("IMAGE_ACCESS_FAILURE", e.message))
    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun invalid() = ResponseEntity.unprocessableContent().body(AttachmentErrorResponse("ATTACHMENT_INVALID", "파일 입력을 확인해 주세요."))
}
