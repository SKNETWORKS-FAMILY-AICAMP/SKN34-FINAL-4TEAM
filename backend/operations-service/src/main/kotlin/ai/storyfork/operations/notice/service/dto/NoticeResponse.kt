package ai.storyfork.operations.notice.service.dto

import java.time.Instant
import java.util.UUID

/** 엔티티 대신 UUID·일반 텍스트·UTC 시각만 노출하는 공지 응답이다. */
data class NoticeResponse(
    val id: UUID,
    val title: String,
    val body: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)
