package ai.storyfork.content.writingai.service

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.context.service.QaScopeGrant
import ai.storyfork.content.context.service.QaScopeGrants
import ai.storyfork.content.context.service.QaScopeService
import ai.storyfork.content.context.service.dto.QaScopeRequest
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.writingai.client.WritingAiClient
import ai.storyfork.content.writingai.service.dto.ChatSessionCreated
import ai.storyfork.content.writingai.service.dto.WritingAiRequest
import ai.storyfork.content.writingai.service.dto.WritingAiResponse
import ai.storyfork.content.writingai.service.dto.WritingAiScene
import ai.storyfork.content.writingai.service.dto.WritingAiSimulation
import java.io.OutputStream
import java.util.UUID
import tools.jackson.databind.JsonNode

/**
 * 집필 AI 오케스트레이션의 Content 진입점. 로그인한 작가 본인으로 Q&A 조회 범위를 서명해 발급하고,
 * 대화는 작가·작품 scope에 묶는다. 새 턴과 resume 모두 토큰을 새로 발급해 저장된 토큰 만료와 무관하게 한다.
 * Writing 문맥·웹 조사 질문 같은 단계 입력은 AI가 입력 대기(waiting)로 멈춘 뒤 작가가 resume.inputs로 채운다.
 * 새 턴은 Writing 반영 대상(작품·회차)을, 모든 요청은 작가의 Bearer를 함께 보낸다. Writing 결과를 작가가 resume으로
 * 승인하면 AI가 그 Bearer로 Content MCP `episode_update_draft`를 호출하고, 인가·revision 확인은 기존 Service가 한다.
 *
 * 대화 세션(#331)은 AI의 LangGraph 체크포인터에만 저장한다. Content는 작품 권한을 확인하고 scope를 붙여 중계할 뿐
 * 대화 테이블을 두지 않는다. 다른 작가·작품의 대화는 AI가 scope 불일치로 404를 준다.
 */
internal class WritingAiService(
    private val scopes: QaScopeService,
    private val grants: QaScopeGrants,
    private val client: WritingAiClient,
    private val access: WorkAccessService,
) {
    fun run(workId: String, owner: String, authorization: String, request: WritingAiRequest): WritingAiResponse {
        checkContent(request.resume == null || request.threadId != null, message="이어갈 대화를 지정해 주세요.")
        val threadId = request.threadId ?: UUID.randomUUID().toString()
        return WritingAiResponse(threadId, client.orchestrate(message(workId, owner, threadId, request), authorization))
    }

    fun relay(body: Map<String, Any?>, authorization: String, out: OutputStream) = client.stream(body, authorization, out)

    fun open(workId: String, owner: String): ChatSessionCreated {
        access.own(workId, owner)
        return ChatSessionCreated(UUID.randomUUID().toString())
    }

    fun sessions(workId: String, owner: String): JsonNode = client.sessions(owned(workId, owner))
    fun history(workId: String, owner: String, threadId: String): JsonNode = client.history(threadId, owned(workId, owner))
    fun rename(workId: String, owner: String, threadId: String, title: String) = client.rename(threadId, owned(workId, owner), title)
    fun delete(workId: String, owner: String, threadId: String) = client.delete(threadId, owned(workId, owner))
    fun truncate(workId: String, owner: String, threadId: String, index: Int) =
        client.truncate(threadId, owned(workId, owner), index)

    private fun owned(workId: String, owner: String): String {
        access.own(workId, owner)
        return scopeOf(workId, owner)
    }

    private fun scopeOf(workId: String, owner: String) = "user:$owner/work:$workId"

    /** 장면 조작(resume.scene). 보낸 항목만 담는다. AI 요청 DTO가 모르는 필드를 거절하므로 null 필드를 싣지 않는다. */
    private fun body(scene: WritingAiScene) = buildMap<String, Any?> {
        put("action", scene.action)
        scene.turn?.let { put("turn", it) }
        scene.text?.let { put("text", it) }
        scene.note?.let { put("note", it) }
    }

    /** 시뮬레이션 시작 양식(simulation). 위와 같은 이유로 보낸 항목만 담는다. */
    private fun body(form: WritingAiSimulation) = buildMap<String, Any?> {
        put("mode", form.mode)
        form.premise?.let { put("premise", it) }
        form.beats?.let { put("beats", it) }
        put("characterIds", form.characterIds)
    }

    /** AI 요청 본문. 검증·권한 실패는 SSE 응답 헤더를 보내기 전에 여기서 HTTP 오류가 된다. fromTurn은 메시지 수정이다. */
    fun message(workId: String, owner: String, threadId: String, request: WritingAiRequest, fromTurn: Int? = null): Map<String, Any?> {
        checkContent(request.consent, message="OpenAI 전송과 API 비용에 동의해 주세요.")
        checkContent((request.request == null) != (request.resume == null), message="새 요청과 이어가기 중 하나만 보내 주세요.")
        checkContent(fromTurn == null || request.resume == null, message="메시지 수정은 새 요청으로만 보낼 수 있어요.")
        request.simulation?.let { form ->
            checkContent(request.operation == "character_simulation" && request.resume == null,
                message="시뮬레이션 설정은 시뮬레이션 새 요청에서만 보낼 수 있어요.")
            checkContent(form.beats.orEmpty().all { it.length in 1..200 } && form.characterIds.all { it.length in 1..100 },
                message="시뮬레이션 비트는 200자, 인물 id는 100자 이하의 글이어야 해요.")
        }
        if (request.resume == null) {
            // 모델 호출 전에 권한 밖 작품·회차를 막는다. 실제 근거 조회 때 Content가 다시 확정한다.
            scopes.resolve(workId, owner, QaScopeRequest(request.episode, request.episodeVersionId,
                if (request.target == "relationship") "manuscript" else request.target))
        }
        val scope = mapOf("scopeToken" to grants.issue(
            QaScopeGrant(workId, owner, request.episode, request.episodeVersionId, request.target)))
        return buildMap {
            put("conversation", mapOf("threadId" to threadId, "scope" to scopeOf(workId, owner)))
            if (request.resume != null) {
                put("resume", buildMap {
                    put("approved", request.resume.approved)
                    put("scope", scope)
                    request.resume.inputs?.let { put("inputs", it) }
                    request.resume.scene?.let { put("scene", body(it)) }
                })
            } else {
                put("request", request.request)
                put("scope", scope)
                put("target", mapOf("workId" to workId, "episode" to request.episode))
                request.operation?.let { put("operation", it) }
                request.simulation?.let { put("simulation", body(it)) }
                fromTurn?.let { put("fromTurn", it) }
            }
        }
    }
}
