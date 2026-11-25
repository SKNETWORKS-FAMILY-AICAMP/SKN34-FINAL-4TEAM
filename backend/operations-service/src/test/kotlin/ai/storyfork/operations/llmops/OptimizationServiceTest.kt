package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.exception.OptimizationRunningException
import ai.storyfork.operations._common.exception.OptimizationUnsupportedException
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.OptimizationService
import ai.storyfork.operations.llmops.service.dto.OptimizationRequest
import ai.storyfork.operations.llmops.service.dto.OptimizationStartedResponse
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked Langfuse and AI clients: no network, Spring context or database. */
class OptimizationServiceTest {
    private val langfuse = mock(LangfuseClient::class.java)
    private val ai = mock(AiClient::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val operators = Operators()
    private val service = OptimizationService(operators.permissions, langfuse, ai, activities)
    private val act = "character_simulation.act"

    private fun givenVersion(type: String = "text") {
        `when`(langfuse.prompt(act, 2)).thenReturn(json("""{"name":"$act","version":2,"type":"$type","prompt":"본문","labels":[]}"""))
    }

    @Test
    fun `only an operator with the llm permission starts an optimization before anything is read`() {
        for (denied in listOf(operators.jobs, operators.none, operators.stale)) {
            assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { service.start(denied, act, OptimizationRequest(2, 150)) }.statusCode)
        }

        verifyNoInteractions(langfuse, ai, activities)
    }

    @Test
    fun `a prompt that is not optimizable is a 422 and nothing else is asked`() {
        assertThrows(OptimizationUnsupportedException::class.java) { service.start(operators.llm, "story_context.answer", OptimizationRequest(2, 150)) }

        verifyNoInteractions(langfuse, ai, activities)
    }

    @Test
    fun `the budget defaults to 150 and the prompt version and budget go to the AI service and the activity log`() {
        givenVersion()

        val started = service.start(operators.llm, act, OptimizationRequest(2, null))

        assertEquals(OptimizationStartedResponse(true, act, 2, 150), started)
        verify(ai).startOptimization(act, 2, 150)
        verify(activities).record(operators.llm, "PROMPT_OPTIMIZE", "PROMPT", act, "v2 · 150")
    }

    @Test
    fun `both prompts of the first targets are optimizable and 1 and 500 are the budget limits`() {
        `when`(langfuse.prompt("character_simulation.narrate", 1)).thenReturn(json("""{"version":1,"type":"text"}"""))
        givenVersion()

        assertEquals(500, service.start(operators.llm, act, OptimizationRequest(2, 500)).maxMetricCalls)
        assertEquals(1, service.start(operators.llm, act, OptimizationRequest(2, 1)).maxMetricCalls)
        assertEquals(150, service.start(operators.llm, "character_simulation.narrate", OptimizationRequest(1, null)).maxMetricCalls)
    }

    @Test
    fun `a budget outside 1 to 500 or a version below 1 is a 400 and the AI service is not asked`() {
        givenVersion()

        for (bad in listOf(OptimizationRequest(2, 0), OptimizationRequest(2, 501), OptimizationRequest(2, -5), OptimizationRequest(0, 150))) {
            assertThrows(IllegalArgumentException::class.java) { service.start(operators.llm, act, bad) }
        }

        verifyNoInteractions(ai, activities)
    }

    @Test
    fun `a version Langfuse does not have is a 404 and a chat version is unsupported, neither reaches the AI service`() {
        `when`(langfuse.prompt(act, 9)).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException::class.java) { service.start(operators.llm, act, OptimizationRequest(9, 150)) }.statusCode)

        givenVersion(type = "chat")
        assertThrows(OptimizationUnsupportedException::class.java) { service.start(operators.llm, act, OptimizationRequest(2, 150)) }

        verifyNoInteractions(ai, activities)
    }

    @Test
    fun `the AI service answering 409 is OPTIMIZATION_RUNNING and records nothing`() {
        givenVersion()
        doThrow(ResponseStatusException(HttpStatus.CONFLICT)).`when`(ai).startOptimization(act, 2, 150)

        assertThrows(OptimizationRunningException::class.java) { service.start(operators.llm, act, OptimizationRequest(2, 150)) }

        verifyNoInteractions(activities)
    }

    @Test
    fun `any other AI failure keeps its own status and records nothing`() {
        givenVersion()
        doThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY)).`when`(ai).startOptimization(act, 2, 150)

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.start(operators.llm, act, OptimizationRequest(2, 150)) }.statusCode)

        verifyNoInteractions(activities)
    }
}
