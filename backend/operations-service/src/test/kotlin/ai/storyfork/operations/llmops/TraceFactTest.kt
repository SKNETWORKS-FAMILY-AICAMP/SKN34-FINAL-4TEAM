package ai.storyfork.operations.llmops

import ai.storyfork.operations.llmops.service.toTraceFact
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** Langfuse JSON in, what the screens and checks read out. No network, Spring context or database. */
class TraceFactTest {
    @Test
    fun `tags give the feature and status and a trace without them is unknown`() {
        val tagged = trace("t-1", feature = "world", status = "timeout", userId = "user-7").toTraceFact()
        val bare = json("""{"id":"t-2","timestamp":"2026-11-19T01:00:00Z"}""").toTraceFact()

        assertEquals(listOf("t-1", "world", "timeout", "user-7"), listOf(tagged.id, tagged.feature, tagged.status, tagged.userId))
        assertEquals(Instant.parse("2026-11-19T01:00:00Z"), tagged.timestamp)
        assertEquals(listOf("t-2", "unknown", "unknown"), listOf(bare.id, bare.feature, bare.status))
        assertNull(bare.userId)
        assertNull(bare.workId)
        assertNull(bare.latencyMs)
        assertEquals(0.0, bare.cost)
        assertNull(bare.output)
    }

    @Test
    fun `latency seconds become rounded milliseconds and cost reads a number or a numeric string`() {
        assertEquals(1500L, trace("t", latency = 1.5).toTraceFact().latencyMs)
        assertEquals(1235L, trace("t", latency = 1.2346).toTraceFact().latencyMs)
        assertEquals(0L, trace("t", latency = 0.0004).toTraceFact().latencyMs)
        assertNull(trace("t", latency = null).toTraceFact().latencyMs)
        assertEquals(0.0125, trace("t", cost = 0.0125).toTraceFact().cost)
        assertEquals(0.5, json("""{"id":"t","timestamp":"2026-11-19T01:00:00Z","totalCost":"0.5"}""").toTraceFact().cost)
    }

    @Test
    fun `metadata decides the work the credit charge and the fork flag`() {
        val charged = trace("t", metadata = """{"work_id":"w-1","credit_reservation_id":"res-1","fork":true}""").toTraceFact()

        assertEquals("w-1", charged.workId)
        assertTrue(charged.userCharged)
        assertTrue(charged.fork)
        for (blank in listOf("null", "\"\"", "\"  \"")) {
            assertFalse(trace("t", metadata = """{"credit_reservation_id":$blank}""").toTraceFact().userCharged, blank)
        }
        assertFalse(trace("t").toTraceFact().userCharged)
        for (fork in listOf("\"true\"", "\"TRUE\"", "true")) assertTrue(trace("t", metadata = """{"fork":$fork}""").toTraceFact().fork, fork)
        for (fork in listOf("false", "\"false\"", "null", "\"1\"", "0")) assertFalse(trace("t", metadata = """{"fork":$fork}""").toTraceFact().fork, fork)
        assertNull(trace("t", metadata = """{"work_id":null}""").toTraceFact().workId)
    }

    @Test
    fun `metadata that is not an object does not break the reading`() {
        for (metadata in listOf("null", "\"text\"", "[]", "5")) {
            val fact = trace("t", metadata = metadata).toTraceFact()
            assertNull(fact.workId, metadata)
            assertFalse(fact.fork, metadata)
            assertFalse(fact.userCharged, metadata)
        }
    }

    @Test
    fun `the output is kept for the leak check unless it is null`() {
        assertEquals("그 사람의 이름은 한서진이야", trace("t", output = "\"그 사람의 이름은 한서진이야\"").toTraceFact().output?.asString())
        assertEquals("답", trace("t", output = """{"answer":"답"}""").toTraceFact().output?.path("answer")?.asString())
        assertNull(trace("t", output = "null").toTraceFact().output)
    }
}
