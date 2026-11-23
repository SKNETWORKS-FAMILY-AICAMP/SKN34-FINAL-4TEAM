package ai.storyfork.operations.jobs.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Version
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

/** A schedule is cancelled with enabled = false and never deleted. The [kind] is fixed for its life; [params] go to the kind's handler as is. */
@Entity
@Table(name = "scheduled_job", schema = "operations")
class ScheduledJobEntity(
    @field:Id
    @field:Column(nullable = false, updatable = false)
    val id: UUID = UUID.randomUUID(),
    @field:Column(nullable = false, updatable = false, length = 40)
    val kind: String,
    @field:Column(nullable = false, length = 100)
    var cron: String,
    @field:Column(nullable = false)
    var enabled: Boolean = true,
    @field:JdbcTypeCode(SqlTypes.JSON)
    @field:Column(nullable = false, columnDefinition = "jsonb")
    var params: Map<String, Any?> = emptyMap(),
    @field:Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = createdAt,
    @field:Version
    @field:Column(nullable = false)
    var version: Long? = null,
)
