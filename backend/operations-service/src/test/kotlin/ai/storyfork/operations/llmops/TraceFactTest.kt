package ai.storyfork.operations.llmops

import ai.storyfork.operations.llmops.service.ioValue
import ai.storyfork.operations.llmops.service.requestRoot
import ai.storyfork.operations.llmops.service.toTraceFact
import ai.storyfork.operations.llmops.service.traceInput
import ai.storyfork.operations.llmops.service.traceOutput
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.MissingNode

/** Langfuse observation JSON in, what the screens and checks read out. No network, Spring context or database. */
class TraceFactTest {
    private fun text(value: String?): JsonNode = testMapper.createObjectNode().put("v", value).path("v")

    @Test
    fun `the feature tag and the status metadata of the root give the feature and status and a root without a status has none`() {
        val tagged = root("t-1", feature = "world", status = "timeout", userId = "user-7").toTraceFact()
        val waiting = root("t-2", status = null).toTraceFact()

        assertEquals(listOf("t-1", "world", "timeout", "user-7"), listOf(tagged.id, tagged.feature, tagged.status, tagged.userId))
        assertEquals(Instant.parse("2026-11-19T01:00:00Z"), tagged.timestamp)
        // A request that waits for the writer or was cancelled has no status; it is not a finished request and the stats skip it.
        assertEquals("t-2", waiting.id)
        assertNull(waiting.status)
    }

    @Test
    fun `a root named after its feature is that feature when the tag is missing and unknown when nothing names it`() {
        val untagged = observation("t-1", "o-1", name = "web_research", root = true).toTraceFact()
        val tagWins = observation("t-2", "o-2", name = "orchestration", root = true, tags = listOf("other", "feature:world")).toTraceFact()
        val nameless = observation("t-3", "o-3", name = "", root = true).toTraceFact()

        assertEquals(listOf("web_research", "world", "unknown"), listOf(untagged.feature, tagWins.feature, nameless.feature))
    }

    @Test
    fun `empty text is no value the way the real answers write it`() {
        val fact = observation("t", "o", root = true, userId = "", metadata = mapOf("status" to "", "work_id" to "", "credit_reservation_id" to "")).toTraceFact()

        assertNull(fact.userId)
        assertNull(fact.status)
        assertNull(fact.workId)
        assertFalse(fact.userCharged)
    }

    @Test
    fun `latency seconds become rounded milliseconds`() {
        assertEquals(1500L, root("t", latency = 1.5).toTraceFact().latencyMs)
        assertEquals(1235L, root("t", latency = 1.2346).toTraceFact().latencyMs)
        assertEquals(0L, root("t", latency = 0.0004).toTraceFact().latencyMs)
        // A request still running has no latency yet.
        assertNull(root("t", latency = null).toTraceFact().latencyMs)
    }

    @Test
    fun `metadata decides the work the credit charge and the fork flag`() {
        val charged = root("t", metadata = mapOf("work_id" to "w-1", "credit_reservation_id" to "res-1", "fork" to "true")).toTraceFact()

        assertEquals("w-1", charged.workId)
        assertTrue(charged.userCharged)
        assertTrue(charged.fork)
        for (blank in listOf(null, "", "  ")) assertFalse(root("t", metadata = mapOf("credit_reservation_id" to blank)).toTraceFact().userCharged, blank.toString())
        assertFalse(root("t").toTraceFact().userCharged)
        // The AI service writes fork as the text true or false; a boolean reads the same.
        for (fork in listOf("true", "TRUE", true)) assertTrue(root("t", metadata = mapOf("fork" to fork)).toTraceFact().fork, fork.toString())
        for (fork in listOf("false", false, null, "1", 0)) assertFalse(root("t", metadata = mapOf("fork" to fork)).toTraceFact().fork, fork.toString())
        assertNull(root("t", metadata = mapOf("work_id" to null)).toTraceFact().workId)
    }

    @Test
    fun `metadata that is not an object does not break the reading`() {
        for (metadata in listOf("null", "\"text\"", "[]", "5")) {
            val fact = json("""{"traceId":"t","startTime":"2026-11-19T01:00:00Z","metadata":$metadata}""").toTraceFact()
            assertNull(fact.workId, metadata)
            assertNull(fact.status, metadata)
            assertFalse(fact.fork, metadata)
            assertFalse(fact.userCharged, metadata)
        }
    }

    @Test
    fun `a start time or trace id that is missing or malformed is a broken Langfuse answer (502) and not a crash`() {
        for (bad in listOf("\"yesterday\"", "\"2026-11-19 01:00:00\"", "null", "42", "\"\"")) {
            val failure = assertThrows(ResponseStatusException::class.java) { json("""{"traceId":"t","startTime":$bad}""").toTraceFact() }
            assertEquals(HttpStatus.BAD_GATEWAY, failure.statusCode, bad)
        }
        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { json("""{"traceId":"t"}""").toTraceFact() }.statusCode)
        for (noTrace in listOf("{\"startTime\":\"2026-11-19T01:00:00Z\"}", "{\"traceId\":null,\"startTime\":\"2026-11-19T01:00:00Z\"}", "{\"traceId\":\"\",\"startTime\":\"2026-11-19T01:00:00Z\"}")) {
            assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { json(noTrace).toTraceFact() }.statusCode, noTrace)
        }
    }

    @Test
    fun `a latency that is not a finite number is unknown and never a crash`() {
        for (bad in listOf("\"NaN\"", "\"Infinity\"", "\"-Infinity\"", "\"soon\"")) {
            assertNull(json("""{"traceId":"t","startTime":"2026-11-19T01:00:00Z","latency":$bad}""").toTraceFact().latencyMs, bad)
        }
    }

    @Test
    fun `an input or output is raw text that becomes JSON again only when it is a JSON object or array`() {
        assertEquals("질문", text("""{"question":"질문"}""").ioValue()?.path("question")?.asString())
        assertEquals(listOf("a", "b"), text("""["a","b"]""").ioValue()?.values()?.map { it.asString() })
        // The real answers write non-ASCII as \u escapes inside the JSON text; reading it back gives the Korean text.
        assertEquals("3화까지", text("""{"request": "3화까지"}""").ioValue()?.path("request")?.asString())
        for (plain in listOf("그 사람의 이름은 한서진이야", "{not json", "42", "\"quoted\"", "true")) {
            val value = checkNotNull(text(plain).ioValue()) { plain }
            assertTrue(value.isString, plain)
            assertEquals(plain, value.asString())
        }
        for (empty in listOf(text(null), text(""), text("  "), MissingNode.getInstance())) assertNull(empty.ioValue(), empty.toString())
        // A node that already is structured stays as it is.
        assertEquals("v", json("""{"k":"v"}""").ioValue()?.path("k")?.asString())
    }

    @Test
    fun `the request root of a trace is its newest finished request else its newest root else its first observation`() {
        val waiting = root("t", "2026-11-19T01:00:00Z", status = null, id = "r1")
        val failed = root("t", "2026-11-19T02:00:00Z", status = "failed", id = "r2")
        val success = root("t", "2026-11-19T03:00:00Z", status = "success", id = "r3")
        val cancelled = root("t", "2026-11-19T04:00:00Z", status = null, id = "r4")
        val step = generation("t", "g1", startTime = "2026-11-19T01:00:05Z")

        assertEquals("r3", listOf(waiting, failed, success, cancelled, step).requestRoot().path("id").asString())
        assertEquals("r4", listOf(waiting, cancelled, step).requestRoot().path("id").asString())
        assertEquals("g1", listOf(step).requestRoot().path("id").asString())
        assertEquals("g1", listOf(generation("t", "g2", startTime = "2026-11-19T01:00:09Z"), step).requestRoot().path("id").asString())
    }

    @Test
    fun `a trace answered what its root says else what its generation that ended last says`() {
        val first = generation("t", "g1", startTime = "2026-11-19T01:00:01Z", latency = 2.0, output = "first")
        val silent = generation("t", "g2", startTime = "2026-11-19T01:00:02Z", latency = 7.0, output = null)
        val second = generation("t", "g3", startTime = "2026-11-19T01:00:03Z", latency = 3.0, output = """{"answer":"둘째"}""")

        assertEquals("root answer", listOf(root("t", output = "root answer"), first, second).traceOutput()?.asString())
        // g3 ends at 01:00:06 and g2 at 01:00:09 but has no output: the last answer that exists wins.
        assertEquals("둘째", listOf(root("t"), first, silent, second).traceOutput()?.path("answer")?.asString())
        assertNull(listOf(root("t"), silent).traceOutput())
        assertNull(emptyList<JsonNode>().traceOutput())
        // A step that is not a model call is no answer.
        assertNull(listOf(root("t"), observation("t", "s", output = "not a generation")).traceOutput())
    }

    @Test
    fun `a trace was asked what its root says else what its earliest observation with an input says`() {
        val late = observation("t", "s2", startTime = "2026-11-19T01:00:05Z", input = "late")
        val early = observation("t", "s1", startTime = "2026-11-19T01:00:02Z", input = """{"request":"질문"}""")
        val blank = observation("t", "s0", startTime = "2026-11-19T01:00:01Z", input = " ")

        assertEquals("root question", listOf(root("t", input = "root question"), early).traceInput()?.asString())
        assertEquals("질문", listOf(root("t"), late, early, blank).traceInput()?.path("request")?.asString())
        assertNull(listOf(root("t"), blank).traceInput())
        assertNull(emptyList<JsonNode>().traceInput())
    }
}
