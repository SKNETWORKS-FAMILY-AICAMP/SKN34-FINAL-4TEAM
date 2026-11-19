package ai.storyfork.operations.llmops.service

import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.entity.LlmopsSettingEntity
import ai.storyfork.operations.llmops.repository.LlmopsSettingRepository
import ai.storyfork.operations.llmops.service.dto.LlmopsSettings
import ai.storyfork.operations.llmops.service.dto.LlmopsSettingsRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

private const val RATE_KEY = "leak_sample_rate"
private const val DEFAULT_RATE = 0.1

/** The leak sample rate, changed by llm admins; the change and its activity record share one transaction. */
@Service
@Transactional
class LlmopsSettingService(
    private val settings: LlmopsSettingRepository,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
) {
    @Transactional(readOnly = true)
    fun get(member: OperationsMember): LlmopsSettings {
        permissions.requirePermission(member, "llm")
        return LlmopsSettings(leakSampleRate())
    }

    /** What the leak sampling run reads; the seeded 0.1 when the row is somehow missing. */
    @Transactional(readOnly = true)
    fun leakSampleRate(): Double = settings.findById(RATE_KEY).map { it.value.toDouble() }.orElse(DEFAULT_RATE)

    fun update(member: OperationsMember, request: LlmopsSettingsRequest): LlmopsSettings {
        permissions.requirePermission(member, "llm")
        val rate = request.leakSampleRate
        require(rate.isFinite() && rate in 0.0..1.0) { "The sample rate is a fraction from 0 to 1." }
        val row = settings.findById(RATE_KEY).orElseGet { LlmopsSettingEntity(RATE_KEY, "") }
        row.value = rate.toString()
        settings.saveAndFlush(row)
        activities.record(member, "LLMOPS_SETTING_UPDATE", "LLMOPS_SETTING", RATE_KEY, rate.toString())
        return LlmopsSettings(rate)
    }
}
