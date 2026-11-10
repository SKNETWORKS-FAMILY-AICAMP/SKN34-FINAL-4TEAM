package ai.storyfork.operations.activity.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/** Insert-only record of one admin change action, so it carries no version column and every column is non-updatable. */
@Entity
@Table(name = "admin_activity", schema = "operations")
class AdminActivityEntity(
    @field:Id
    @field:Column(nullable = false, updatable = false)
    val id: UUID = UUID.randomUUID(),
    @field:Column(name = "actor_id", nullable = false, updatable = false)
    val actorId: UUID,
    @field:Column(nullable = false, updatable = false, length = 40)
    val action: String,
    @field:Column(name = "target_type", nullable = false, updatable = false, length = 20)
    val targetType: String,
    @field:Column(name = "target_id", nullable = false, updatable = false, length = 100)
    val targetId: String,
    @field:Column(updatable = false, length = 500)
    val detail: String?,
    @field:Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
)
