package ai.storyfork.content.writingai.service

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.context.service.QaScopeGrant
import ai.storyfork.content.context.service.QaScopeGrants
import ai.storyfork.content.context.service.QaScopeService
import ai.storyfork.content.context.service.dto.QaScopeRequest
import ai.storyfork.content.writingai.client.WritingAiClient
import ai.storyfork.content.writingai.service.dto.WritingAiRequest
import ai.storyfork.content.writingai.service.dto.WritingAiResponse
import java.util.UUID

/**
 * 집필 AI 오케스트레이션의 Content 진입점. 로그인한 작가 본인으로 Q&A 조회 범위를 서명해 발급하고,
 * 대화는 작가·작품 scope에 묶는다. 새 턴과 resume 모두 토큰을 새로 발급해 저장된 토큰 만료와 무관하게 한다.
 * 단계 입력(Writing 문맥·웹 조사 질문)은 아직 보내지 않으므로 그 단계는 AI에서 입력 대기(waiting)가 된다.
 * 새 턴은 Writing 반영 대상(작품·회차)을, 모든 요청은 작가의 Bearer를 함께 보낸다. Writing 결과를 작가가 resume으로
 * 승인하면 AI가 그 Bearer로 Content MCP `episode_update_draft`를 호출하고, 인가·revision 확인은 기존 Service가 한다.
 */
internal class WritingAiService(
    private val scopes: QaScopeService,
    private val grants: QaScopeGrants,
    private val client: WritingAiClient,
) {
    fun run(workId: String, owner: String, authorization: String, request: WritingAiRequest): WritingAiResponse {
        checkContent(request.consent, message="OpenAI 전송과 API 비용에 동의해 주세요.")
        checkContent((request.request == null) != (request.resume == null), message="새 요청과 이어가기 중 하나만 보내 주세요.")
        checkContent(request.resume == null || request.threadId != null, message="이어갈 대화를 지정해 주세요.")
        if (request.resume == null) {
            // 모델 호출 전에 권한 밖 작품·회차를 막는다. 실제 근거 조회 때 Content가 다시 확정한다.
            scopes.resolve(workId, owner, QaScopeRequest(request.episode, request.episodeVersionId,
                if (request.target == "relationship") "manuscript" else request.target))
        }
        val threadId = request.threadId ?: UUID.randomUUID().toString()
        val scope = mapOf("scopeToken" to grants.issue(
            QaScopeGrant(workId, owner, request.episode, request.episodeVersionId, request.target)))
        val body = buildMap {
            put("conversation", mapOf("threadId" to threadId, "scope" to "user:$owner/work:$workId"))
            if (request.resume != null) {
                put("resume", mapOf("approved" to request.resume.approved, "scope" to scope))
            } else {
                put("request", request.request)
                put("scope", scope)
                put("target", mapOf("workId" to workId, "episode" to request.episode))
                request.operation?.let { put("operation", it) }
            }
        }
        return WritingAiResponse(threadId, client.orchestrate(body, authorization))
    }
}
