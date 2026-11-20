package ai.storyfork.operations.llmops.repository

import ai.storyfork.operations.llmops.entity.LeakCheckResultEntity
import ai.storyfork.operations.llmops.entity.LlmopsSettingEntity
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface LlmopsSettingRepository : JpaRepository<LlmopsSettingEntity, String>

interface LeakCheckResultRepository : JpaRepository<LeakCheckResultEntity, UUID> {
    /** ponytail: newest 100 only; add a suspected-only filter and a cursor when the list outgrows it. */
    fun findTop100ByOrderByCheckedAtDescIdDesc(): List<LeakCheckResultEntity>
    fun existsByTraceId(traceId: String): Boolean
}
