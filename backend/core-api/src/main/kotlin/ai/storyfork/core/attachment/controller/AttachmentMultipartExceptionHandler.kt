package ai.storyfork.core.attachment.controller

import ai.storyfork.core.attachment.service.dto.AttachmentErrorResponse
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.multipart.MaxUploadSizeExceededException
import org.springframework.web.multipart.MultipartException

/** Controller 매핑 전에 발생하는 multipart 파싱 실패만 안전한 첨부 오류로 변환한다. */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice
@ConditionalOnProperty(name = ["app.content.enabled", "app.setting-attachments.enabled"], havingValue = "true")
class AttachmentMultipartExceptionHandler {
    @ExceptionHandler(MaxUploadSizeExceededException::class)
    fun tooLarge() = ResponseEntity.status(413).body(AttachmentErrorResponse("ATTACHMENT_TOO_LARGE", "파일은 10 MiB 이하만 업로드할 수 있어요."))

    @ExceptionHandler(MultipartException::class)
    fun invalid() = ResponseEntity.unprocessableContent().body(AttachmentErrorResponse("ATTACHMENT_INVALID", "파일 입력을 확인해 주세요."))
}
