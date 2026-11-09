package ai.storyfork.operations.notice.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Version
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/** 운영 스키마의 공지 정본이며 버전으로 동시 수정·삭제 충돌을 감지한다. */
@Entity
@Table(name = "notice", schema = "operations")
class NoticeEntity(
    @field:Id
    val id: UUID = UUID.randomUUID(),
    @field:Column(nullable = false, length = 200)
    var title: String,
    @field:Column(nullable = false, columnDefinition = "text")
    var body: String,
    @field:Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = createdAt,
    @field:Version
    @field:Column(nullable = false)
    var version: Long? = null,
)
