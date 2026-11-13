package ai.storyfork.content.attachment.controller

import ai.storyfork.content.attachment.service.dto.AttachmentErrorResponse
import jakarta.servlet.http.HttpServletRequest
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
class AttachmentMultipartExceptionHandler {
    /** multipart 한도에 걸린 요청은 업로드 종류에 맞는 한도를 안내한다. */
    @ExceptionHandler(MaxUploadSizeExceededException::class)
    fun tooLarge(request: HttpServletRequest): ResponseEntity<AttachmentErrorResponse> {
        val detail = when {
            request.requestURI.endsWith("/manuscript-imports/bulk") ->
                "업로드 묶음이 너무 커요. TXT는 10 MiB, EPUB과 묶음 파일 합계는 50 MiB까지 올릴 수 있어요."
            "/manuscript-imports" in request.requestURI -> "TXT는 10MB, EPUB은 50MB 이하만 올릴 수 있어요."
            else -> "파일은 10 MiB 이하만 업로드할 수 있어요."
        }
        return ResponseEntity.status(413).body(AttachmentErrorResponse("ATTACHMENT_TOO_LARGE", detail))
    }

    @ExceptionHandler(MultipartException::class)
    fun invalid() = ResponseEntity.unprocessableContent().body(AttachmentErrorResponse("ATTACHMENT_INVALID", "파일 입력을 확인해 주세요."))
}
