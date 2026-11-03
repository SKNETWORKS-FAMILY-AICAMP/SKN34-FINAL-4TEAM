package ai.storyfork.core.settingattachment.service.dto

data class AttachmentUploadPayload(val filename: String, val mediaType: String, val kind: String, val bytes: ByteArray)
