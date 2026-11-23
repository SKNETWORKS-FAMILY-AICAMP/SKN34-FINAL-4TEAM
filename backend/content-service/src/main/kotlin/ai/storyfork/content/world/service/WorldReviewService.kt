package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.world.client.InitialWorldCallFailure
import ai.storyfork.content.world.client.InitialWorldExtractionClient
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import ai.storyfork.content.world.service.dto.WorldReviewFinding
import ai.storyfork.content.world.service.dto.WorldReviewResponse
import ai.storyfork.content.world.studio.entity.WorldReviewResult
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import ai.storyfork.content.world.studio.repository.WorldReviewResultRepository
import ai.storyfork.content.world.studio.repository.lockAccessible
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

/**
 * 설정집 AI 검토(docs/design/world-review-contract.md): 소유자의 저장된 현재 초안을 AI에 보내 지적과 수정안을 받고, 세계관마다 마지막 결과 하나로 저장해 돌려준다.
 * 카드를 고치지 않는다(수정안은 작가가 승인해 화면이 초안에 반영한다, DEC-36). AI는 트랜잭션 밖에서 부르고 저장은 소유 세계관을 잠근 짧은 WorldStudio 트랜잭션 하나다.
 * AI 호출·응답 검증이 실패하면 아무것도 저장하지 않아 이전 결과가 남는다.
 * ponytail: 동기 호출이라 Content→AI 읽기 제한(75초, InitialWorldExtractionConfig)과 nginx 90초 안에 끝나야 한다. 넘으면 초기 분석처럼 비동기 작업으로 바꾼다.
 */
@Service
class WorldReviewService(
    private val studio: WorldStudioService, private val ai: InitialWorldExtractionClient,
    private val worlds: StudioWorldRepository, private val results: WorldReviewResultRepository,
    @Qualifier("worldStudioTransactionManager") manager: PlatformTransactionManager, private val mapper: JsonMapper,
) {
    private val transaction = TransactionTemplate(manager)
    /** 남의·지운 세계관은 비소유자와 같이 없는 것이다(소프트 삭제 포함). */
    private fun owned(id: UUID, subject: UUID) = worlds.lockAccessible(id, subject) ?: throw WorldNotFound()

    fun review(worldId: UUID, owner: UUID, consent: Boolean?): WorldReviewResponse {
        if (consent != true) throw ContentFailure(422, "OpenAI 전송과 API 비용에 동의해 주세요.", "AI_CONSENT_REQUIRED")
        val draft = studio.draftForReview(worldId, owner)
        val input = WorldReviewInput.fromDraft(draft)
        val total = draft.cards.count { it.lifecycle == "active" }
        // 보낼 카드가 없으면 AI를 부르지 않는다. 모델을 쓰지 않았으니 model은 비우고, 빈 검토도 마지막 결과로 저장한다.
        if (input.cards.isEmpty()) return store(worldId, owner, draft, 0, total, emptyList(), "")
        val answer = try { ai.review(input) } catch (e: InitialWorldCallFailure) { throw failure(e.code) }
        val output = try { WorldReviewOutputValidation.parse(input, answer) } catch (_: IllegalArgumentException) { throw failure("AI_OUTPUT_INVALID") }
        return store(worldId, owner, draft, input.cards.size, total, output.findings, output.model)
    }

    /** 마지막 검토를 [review] 응답과 같은 모양으로 돌려준다. 남의·지운 세계관은 404(WorldNotFound), 저장된 검토가 없으면 404 WORLD_REVIEW_NOT_FOUND다. */
    fun latest(worldId: UUID, owner: UUID): WorldReviewResponse {
        val row = transaction.execute { owned(worldId, owner); results.findById(worldId).orElse(null) }
            ?: throw ContentFailure(404, "저장된 AI 검토가 없어요.", "WORLD_REVIEW_NOT_FOUND")
        return mapper.convertValue(row.result + ("reviewedAt" to row.reviewedAt.toString()), WorldReviewResponse::class.java)
    }

    /** 성공한 검토를 세계관의 마지막 결과로 덮어쓴다(같은 잠금 안에서 있으면 갱신·없으면 삽입). 시각은 reviewed_at 열에만 두고 result에는 넣지 않는다. */
    private fun store(worldId: UUID, owner: UUID, draft: WorldDraftResponse, reviewed: Int, total: Int, findings: List<WorldReviewFinding>, model: String): WorldReviewResponse {
        // DB 정밀도(마이크로초)를 넘지 않게 밀리초로 자르면 저장 직후 응답과 나중의 latest 응답이 같은 문자열이다.
        val reviewedAt = Instant.now().truncatedTo(ChronoUnit.MILLIS)
        val response = WorldReviewResponse(draft.draftRevision, reviewed, total, findings, model, reviewedAt.toString(), WorldReviewInput.basis(draft, findings))
        val result = json(response) - "reviewedAt"
        transaction.executeWithoutResult { owned(worldId, owner); results.save(WorldReviewResult(worldId, result, reviewedAt)) }
        return response
    }

    @Suppress("UNCHECKED_CAST")
    // Hibernate의 jsonb 깊은 복사와 같은 숫자 타입으로 만들려고 convertValue 대신 직렬화한 바이트를 다시 읽는다(InitialWorldAnalysisService.json과 같다).
    private fun json(value: Any): Map<String, Any?> = mapper.readValue(mapper.writeValueAsBytes(value), Map::class.java) as Map<String, Any?>

    /** 기존 초기 분석의 오류 코드를 그대로 쓴다. 미설정은 503, 시간 초과는 504, 출력 오류와 그 밖(요청 거절·응답 미확인)은 502다. 성공이나 빈 결과로 숨기지 않는다. */
    private fun failure(code: String) = when (code) {
        "AI_NOT_CONFIGURED" -> ContentFailure(503, "AI 검토를 사용할 수 없어요. 서버 설정을 확인해 주세요.", code)
        "AI_TIMEOUT" -> ContentFailure(504, "AI 검토가 시간 안에 끝나지 않았어요. 잠시 뒤 다시 시도해 주세요.", code)
        else -> ContentFailure(502, "AI 검토를 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.", code)
    }
}
