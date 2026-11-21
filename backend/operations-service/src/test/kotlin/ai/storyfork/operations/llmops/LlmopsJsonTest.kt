package ai.storyfork.operations.llmops

import ai.storyfork.operations.llmops.service.dto.*
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.JsonNode

/** 계약의 응답 모양(필드 이름·순서)과 요청 본문 읽기를 고정한다. 값이 없는 선택 필드는 null로 나간다. */
class LlmopsJsonTest {
    private val at = Instant.parse("2026-11-19T01:00:00Z")

    private fun tree(value: Any): JsonNode = testMapper.readTree(testMapper.writeValueAsString(value))

    private fun JsonNode.names() = propertyNames().toList()

    @Test
    fun `a trace item and a trace detail have the contract fields`() {
        val item = TraceItem("t-1", at, "qa", "failed", 2500, 100, 20, 0.05, null, "w-1")
        val observation = TraceObservation("o-1", "llm", "GENERATION", at, null, 0, "gpt-5", 100, null, "ERROR", null, "qa/answer", 3, "o-0", json("""[{"role":"user"}]"""), null, json("""{"turn":"1"}"""))
        val detail = TraceDetail("t-1", at, "qa", "failed", 2500, 100, 20, 0.05, "user-1", "w-1", json("""{"q":"질문"}"""), null, listOf(observation))

        val itemTree = tree(TracePage(listOf(item), 0, 20, 57))
        val detailTree = tree(detail)

        assertEquals(listOf("items", "page", "size", "total"), itemTree.names())
        assertEquals(listOf("id", "timestamp", "feature", "status", "latencyMs", "inputTokens", "outputTokens", "cost", "userId", "workId"), itemTree.path("items").path(0).names())
        assertTrue(itemTree.path("items").path(0).path("userId").isNull)
        assertEquals("2026-11-19T01:00:00Z", itemTree.path("items").path(0).path("timestamp").asString())
        assertEquals(listOf("id", "timestamp", "feature", "status", "latencyMs", "inputTokens", "outputTokens", "cost", "userId", "workId", "input", "output", "observations"), detailTree.names())
        assertEquals("질문", detailTree.path("input").path("q").asString())
        assertTrue(detailTree.path("output").isNull)
        assertEquals(listOf("id", "name", "type", "startTime", "endTime", "latencyMs", "model", "inputTokens", "outputTokens", "level", "statusMessage", "promptName", "promptVersion",
            "parentObservationId", "input", "output", "metadata"), detailTree.path("observations").path(0).names())
        assertTrue(detailTree.path("observations").path(0).path("endTime").isNull)
        assertEquals(listOf("o-0", "user", true, "1"), detailTree.path("observations").path(0).let {
            listOf(it.path("parentObservationId").asString(), it.path("input").path(0).path("role").asString(), it.path("output").isNull, it.path("metadata").path("turn").asString())
        })
    }

    @Test
    fun `a pipeline and its records have the contract fields`() {
        val node = PipelineNode("guard", "Decision Guard", listOf("main"), false, 12, 1, null, listOf("decision_guard.judge"))
        val record = PipelineRecord("o-1", "t-1", "decision_guard", "SPAN", at, 120, "DEFAULT", null, null, null, null, json("""{"request":"질문"}"""), null, null)

        val pipeline = tree(Pipeline(listOf(node)))
        val page = tree(PipelineRecordPage(listOf(record), 0, 20, 41))

        assertEquals(listOf("nodes"), pipeline.names())
        assertEquals(listOf("id", "label", "next", "standalone", "count", "errors", "p95LatencyMs", "promptNames"), pipeline.path("nodes").path(0).names())
        assertTrue(pipeline.path("nodes").path(0).path("p95LatencyMs").isNull)
        assertEquals(listOf("items", "page", "size", "total"), page.names())
        assertEquals(listOf("id", "traceId", "name", "type", "startTime", "latencyMs", "level", "statusMessage", "model", "promptName", "promptVersion", "input", "output", "metadata"),
            page.path("items").path(0).names())
        assertEquals("질문", page.path("items").path(0).path("input").path("request").asString())
        assertTrue(page.path("items").path(0).path("output").isNull)
    }

    @Test
    fun `metrics rows and rates have the contract fields`() {
        val tree = tree(Metrics(listOf(MetricRow("2026-11-19", 4, 0.25, 0.0, 1000, 2000, 10, 20, 0.1, 0.2), MetricRow("qa", 0, null, null, null, null, 10, 20, 0.0, 0.2)), 0.6, null, null))

        assertEquals(listOf("rows", "adoptionRate", "approvalRate", "filterRestoreRate"), tree.names())
        assertEquals(listOf("key", "requests", "failureRate", "timeoutRate", "p50LatencyMs", "p95LatencyMs", "inputTokens", "outputTokens", "costUser", "costPlatform"), tree.path("rows").path(0).names())
        assertEquals(0.6, tree.path("adoptionRate").asDouble())
        assertTrue(tree.path("approvalRate").isNull)
        assertTrue(tree.path("filterRestoreRate").isNull)
        // A row without a finished request has no rates or latencies: the fields are there and null, never 0.
        val idle = tree.path("rows").path(1)
        assertEquals(tree.path("rows").path(0).names(), idle.names())
        assertEquals(listOf(true, true, true, true), listOf("failureRate", "timeoutRate", "p50LatencyMs", "p95LatencyMs").map { idle.path(it).isNull })
        assertEquals(0, idle.path("requests").asInt())
    }

    @Test
    fun `a prompt with its versions and evaluation has the contract fields`() {
        val tree = tree(PromptListResponse(listOf(Prompt("qa/answer", listOf(
            PromptVersion(2, listOf("production"), at, PromptEvaluation("run-1", true, at)), PromptVersion(1, emptyList(), null, null),
        )))))

        val prompt = tree.path("items").path(0)
        assertEquals(listOf("name", "versions"), prompt.names())
        assertEquals(listOf("version", "labels", "createdAt", "evaluation"), prompt.path("versions").path(0).names())
        assertEquals(listOf("runId", "passed", "createdAt"), prompt.path("versions").path(0).path("evaluation").names())
        assertTrue(prompt.path("versions").path(1).path("evaluation").isNull)
        assertTrue(prompt.path("versions").path(1).path("createdAt").isNull)
    }

    @Test
    fun `a model an evaluation a leak check and the settings have the contract fields`() {
        val model = tree(ModelListResponse(listOf(ModelResponse("m-1", "gpt-5", "^gpt-5$", 0.0000025, null, "TOKENS")))).path("items").path(0)
        val evaluation = tree(EvaluationListResponse(listOf(Evaluation("run-1", "qa-regression", "qa/answer", 3, "completed", true, at, listOf(EvaluationMetric("faithfulness", 0.9, 0.85, 0.05)))))).path("items").path(0)
        val started = tree(EvaluationStartedResponse("run-1", "qa-regression", "qa/answer", 3, "running"))
        val leak = tree(LeakCheckListResponse(listOf(LeakCheck(UUID.randomUUID(), "t-1", "w-1", at, listOf("한서진"), true, null)))).path("items").path(0)

        assertEquals(listOf("id", "modelName", "matchPattern", "inputPrice", "outputPrice", "unit"), model.names())
        assertTrue(model.path("outputPrice").isNull)
        assertEquals(listOf("runId", "dataset", "prompt", "version", "status", "passed", "createdAt", "metrics"), evaluation.names())
        assertEquals(listOf("name", "score", "baseline", "delta"), evaluation.path("metrics").path(0).names())
        assertEquals(listOf("runId", "dataset", "prompt", "version", "status"), started.names())
        assertEquals(listOf("id", "traceId", "workId", "checkedAt", "matched", "suspected", "reason"), leak.names())
        assertTrue(leak.path("reason").isNull)
        assertEquals(listOf("leakSampleRate"), tree(LlmopsSettings(0.1)).names())
    }

    @Test
    fun `request bodies read the contract JSON`() {
        val create = testMapper.readValue("""{"prompt":"새 프롬프트","type":"text","commitMessage":"정리"}""", PromptCreateRequest::class.java)
        val chat = testMapper.readValue("""{"prompt":[{"role":"system","content":"규칙"}],"type":"chat","config":{"temperature":0.2}}""", PromptCreateRequest::class.java)
        val bare = testMapper.readValue("""{"prompt":"x"}""", PromptCreateRequest::class.java)
        val promote = testMapper.readValue("""{"version":3}""", PromptPromoteRequest::class.java)
        val model = testMapper.readValue("""{"modelName":"gpt-5","matchPattern":"^gpt-5$","inputPrice":0.0000025}""", ModelCreateRequest::class.java)
        val evaluation = testMapper.readValue("""{"dataset":"qa-regression","prompt":"qa/answer","version":3}""", EvaluationRequest::class.java)
        val settings = testMapper.readValue("""{"leakSampleRate":0.2}""", LlmopsSettingsRequest::class.java)

        assertEquals("새 프롬프트", create.prompt?.asString())
        assertEquals("정리", create.commitMessage)
        assertTrue(chat.prompt?.isArray == true)
        assertEquals(0.2, chat.config?.path("temperature")?.asDouble())
        assertNull(bare.type)
        assertEquals(3, promote.version)
        assertEquals(ModelCreateRequest("gpt-5", "^gpt-5$", 0.0000025, null), model)
        assertEquals(EvaluationRequest("qa-regression", "qa/answer", 3), evaluation)
        assertEquals(0.2, settings.leakSampleRate)
    }
}
