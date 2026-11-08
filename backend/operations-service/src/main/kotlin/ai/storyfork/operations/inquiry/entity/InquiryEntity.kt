package ai.storyfork.operations.inquiry.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Version
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

@Entity
@Table(name = "inquiry", schema = "operations")
class InquiryEntity(
    @field:Id
    @field:Column(nullable = false, updatable = false)
    val id: UUID = UUID.randomUUID(),
    @field:Column(nullable = false, length = 200)
    var title: String,
    @field:Column(nullable = false, columnDefinition = "text")
    var body: String,
    @field:Column(nullable = false, length = 50)
    var category: String,
    @field:Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = createdAt,
    @field:Version
    @field:Column(nullable = false)
    var version: Long? = null,
)
