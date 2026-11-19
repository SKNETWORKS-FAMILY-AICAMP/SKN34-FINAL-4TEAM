package ai.storyfork.operations.llmops

import ai.storyfork.operations.llmops.entity.LeakCheckResultEntity
import ai.storyfork.operations.llmops.repository.LeakCheckResultRepository
import ai.storyfork.operations.llmops.service.LeakCheckService
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked repository: no Spring context, HTTP or database. */
class LeakCheckServiceTest {
    private val results = mock(LeakCheckResultRepository::class.java)
    private val operators = Operators()
    private val service = LeakCheckService(operators.permissions, results)

    @Test
    fun `only an operator with the llm permission reads the leak check results`() {
        for (denied in listOf(operators.jobs, operators.none, operators.stale)) {
            assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { service.list(denied) }.statusCode)
        }

        verifyNoInteractions(results)
    }

    @Test
    fun `the list maps the newest results with their matched titles`() {
        val suspected = LeakCheckResultEntity(traceId = "t-1", workId = "w-1", matched = listOf("한서진", "별빛 열쇠"), suspected = true, reason = "그대로 말했어요", checkedAt = Instant.parse("2026-11-19T02:00:00Z"))
        val clean = LeakCheckResultEntity(traceId = "t-2", workId = "w-2", matched = emptyList(), suspected = false, reason = null, checkedAt = Instant.parse("2026-11-19T01:00:00Z"))
        `when`(results.findTop100ByOrderByCheckedAtDescIdDesc()).thenReturn(listOf(suspected, clean))

        val items = service.list(operators.llm).items

        assertEquals(listOf(suspected.id, clean.id), items.map { it.id })
        assertEquals(listOf("t-1", "w-1", true, "그대로 말했어요"), listOf(items[0].traceId, items[0].workId, items[0].suspected, items[0].reason))
        assertEquals(listOf("한서진", "별빛 열쇠"), items[0].matched)
        assertEquals(Instant.parse("2026-11-19T02:00:00Z"), items[0].checkedAt)
        assertEquals(listOf("t-2", false), listOf(items[1].traceId, items[1].suspected))
        assertTrue(items[1].matched.isEmpty())
        assertNull(items[1].reason)
    }
}
