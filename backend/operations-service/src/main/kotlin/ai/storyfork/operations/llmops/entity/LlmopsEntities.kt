package ai.storyfork.operations.llmops.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

/** A key and value setting; today only leak_sample_rate. */
@Entity
@Table(name = "llmops_setting", schema = "operations")
class LlmopsSettingEntity(
    @field:Id
    @field:Column(name = "key", nullable = false, updatable = false, length = 40)
    val settingKey: String,
    @field:Column(nullable = false, length = 100)
    var value: String,
)

/** Insert-only result of one sampled trace; [matched] holds the private titles found in the answer (empty when nothing matched). */
@Entity
@Table(name = "leak_check_result", schema = "operations")
class LeakCheckResultEntity(
    @field:Id
    @field:Column(nullable = false, updatable = false)
    val id: UUID = UUID.randomUUID(),
    @field:Column(name = "trace_id", nullable = false, updatable = false, length = 100)
    val traceId: String,
    @field:Column(name = "work_id", nullable = false, updatable = false, length = 100)
    val workId: String,
    @field:JdbcTypeCode(SqlTypes.JSON)
    @field:Column(columnDefinition = "jsonb", nullable = false, updatable = false)
    val matched: List<String>,
    @field:Column(nullable = false, updatable = false)
    val suspected: Boolean,
    @field:Column(updatable = false, columnDefinition = "text")
    val reason: String? = null,
    @field:Column(name = "checked_at", nullable = false, updatable = false)
    val checkedAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
)
