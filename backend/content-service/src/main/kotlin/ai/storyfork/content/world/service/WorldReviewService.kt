package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.world.client.InitialWorldCallFailure
import ai.storyfork.content.world.client.InitialWorldExtractionClient
import ai.storyfork.content.world.service.dto.WorldReviewResponse
import java.util.UUID
import org.springframework.stereotype.Service

/**
 * 설정집 AI 검토(docs/design/world-review-contract.md): 소유자의 저장된 현재 초안을 AI에 보내 지적과 수정안을 받아 돌려준다.
 * 아무것도 저장하지 않고 카드를 고치지 않는다(수정안은 작가가 승인해 화면이 초안에 반영한다, DEC-36). 트랜잭션 밖에서 AI를 부른다.
 * ponytail: 동기 호출이라 Content→AI 읽기 제한(75초, InitialWorldExtractionConfig)과 nginx 90초 안에 끝나야 한다. 넘으면 초기 분석처럼 비동기 작업으로 바꾼다.
 */
@Service
class WorldReviewService(private val studio: WorldStudioService, private val ai: InitialWorldExtractionClient) {
    fun review(worldId: UUID, owner: UUID, consent: Boolean?): WorldReviewResponse {
        if (consent != true) throw ContentFailure(422, "OpenAI 전송과 API 비용에 동의해 주세요.", "AI_CONSENT_REQUIRED")
        val draft = studio.draftForReview(worldId, owner)
        val input = WorldReviewInput.fromDraft(draft)
        val total = draft.cards.count { it.lifecycle == "active" }
        // 보낼 카드가 없으면 AI를 부르지 않는다. 모델을 쓰지 않았으니 model은 비운다.
        if (input.cards.isEmpty()) return WorldReviewResponse(draft.draftRevision, 0, total, emptyList(), "")
        val answer = try { ai.review(input) } catch (e: InitialWorldCallFailure) { throw failure(e.code) }
        val output = try { WorldReviewOutputValidation.parse(input, answer) } catch (_: IllegalArgumentException) { throw failure("AI_OUTPUT_INVALID") }
        return WorldReviewResponse(draft.draftRevision, input.cards.size, total, output.findings, output.model)
    }

    /** 기존 초기 분석의 오류 코드를 그대로 쓴다. 미설정은 503, 시간 초과는 504, 출력 오류와 그 밖(요청 거절·응답 미확인)은 502다. 성공이나 빈 결과로 숨기지 않는다. */
    private fun failure(code: String) = when (code) {
        "AI_NOT_CONFIGURED" -> ContentFailure(503, "AI 검토를 사용할 수 없어요. 서버 설정을 확인해 주세요.", code)
        "AI_TIMEOUT" -> ContentFailure(504, "AI 검토가 시간 안에 끝나지 않았어요. 잠시 뒤 다시 시도해 주세요.", code)
        else -> ContentFailure(502, "AI 검토를 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.", code)
    }
}
