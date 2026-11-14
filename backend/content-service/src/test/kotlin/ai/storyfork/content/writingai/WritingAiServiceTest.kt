package ai.storyfork.content.writingai

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.context.service.QaScopeGrant
import ai.storyfork.content.context.service.QaScopeGrants
import ai.storyfork.content.context.service.QaScopeService
import ai.storyfork.content.context.service.dto.QaScope
import ai.storyfork.content.context.service.dto.QaScopeRequest
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.writingai.client.WritingAiClient
import ai.storyfork.content.writingai.service.WritingAiService
import ai.storyfork.content.writingai.service.dto.WritingAiRequest
import ai.storyfork.content.writingai.service.dto.WritingAiResume
import ai.storyfork.content.writingai.service.dto.WritingAiScene
import ai.storyfork.content.writingai.service.dto.WritingAiSimulation
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.*
import tools.jackson.databind.json.JsonMapper

class WritingAiServiceTest {
    private val scopes = mock(QaScopeService::class.java)
    private val client = mock(WritingAiClient::class.java)
    private val grants = QaScopeGrants()
    private val access = mock(WorkAccessService::class.java)
    private val service = WritingAiService(scopes, grants, client, access)
    private val result = JsonMapper.builder().build().readTree("""{"status":"completed"}""")
    private val ask = WritingAiRequest(request = "길드 규칙은?", episode = 2, episodeVersionId = "r2", consent = true)

    @Suppress("UNCHECKED_CAST")
    private fun sent(): Map<String, Any?> {
        val body = ArgumentCaptor.forClass(Map::class.java)
        verify(client).orchestrate(body.capture() as Map<String, Any?>? ?: emptyMap(), eq("Bearer user") ?: "")
        return body.value as Map<String, Any?>
    }

    private fun token(scope: Any?) = (scope as Map<*, *>)["scopeToken"] as String

    @Test
    fun `new turn issues a scope token bound to the signed-in author and forwards the author's bearer`() {
        `when`(scopes.resolve("work", "owner", QaScopeRequest(2, "r2", "manuscript"))).thenReturn(
            QaScope("work", null, 2, "r2", emptyList(), null))
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        val response = service.run("work", "owner", "Bearer user", ask)
        assertEquals(result, response.result)
        val body = sent()
        assertEquals("길드 규칙은?", body["request"])
        assertEquals(mapOf("threadId" to response.threadId, "scope" to "user:owner/work:work"), body["conversation"])
        assertEquals(QaScopeGrant("work", "owner", 2, "r2"), grants.read(token(body["scope"])))
        assertEquals(mapOf("workId" to "work", "episode" to 2), body["target"])
    }

    @Test
    fun `resume sends a fresh scope token without a new request`() {
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        service.run("work", "owner", "Bearer user", ask.copy(request = null, resume = WritingAiResume(true), threadId = "thread"))
        val body = sent()
        assertFalse("request" in body)
        val resume = body["resume"] as Map<*, *>
        assertEquals(true, resume["approved"])
        assertEquals("owner", grants.read(token(resume["scope"]))?.owner)
        assertEquals("thread", (body["conversation"] as Map<*, *>)["threadId"])
    }

    @Test
    fun `missing consent ambiguous input or resume without thread never reach the model`() {
        for (bad in listOf(ask.copy(consent = false), ask.copy(resume = WritingAiResume(true)),
            ask.copy(request = null), ask.copy(request = null, resume = WritingAiResume(false)))) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.run("work", "owner", "Bearer user", bad) }.status)
        }
        verifyNoInteractions(client, scopes)
    }

    // 대화 세션(#331): 작품 권한을 확인한 뒤 작가·작품 scope로만 AI 세이버의 대화를 다룬다.
    private val scope = "user:owner/work:work"

    @Test
    fun `session reads and changes are bound to the signed-in author and work`() {
        `when`(client.sessions(scope)).thenReturn(result)
        `when`(client.history("thread", scope)).thenReturn(result)
        assertEquals(result, service.sessions("work", "owner"))
        assertEquals(result, service.history("work", "owner", "thread"))
        service.rename("work", "owner", "thread", "새 제목")
        service.delete("work", "owner", "thread")
        service.truncate("work", "owner", "thread", 2)
        verify(access, times(5)).own("work", "owner")
        verify(client).rename("thread", scope, "새 제목")
        verify(client).delete("thread", scope)
        verify(client).truncate("thread", scope, 2)
    }

    @Test
    fun `another author's work never reaches the AI`() {
        `when`(access.own("work", "intruder")).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.sessions("work", "intruder") }.status)
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.open("work", "intruder") }.status)
        verifyNoInteractions(client)
    }

    @Test
    fun `a new session id is issued only for an owned work`() {
        val first = service.open("work", "owner").threadId
        assertNotEquals(first, service.open("work", "owner").threadId)
        verify(access, times(2)).own("work", "owner")
    }

    @Test
    fun `message body uses the path thread and edits rerun from the chosen turn`() {
        `when`(scopes.resolve("work", "owner", QaScopeRequest(2, "r2", "manuscript"))).thenReturn(
            QaScope("work", null, 2, "r2", emptyList(), null))
        val body = service.message("work", "owner", "thread", ask.copy(threadId = "ignored"), fromTurn = 1)
        assertEquals(mapOf("threadId" to "thread", "scope" to scope), body["conversation"])
        assertEquals(1, body["fromTurn"])
        assertFalse("fromTurn" in service.message("work", "owner", "thread", ask))
    }

    @Test
    fun `resume forwards the inputs the author filled in`() {
        val inputs = JsonMapper.builder().build().readTree("""{"web_research":{"question":"한양에서 동래까지?"}}""")
        val body = service.message("work", "owner", "thread", ask.copy(request = null, resume = WritingAiResume(true, inputs)))
        assertEquals(inputs, (body["resume"] as Map<*, *>)["inputs"])
    }

    // 시뮬레이션 무대의 장면 조작(resume.scene): 형식·길이만 확인해 AI로 그대로 넘긴다. 조작별 필수 필드는 AI가 다시 확인한다.
    private fun resumed(scene: WritingAiScene?) = service.message("work", "owner", "thread",
        ask.copy(request = null, resume = WritingAiResume(true, scene = scene)))["resume"] as Map<*, *>

    @Test
    fun `resume forwards the scene action of the stage with only the fields that were sent`() {
        assertEquals(mapOf("action" to "next"), resumed(WritingAiScene("next"))["scene"])
        assertEquals(mapOf("action" to "next", "note" to "갑자기 정전이 된다"), resumed(WritingAiScene("next", note = "갑자기 정전이 된다"))["scene"])
        assertEquals(mapOf("action" to "edit", "turn" to 2, "text" to "고친 글"), resumed(WritingAiScene("edit", turn = 2, text = "고친 글"))["scene"])
        assertEquals(mapOf("action" to "redo", "turn" to 0, "note" to "더 차갑게"), resumed(WritingAiScene("redo", turn = 0, note = "더 차갑게"))["scene"])
        assertEquals(mapOf("action" to "stop"), resumed(WritingAiScene("stop"))["scene"])
        assertEquals(true, resumed(WritingAiScene("stop"))["approved"])  // approved는 그대로 함께 간다(AI가 scene을 먼저 처리한다)
        assertFalse("scene" in resumed(null))
    }

    @Test
    fun `request validation bounds the scene action and its fields`() {
        jakarta.validation.Validation.buildDefaultValidatorFactory().use { factory ->
            val validator = factory.validator
            fun problems(scene: WritingAiScene) = validator.validate(ask.copy(request = null, resume = WritingAiResume(true, scene = scene)))
                .map { it.propertyPath.toString() }
            assertTrue(problems(WritingAiScene("edit", turn = 0, text = "가".repeat(2000))).isEmpty())
            assertTrue(problems(WritingAiScene("next", note = "가".repeat(300))).isEmpty())
            assertEquals(listOf("resume.scene.action"), problems(WritingAiScene("jump")))
            assertEquals(listOf("resume.scene.turn"), problems(WritingAiScene("redo", turn = -1)))
            assertEquals(listOf("resume.scene.text"), problems(WritingAiScene("edit", turn = 1, text = "가".repeat(2001))))
            assertEquals(listOf("resume.scene.note"), problems(WritingAiScene("next", note = "가".repeat(301))))
        }
    }

    // [시뮬레이션] 버튼의 시작 양식(simulation): operation이 character_simulation인 새 요청에서만 받아 AI로 그대로 넘긴다.
    private val button = ask.copy(request = "흐름 모드 시뮬레이션: 장면 계획 3개", operation = "character_simulation",
        simulation = WritingAiSimulation("flow", beats = listOf("성문 대면", "숨긴 정체"), characterIds = listOf("k", "l")))

    private fun scopeResolves() = `when`(scopes.resolve("work", "owner", QaScopeRequest(2, "r2", "manuscript"))).thenReturn(
        QaScope("work", null, 2, "r2", emptyList(), null))

    @Test
    fun `the simulation form of the button reaches the AI as it is with the operation`() {
        scopeResolves()
        val body = service.message("work", "owner", "thread", button)
        assertEquals("character_simulation", body["operation"])
        assertEquals(mapOf("mode" to "flow", "beats" to listOf("성문 대면", "숨긴 정체"), "characterIds" to listOf("k", "l")), body["simulation"])
        val premise = WritingAiSimulation("if", premise = "만약 북문이 열려 있었다면?", characterIds = listOf("k"))
        assertEquals(mapOf("mode" to "if", "premise" to "만약 북문이 열려 있었다면?", "characterIds" to listOf("k")),
            service.message("work", "owner", "thread", button.copy(simulation = premise))["simulation"])
        assertFalse("simulation" in service.message("work", "owner", "thread", ask))
    }

    @Test
    fun `a simulation form is refused unless the request is a new character_simulation operation`() {
        for (bad in listOf(button.copy(operation = null), button.copy(operation = "writing_editing"),
            button.copy(request = null, resume = WritingAiResume(true), threadId = "thread"))) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.message("work", "owner", "thread", bad) }.status)
        }
        verifyNoInteractions(scopes)  // 권한 확인 전에 형식부터 막는다
    }

    @Test
    fun `simulation form items over their limits never get past the service`() {
        scopeResolves()
        val form = button.simulation!!
        for (bad in listOf(form.copy(beats = listOf("")), form.copy(beats = listOf("가".repeat(201))), form.copy(characterIds = listOf("")),
            form.copy(characterIds = listOf("i".repeat(101))))) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.message("work", "owner", "thread", button.copy(simulation = bad)) }.status)
        }
        val edge = form.copy(beats = listOf("가".repeat(200)), characterIds = listOf("i".repeat(100)))
        assertEquals(listOf("가".repeat(200)), (service.message("work", "owner", "thread", button.copy(simulation = edge))["simulation"] as Map<*, *>)["beats"])
    }

    @Test
    fun `request validation bounds the mode and the sizes of the simulation form`() {
        jakarta.validation.Validation.buildDefaultValidatorFactory().use { factory ->
            val validator = factory.validator
            val form = button.simulation!!
            fun problems(simulation: WritingAiSimulation) = validator.validate(button.copy(simulation = simulation)).map { it.propertyPath.toString() }
            assertTrue(validator.validate(button).isEmpty())
            assertTrue(validator.validate(button.copy(simulation = form.copy(beats = List(8) { "비트" }, characterIds = List(6) { "id$it" }))).isEmpty())
            assertEquals(listOf("simulation.mode"), problems(form.copy(mode = "story")))
            assertEquals(listOf("simulation.premise"), problems(form.copy(premise = "가".repeat(501))))
            assertEquals(listOf("simulation.beats"), problems(form.copy(beats = List(9) { "비트" })))
            assertEquals(listOf("simulation.characterIds"), problems(form.copy(characterIds = emptyList())))
            assertEquals(listOf("simulation.characterIds"), problems(form.copy(characterIds = List(7) { "id$it" })))
        }
    }

    @Test
    fun `an edit is always a new request, never a resume`() {
        val failure = assertThrows(ContentFailure::class.java) {
            service.message("work", "owner", "thread", ask.copy(request = null, resume = WritingAiResume(true)), fromTurn = 1)
        }
        assertEquals(422, failure.status)
    }
}
