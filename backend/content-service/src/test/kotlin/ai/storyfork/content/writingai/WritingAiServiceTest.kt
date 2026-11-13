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

    @Test
    fun `an edit is always a new request, never a resume`() {
        val failure = assertThrows(ContentFailure::class.java) {
            service.message("work", "owner", "thread", ask.copy(request = null, resume = WritingAiResume(true)), fromTurn = 1)
        }
        assertEquals(422, failure.status)
    }
}
