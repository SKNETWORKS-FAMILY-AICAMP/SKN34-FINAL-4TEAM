package ai.storyfork.core.auth

import ai.storyfork.core.auth.scheduler.WithdrawalCompletionJob
import ai.storyfork.core.auth.service.WithdrawalCompletionService
import java.time.Duration
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
        WithdrawalCompletionJob(completion, false, 50, Duration.ofHours(6)).poll()
        verifyNoInteractions(completion)
    }

    @Test
    fun `every due request is completed and only completed ones are counted`() {
        val a = UUID.randomUUID(); val b = UUID.randomUUID(); val c = UUID.randomUUID()
        `when`(completion.dueIds(now, 10, emptyList())).thenReturn(listOf(a, b, c))
        `when`(completion.complete(a, now)).thenReturn(true)
        `when`(completion.complete(b, now)).thenReturn(false)
        `when`(completion.complete(c, now)).thenReturn(true)

        assertEquals(2, WithdrawalCompletionJob(completion, true, 10, Duration.ofHours(6)).runOnce(now))
    }

    @Test
    fun `one failing request does not stop the others`() {
        val bad = UUID.randomUUID(); val good = UUID.randomUUID()
        `when`(completion.dueIds(now, 50, emptyList())).thenReturn(listOf(bad, good))
        `when`(completion.complete(bad, now)).thenThrow(IllegalStateException("boom"))
        `when`(completion.complete(good, now)).thenReturn(true)

        assertEquals(1, WithdrawalCompletionJob(completion, true, 50, Duration.ofHours(6)).runOnce(now))
        verify(completion).complete(good, now)
    }

    @Test
    fun `a failing request is skipped until its retry time so it cannot block the ones behind it`() {
        val bad = UUID.randomUUID(); val good = UUID.randomUUID()
        val job = WithdrawalCompletionJob(completion, true, 1, Duration.ofHours(6))
        `when`(completion.dueIds(now, 1, emptyList())).thenReturn(listOf(bad))
        `when`(completion.complete(bad, now)).thenThrow(IllegalStateException("boom"))
        assertEquals(0, job.runOnce(now))

        val later = now.plus(Duration.ofHours(1))
        `when`(completion.dueIds(later, 1, listOf(bad))).thenReturn(listOf(good))
        `when`(completion.complete(good, later)).thenReturn(true)
        assertEquals(1, job.runOnce(later))

        // 재시도 시각이 지나면 다시 시도 대상이 된다.
        val retry = now.plus(Duration.ofHours(7))
        `when`(completion.dueIds(retry, 1, emptyList())).thenReturn(listOf(bad))
        `when`(completion.complete(bad, retry)).thenReturn(true)
        assertEquals(1, job.runOnce(retry))
    }

    @Test
    fun `a request that was not completed is also skipped for the retry delay`() {
        val stuck = UUID.randomUUID()
        val job = WithdrawalCompletionJob(completion, true, 5, Duration.ofHours(6))
        `when`(completion.dueIds(now, 5, emptyList())).thenReturn(listOf(stuck))
        `when`(completion.complete(stuck, now)).thenReturn(false)
        assertEquals(0, job.runOnce(now))
        `when`(completion.dueIds(now.plusSeconds(60), 5, listOf(stuck))).thenReturn(emptyList())
        assertEquals(0, job.runOnce(now.plusSeconds(60)))
        verify(completion, org.mockito.Mockito.times(1)).complete(stuck, now)
    }
}
