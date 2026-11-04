package ai.storyfork.core.attachment.service.dto

import jakarta.validation.constraints.NotNull
import org.springframework.web.multipart.MultipartFile

data class AttachmentUploadRequest(@field:NotNull var file: MultipartFile? = null)
