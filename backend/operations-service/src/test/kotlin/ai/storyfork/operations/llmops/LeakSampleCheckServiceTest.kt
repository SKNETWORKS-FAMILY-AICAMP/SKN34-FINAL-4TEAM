package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.LeakReferences
import ai.storyfork.operations._common.client.LeakVerdict
import ai.storyfork.operations.alert.entity.AlertRuleEntity
import ai.storyfork.operations.alert.repository.AlertRuleRepository
import ai.storyfork.operations.alert.service.AlertRaiser
import ai.storyfork.operations.llmops.entity.LeakCheckResultEntity
import ai.storyfork.operations.llmops.repository.LeakCheckResultRepository
import ai.storyfork.operations.llmops.service.LeakSampleCheckService
import ai.storyfork.operations.llmops.service.LlmopsSettingService
import java.time.Instant
import java.util.Optional
import kotlin.random.Random
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode

/** Mocked Langfuse, Content, AI and repositories: no network, broker, Spring context or database. */
class LeakSampleCheckServiceTest {
    private val langfuse = mock(LangfuseClient::class.java)
    private val content = mock(ContentClient::class.java)
    private val verdicts = mutableMapOf<String, LeakVerdict>()
    private val ai = mock(AiClient::class.java) { call -> verdicts[(call.arguments[1] as List<*>).first()] ?: LeakVerdict(false) }
    private val settings = mock(LlmopsSettingService::class.java)
    private val saved = mutableListOf<LeakCheckResultEntity>()
    private var alreadyChecked = emptySet<String>()
    private val results = mock(LeakCheckResultRepository::class.java) { call ->
        when (call.method.name) {
            "existsByTraceId" -> call.arguments[0] in alreadyChecked
            "saveAndFlush" -> { saved += call.arguments[0] as LeakCheckResultEntity; call.arguments[0] }
            else -> null
        }
    }
    private val rules = mock(AlertRuleRepository::class.java)
    private val raiser = mock(AlertRaiser::class.java)
    private val service = LeakSampleCheckService(langfuse, content, ai, settings, results, rules, raiser)
    private val from = Instant.parse("2026-11-19T00:00:00Z")
    private val to = Instant.parse("2026-11-19T01:00:00Z")

    /** A request root of the window and the answer its trace gave: Langfuse keeps the answer on the model call, as raw text. */
    private class Request(val root: JsonNode, val answer: String?) {
        val traceId: String = root.path("traceId").asString()
    }

    /** [input] is the request root's raw input text, null for a root without one. */
    private fun fork(id: String, workId: String?, answer: String?, status: String? = "success", fork: Boolean = true, input: String? = null) = Request(
        root(id, status = status, input = input, metadata = mapOf("fork" to fork.toString()) + (workId?.let { mapOf("work_id" to it) } ?: emptyMap())), answer,
    )

    /** What the AI service writes as a request root's input, like Python's json.dumps: {"request": "…"} with every non-ASCII character escaped. */
    private fun asked(question: String) = buildString {
        for (c in """{"request": ${testMapper.writeValueAsString(question)}}""") if (c.code < 128) append(c) else append("\\u%04x".format(c.code))
    }

    private val leaked = fork("f1", "w-1", "그 사람의 진짜 이름은 한서진이야")
    private val clean = fork("f2", "w-1", "아무 일도 없었어요")
    private val notAFork = fork("f3", "w-1", "한서진", fork = false)
    private val noWork = fork("f4", null, "한서진")
    private val gone = fork("f5", "w-2", "한서진")
    private val objectAnswer = fork("f6", "w-1", """{"answer":"12화 진실이 밝혀져요"}""")

    private fun givenTraces(vararg requests: Request, rate: Double = 1.0, leakRuleEnabled: Boolean? = true) {
        `when`(langfuse.allTraces(from, to)).thenReturn(requests.map { it.root })
        for (request in requests) {
            `when`(langfuse.traceObservations(request.traceId)).thenReturn(listOf(request.root, generation(request.traceId, "g-${request.traceId}", output = request.answer)))
        }
        `when`(settings.leakSampleRate()).thenReturn(rate)
        `when`(content.leakReferences("w-1")).thenReturn(LeakReferences("w-origin", listOf("한서진", "", "  ", "별빛 열쇠"), listOf("12화 진실")))
        `when`(content.leakReferences("w-2")).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        `when`(rules.findById("leak_suspected")).thenReturn(Optional.ofNullable(leakRuleEnabled?.let { AlertRuleEntity(ruleKey = "leak_suspected", metric = "leak_suspected", windowMinutes = 1440, enabled = it) }))
    }

    private fun aiCalls() = mockingDetails(ai).invocations.map { it.arguments[0] as String to it.arguments[1] as List<*> }

    private fun aiQuestions() = mockingDetails(ai).invocations.map { it.arguments[2] }

    private fun readAnswersOf() = mockingDetails(langfuse).invocations.filter { it.method.name == "traceObservations" }.map { it.arguments[0] }

    @Test
    fun `a sampled fork answer is matched against the private titles and only matches go to the AI judge`() {
        givenTraces(leaked, clean, notAFork, noWork, gone, objectAnswer)
        verdicts["한서진"] = LeakVerdict(true, "비공개 카드 제목을 그대로 말했어요")

        val suspicious = service.run(from, to, Random(1))

        assertEquals(1, suspicious)
        assertEquals(listOf("f1", "f2", "f6"), saved.map { it.traceId })
        assertEquals(listOf("w-1", "w-1", "w-1"), saved.map { it.workId })
        assertEquals(listOf(listOf("한서진"), emptyList(), listOf("12화 진실")), saved.map { it.matched })
        assertEquals(listOf(true, false, false), saved.map { it.suspected })
        assertEquals(listOf("비공개 카드 제목을 그대로 말했어요", null, null), saved.map { it.reason })
        val calls = aiCalls()
        assertEquals(2, calls.size)
        assertEquals("그 사람의 진짜 이름은 한서진이야" to listOf("한서진"), calls[0])
        // An answer Langfuse stores as JSON text is read as JSON again, so Korean text is matched as written and not as \u escapes.
        assertTrue(calls[1].first.contains("12화 진실이 밝혀져요"))
        assertEquals(listOf("12화 진실"), calls[1].second)
    }

    @Test
    fun `blank titles never match and the answer of another origin is not read`() {
        givenTraces(clean)

        service.run(from, to, Random(1))

        assertEquals(listOf(emptyList<String>()), saved.map { it.matched })
        assertTrue(aiCalls().isEmpty())
    }

    @Test
    fun `Content is asked once per work in a run and an unknown work is skipped without a result`() {
        givenTraces(leaked, clean, gone, objectAnswer, fork("f7", "w-2", "x"))

        service.run(from, to, Random(1))

        verify(content, times(1)).leakReferences("w-1")
        verify(content, times(1)).leakReferences("w-2")
        assertEquals(listOf("f1", "f2", "f6"), saved.map { it.traceId })
    }

    @Test
    fun `the answer is read only for a sampled trace that is not yet checked and whose work is known`() {
        givenTraces(leaked, clean, gone, notAFork)
        alreadyChecked = setOf("f1")

        service.run(from, to, Random(1))

        assertEquals(listOf<Any?>("f2"), readAnswersOf())
    }

    @Test
    fun `a rate of zero samples nothing and a rate of one samples every eligible trace`() {
        givenTraces(leaked, clean, rate = 0.0)

        assertEquals(0, service.run(from, to, Random(1)))

        assertTrue(saved.isEmpty())
        verify(content, never()).leakReferences("w-1")
        assertTrue(aiCalls().isEmpty())
        assertTrue(readAnswersOf().isEmpty())
    }

    @Test
    fun `a fractional rate draws once per eligible trace in list order`() {
        val eligible = listOf(leaked, clean, objectAnswer, fork("f8", "w-1", "조용해요"), fork("f9", "w-1", "평온해요"), fork("f10", "w-1", "고요해요"))
        givenTraces(notAFork, *eligible.toTypedArray(), noWork, rate = 0.5)
        val mirror = Random(7)
        val expected = eligible.map { it.traceId }.filter { mirror.nextDouble() < 0.5 }

        service.run(from, to, Random(7))

        assertEquals(expected, saved.map { it.traceId })
        assertTrue(expected.isNotEmpty() && expected.size < eligible.size, "the seed must sample some but not all: " + expected)
    }

    @Test
    fun `a request that has no status is not sampled and a trace with several requests is drawn once`() {
        val waiting = fork("f7", "w-1", "한서진", status = null)
        val resumedFirst = fork("f8", "w-1", "조용해요", status = "success")
        val resumedAgain = Request(root("f8", "2026-11-19T00:30:00Z", status = "success", id = "again", metadata = mapOf("fork" to "true", "work_id" to "w-1")), "조용해요")
        givenTraces(waiting, resumedAgain, resumedFirst)

        service.run(from, to, Random(3))

        // A waiting request is not a finished one and its trace has no answer yet; the two finished requests of f8 are one trace with one draw.
        assertEquals(listOf("f8"), saved.map { it.traceId })
        assertEquals(listOf<Any?>("f8"), readAnswersOf())
    }

    @Test
    fun `a suspected answer raises the leak alert once per match without showing the titles`() {
        givenTraces(leaked, objectAnswer)
        verdicts["한서진"] = LeakVerdict(true, "그대로")

        service.run(from, to, Random(1))

        val raises = mockingDetails(raiser).invocations.filter { it.method.name == "raise" }
        assertEquals(1, raises.size)
        assertEquals("leak_suspected", raises[0].arguments[0])
        val message = raises[0].arguments[1] as String
        assertTrue(message.contains("w-1"), message)
        assertFalse(message.contains("한서진"), "an alert message never repeats the private title")
        assertNull(raises[0].arguments[2])
        assertEquals("f1", raises[0].arguments[3])
    }

    @Test
    fun `with the leak rule switched off or missing the result is saved but no alert is raised`() {
        for (state in listOf(false, null)) {
            saved.clear()
            reset(langfuse, content, settings, rules, raiser)
            givenTraces(leaked, leakRuleEnabled = state)
            verdicts["한서진"] = LeakVerdict(true, "그대로")

            assertEquals(1, service.run(from, to, Random(1)), state.toString())

            assertEquals(listOf(true), saved.map { it.suspected }, state.toString())
            verifyNoInteractions(raiser)
        }
    }

    @Test
    fun `a trace that already has a result is not checked or judged again`() {
        givenTraces(leaked, clean)
        alreadyChecked = setOf("f1")
        verdicts["한서진"] = LeakVerdict(true, "그대로")

        assertEquals(0, service.run(from, to, Random(1)))

        assertEquals(listOf("f2"), saved.map { it.traceId })
        assertTrue(aiCalls().isEmpty())
    }

    @Test
    fun `an AI or Content failure reaches the caller and keeps the results saved before it`() {
        givenTraces(clean, leaked)
        val failing = mock(AiClient::class.java) { throw ResponseStatusException(HttpStatus.BAD_GATEWAY) }
        val failingService = LeakSampleCheckService(langfuse, content, failing, settings, results, rules, raiser)

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { failingService.run(from, to, Random(1)) }.statusCode)
        assertEquals(listOf("f2"), saved.map { it.traceId })
        verifyNoInteractions(raiser)

        saved.clear()
        `when`(content.leakReferences("w-1")).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.run(from, to, Random(1)) }.statusCode)
        assertTrue(saved.isEmpty())
    }

    @Test
    fun `an answer that only repeats the question still goes to the judge and its verdict decides`() {
        // The user asked about 율도국, 백씨 and 12화 진실 and the answer only says there is no ground for them: the judge, who gets the question, finds no leak.
        val repeated = fork("f7", "w-1", "율도국과 백씨, 12화 진실에 대한 근거는 찾지 못했어요", input = asked("율도국에서 백씨는 누구야? 12화 진실도 알려 줘"))
        givenTraces(repeated)
        `when`(content.leakReferences("w-1")).thenReturn(LeakReferences("w-origin", listOf("율도국", "백씨"), listOf("12화 진실")))

        assertEquals(0, service.run(from, to, Random(1)))

        // Every title the text comparison found is saved as it was found, whether or not the question has it too.
        assertEquals(listOf(listOf("율도국", "백씨", "12화 진실")), saved.map { it.matched })
        assertEquals(listOf(false), saved.map { it.suspected })
        assertEquals(listOf("율도국과 백씨, 12화 진실에 대한 근거는 찾지 못했어요" to listOf("율도국", "백씨", "12화 진실")), aiCalls())
        assertEquals(listOf<Any?>("율도국에서 백씨는 누구야? 12화 진실도 알려 줘"), aiQuestions())
        verifyNoInteractions(raiser)
    }

    @Test
    fun `a title only the question shares with the answer still reaches the judge, which can find the leak behind it`() {
        // The user asked about 율도국 and the answer gives away what happens there: the one title found is in the question, the leak is in the rest.
        val leaking = fork("f7", "w-1", "길동은 율도국의 왕을 항복시키고 스스로 왕이 돼요", input = asked("율도국은 어떤 나라야?"))
        givenTraces(leaking)
        `when`(content.leakReferences("w-1")).thenReturn(LeakReferences("w-origin", listOf("율도국")))
        verdicts["율도국"] = LeakVerdict(true, "질문에 없는 비공개 줄거리를 말했어요")

        assertEquals(1, service.run(from, to, Random(1)))

        assertEquals(listOf(listOf("율도국")), saved.map { it.matched })
        assertEquals(listOf(true), saved.map { it.suspected })
        assertEquals(listOf("길동은 율도국의 왕을 항복시키고 스스로 왕이 돼요" to listOf("율도국")), aiCalls())
        assertEquals(listOf<Any?>("율도국은 어떤 나라야?"), aiQuestions())
        assertEquals(listOf<Any?>("f7"), mockingDetails(raiser).invocations.filter { it.method.name == "raise" }.map { it.arguments[3] })
    }

    @Test
    fun `a trace whose input has no usable request has no question and every match goes to the judge`() {
        val inputs = listOf(null, "그냥 글자", """{"message": "한서진이 누구야?"}""", """{"request": "   "}""", """{"request": 7}""", """{"request": null}""")
        givenTraces(*inputs.mapIndexed { i, input -> fork("q${i}", "w-1", "그 사람의 진짜 이름은 한서진이야", input = input) }.toTypedArray())

        service.run(from, to, Random(1))

        assertEquals(inputs.map { listOf("한서진") }, saved.map { it.matched })
        assertEquals(inputs.map { null }, aiQuestions())
    }
}
