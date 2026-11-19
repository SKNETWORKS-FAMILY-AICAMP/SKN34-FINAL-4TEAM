package ai.storyfork.operations.llmops

import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.entity.LlmopsSettingEntity
import ai.storyfork.operations.llmops.repository.LlmopsSettingRepository
import ai.storyfork.operations.llmops.service.LlmopsSettingService
import ai.storyfork.operations.llmops.service.dto.LlmopsSettingsRequest
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked repository and activity service: no Spring context, HTTP or database. */
class LlmopsSettingServiceTest {
    private val settings = mock(LlmopsSettingRepository::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val operators = Operators()
    private val service = LlmopsSettingService(settings, operators.permissions, activities)

    private fun givenRate(value: String?) =
        `when`(settings.findById("leak_sample_rate")).thenReturn(Optional.ofNullable(value?.let { LlmopsSettingEntity("leak_sample_rate", it) }))

    @Test
    fun `only an operator with the llm permission reads or changes the settings`() {
        for (denied in listOf(operators.jobs, operators.none, operators.stale)) {
            assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { service.get(denied) }.statusCode)
            assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { service.update(denied, LlmopsSettingsRequest(0.5)) }.statusCode)
        }

        verifyNoInteractions(settings, activities)
    }

    @Test
    fun `the stored sample rate is read and the seeded 0 point 1 is the fallback`() {
        givenRate("0.25")
        assertEquals(0.25, service.get(operators.llm).leakSampleRate)
        assertEquals(0.25, service.leakSampleRate())

        givenRate(null)
        assertEquals(0.1, service.leakSampleRate())
    }

    @Test
    fun `updating stores the rate and records the change after the save`() {
        val row = LlmopsSettingEntity("leak_sample_rate", "0.1")
        `when`(settings.findById("leak_sample_rate")).thenReturn(Optional.of(row))

        val result = service.update(operators.llm, LlmopsSettingsRequest(0.3))

        assertEquals("0.3", row.value)
        assertEquals(0.3, result.leakSampleRate)
        val order = inOrder(settings, activities)
        order.verify(settings).saveAndFlush(row)
        order.verify(activities).record(operators.llm, "LLMOPS_SETTING_UPDATE", "LLMOPS_SETTING", "leak_sample_rate", "0.3")
    }

    @Test
    fun `zero and one are valid rates and anything outside 0 to 1 is 400`() {
        val row = LlmopsSettingEntity("leak_sample_rate", "0.1")
        `when`(settings.findById("leak_sample_rate")).thenReturn(Optional.of(row))

        assertEquals(0.0, service.update(operators.llm, LlmopsSettingsRequest(0.0)).leakSampleRate)
        assertEquals(1.0, service.update(operators.llm, LlmopsSettingsRequest(1.0)).leakSampleRate)
        clearInvocations(activities)

        for (bad in listOf(-0.01, 1.01, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertThrows(IllegalArgumentException::class.java) { service.update(operators.llm, LlmopsSettingsRequest(bad)) }
        }

        assertEquals("1.0", row.value)
        verifyNoInteractions(activities)
    }
}
