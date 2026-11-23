package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.ModelService
import ai.storyfork.operations.llmops.service.dto.ModelCreateRequest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked Langfuse client: no network, Spring context or database. */
class ModelServiceTest {
    private val langfuse = mock(LangfuseClient::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val operators = Operators()
    private val service = ModelService(operators.permissions, langfuse, activities)

    @Test
    fun `only an operator with the llm permission reads or registers models`() {
        for (denied in listOf(operators.jobs, operators.none, operators.stale)) {
            assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { service.list(denied) }.statusCode)
            assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { service.create(denied, ModelCreateRequest("m", "^m$", 1.0, null)) }.statusCode)
        }

        verifyNoInteractions(langfuse, activities)
    }

    @Test
    fun `the list reads the prices from either Langfuse shape and defaults the unit to tokens`() {
        `when`(langfuse.models()).thenReturn(listOf(
            json("""{"id":"m-1","modelName":"gpt-5","matchPattern":"(?i)^gpt-5$","inputPrice":0.0000025,"outputPrice":0.00001,"unit":"TOKENS"}"""),
            json("""{"id":"m-2","modelName":"mini","matchPattern":"^mini$","prices":{"input":{"price":0.1},"output":{"price":0.4}}}"""),
            json("""{"id":"m-3","modelName":"free","matchPattern":"^free$","inputPrice":null,"outputPrice":null,"unit":"CHARACTERS"}"""),
        ))

        val items = service.list(operators.llm).items

        assertEquals(listOf("m-1", "m-2", "m-3"), items.map { it.id })
        assertEquals(listOf("gpt-5", "mini", "free"), items.map { it.modelName })
        assertEquals(listOf("(?i)^gpt-5$", "^mini$", "^free$"), items.map { it.matchPattern })
        assertEquals(listOf(0.0000025, 0.1, null), items.map { it.inputPrice })
        assertEquals(listOf(0.00001, 0.4, null), items.map { it.outputPrice })
        assertEquals(listOf("TOKENS", "TOKENS", "CHARACTERS"), items.map { it.unit })
    }

    @Test
    fun `a model is registered per token and recorded`() {
        `when`(langfuse.createModel(mapOf("modelName" to "gpt-5", "matchPattern" to "(?i)^gpt-5$", "unit" to "TOKENS", "inputPrice" to 0.0000025, "outputPrice" to 0.00001)))
            .thenReturn(json("""{"id":"m-9","modelName":"gpt-5","matchPattern":"(?i)^gpt-5$","inputPrice":0.0000025,"outputPrice":0.00001,"unit":"TOKENS"}"""))

        val created = service.create(operators.llm, ModelCreateRequest("gpt-5", "(?i)^gpt-5$", 0.0000025, 0.00001))

        assertEquals(listOf("m-9", "gpt-5", 0.0000025, 0.00001, "TOKENS"), listOf(created.id, created.modelName, created.inputPrice, created.outputPrice, created.unit))
        verify(activities).record(operators.llm, "MODEL_CREATE", "MODEL", "m-9", "gpt-5")
    }

    @Test
    fun `a price that is left out is not sent`() {
        `when`(langfuse.createModel(mapOf("modelName" to "m", "matchPattern" to "^m$", "unit" to "TOKENS", "outputPrice" to 0.5)))
            .thenReturn(json("""{"id":"m-1","modelName":"m","matchPattern":"^m$","outputPrice":0.5}"""))

        val created = service.create(operators.llm, ModelCreateRequest("m", "^m$", null, 0.5))

        assertNull(created.inputPrice)
        assertEquals(0.5, created.outputPrice)
    }

    @Test
    fun `an invalid model is 400 before Langfuse is written`() {
        val bad = listOf(
            ModelCreateRequest("", "^m$", 1.0, 1.0), ModelCreateRequest("m", " ", 1.0, 1.0), ModelCreateRequest("n".repeat(101), "^m$", 1.0, 1.0),
            ModelCreateRequest("m", "p".repeat(301), 1.0, 1.0), ModelCreateRequest("m", "^m$", null, null), ModelCreateRequest("m", "^m$", -1.0, null),
            ModelCreateRequest("m", "^m$", Double.NaN, 1.0), ModelCreateRequest("m", "^m$", 1.0, Double.POSITIVE_INFINITY),
        )
        for (request in bad) assertThrows(IllegalArgumentException::class.java) { service.create(operators.llm, request) }

        verifyNoInteractions(langfuse, activities)
    }
}
