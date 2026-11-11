package ai.storyfork.core.auth

import ai.storyfork.core.auth.scheduler.WithdrawalCompletionJob
import ai.storyfork.core.auth.service.WithdrawalCompletionService
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`

class WithdrawalCompletionJobTest {
    private val now = Instant.parse("2026-12-01T00:00:00Z")
    private val completion = mock(WithdrawalCompletionService::class.java)

    @Test
    fun `disabled job does nothing`() {
        WithdrawalCompletionJob(completion, false, 50).poll()
        verifyNoInteractions(completion)
    }

    @Test
    fun `every due request is completed and only completed ones are counted`() {
        val a = UUID.randomUUID(); val b = UUID.randomUUID(); val c = UUID.randomUUID()
        `when`(completion.dueIds(now, 10)).thenReturn(listOf(a, b, c))
        `when`(completion.complete(a, now)).thenReturn(true)
        `when`(completion.complete(b, now)).thenReturn(false)
        `when`(completion.complete(c, now)).thenReturn(true)

        assertEquals(2, WithdrawalCompletionJob(completion, true, 10).runOnce(now))
    }

    @Test
    fun `one failing request does not stop the others`() {
        val bad = UUID.randomUUID(); val good = UUID.randomUUID()
        `when`(completion.dueIds(now, 50)).thenReturn(listOf(bad, good))
        `when`(completion.complete(bad, now)).thenThrow(IllegalStateException("boom"))
        `when`(completion.complete(good, now)).thenReturn(true)

        assertEquals(1, WithdrawalCompletionJob(completion, true, 50).runOnce(now))
        verify(completion).complete(good, now)
    }
}
