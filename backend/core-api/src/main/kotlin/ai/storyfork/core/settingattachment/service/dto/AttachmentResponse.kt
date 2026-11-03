package ai.storyfork.core.settingattachment.service.dto

import java.time.Instant

data class AttachmentResponse(val id: String, val filename: String, val mediaType: String, val kind: String, val byteSize: Long, val createdAt: Instant, val url: String)
