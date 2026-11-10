package ai.storyfork.content.attachment.controller

import jakarta.validation.constraints.NotNull
import org.springframework.web.multipart.MultipartFile

/** multipart 요청 바인딩 전용 객체다. 서비스 계층에는 검증을 마친 AttachmentUploadPayload만 전달한다. */
data class AttachmentUploadRequest(@field:NotNull var file: MultipartFile? = null)
