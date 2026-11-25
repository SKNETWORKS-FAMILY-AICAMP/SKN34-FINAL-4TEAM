package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.client.InitialWorldCallFailure
import ai.storyfork.content.world.client.InitialWorldExtractionClient
import ai.storyfork.content.world.client.dto.WorldDocFillAiRequest
import ai.storyfork.content.world.service.dto.WorldDocFillResponse
import java.util.UUID
import org.springframework.stereotype.Service

/**
 * 인물 문서 채우기(docs/design/world-review-contract.md): 소유자의 저장된 인물 카드에서 비어 있는 IDENTITY·SOUL을, 연결된 소설의 저장 원고(미발행 포함, 이어받은 회차 제외)에서
 * 이름이 나온 곳의 발췌로 AI에게 채우게 한다. 돌려주는 것은 발췌에 글자 그대로 있는 문장(줄)뿐이다. 카드를 고치지도 결과를 저장하지도 않는다(제안은 화면 상태이고 작가가
 * 승인해 초안에 반영한 뒤 기존 세계관 저장으로 서버에 닿는다, DEC-36). AI는 트랜잭션 밖에서 부르고 이름이 원고 어디에도 없으면 AI를 부르지 않는다.
 * ponytail: 동기 호출이라 설정집 검토와 같은 시간 안(Content→AI 75초, nginx 90초)에 끝나야 한다. 카드 1장·모델 1회라 그 안이다.
 */
@Service
class WorldDocFillService(
    private val studio: WorldStudioService, private val ai: InitialWorldExtractionClient,
    private val links: WorkWorldService, private val episodes: EpisodeService,
) {
    fun fill(worldId: UUID, cardId: UUID, owner: UUID, consent: Boolean?): WorldDocFillResponse {
        if (consent != true) throw ContentFailure(422, "OpenAI 전송과 API 비용에 동의해 주세요.", "AI_CONSENT_REQUIRED")
        // 남의·지운 세계관은 여기서 WorldNotFound(404)다.
        val card = studio.draftForReview(worldId, owner).cards.firstOrNull { it.id == cardId && it.lifecycle == "active" }
            ?: throw ContentFailure(404, "설정 카드를 찾을 수 없어요.", "CARD_NOT_FOUND")
        if (card.cardType != "character") throw ContentFailure(422, "인물 카드만 원고로 채울 수 있어요.", "CARD_NOT_CHARACTER")
        val targets = WorldDocFillInput.targets(card)
        if (targets.isEmpty()) throw ContentFailure(409, "정체성과 성격·말투가 이미 채워져 있어요.", "DOCS_NOT_EMPTY")
        val work = links.linkedWorkIds(listOf(worldId))[worldId]
            ?: throw ContentFailure(409, "이 세계관에 연결된 소설이 없어 원고에서 근거를 찾을 수 없어요.", "WORLD_NOT_LINKED")
        // ponytail: 회차마다 모든 저장 버전을 읽어 마지막 것만 쓴다(최초 구축 입력과 같은 읽기). 버전이 아주 많은 작품은 느려질 수 있다.
        val saved = episodes.list(work, owner.toString()).items.filter { !it.inherited }.mapNotNull { episode -> episode.versions.lastOrNull()?.let { episode.number to it.body } }
        val passages = WorldDocFillInput.passages(WorldDocFillInput.names(card), saved)
        if (passages.isEmpty()) return WorldDocFillResponse(emptyList(), 0, "")
        val input = WorldDocFillAiRequest(card.id.toString(), card.title, card.aliases, targets, passages)
        val answer = try { ai.fill(input) } catch (e: InitialWorldCallFailure) { throw failure(e.code) }
        return try { WorldDocFillOutputValidation.parse(input, answer) } catch (_: IllegalArgumentException) { throw failure("AI_OUTPUT_INVALID") }
    }

    /** 기존 설정집 검토와 같은 오류 코드를 쓴다. 미설정은 503, 시간 초과는 504, 출력 오류와 그 밖(요청 거절·응답 미확인)은 502다. 성공이나 빈 결과로 숨기지 않는다. */
    private fun failure(code: String) = when (code) {
        "AI_NOT_CONFIGURED" -> ContentFailure(503, "원고로 채우기 제안을 사용할 수 없어요. 서버 설정을 확인해 주세요.", code)
        "AI_TIMEOUT" -> ContentFailure(504, "원고로 채우기 제안이 시간 안에 끝나지 않았어요. 잠시 뒤 다시 시도해 주세요.", code)
        else -> ContentFailure(502, "원고로 채우기 제안을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.", code)
    }
}
