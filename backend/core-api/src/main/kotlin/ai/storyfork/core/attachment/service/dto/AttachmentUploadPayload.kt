package ai.storyfork.core.attachment.service.dto

data class AttachmentUploadPayload(val filename: String, val mediaType: String, val kind: String, val bytes: ByteArray)
