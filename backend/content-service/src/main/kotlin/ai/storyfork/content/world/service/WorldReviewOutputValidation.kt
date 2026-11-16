package ai.storyfork.content.world.service

import ai.storyfork.content.world.client.dto.WorldReviewAiRequest
import ai.storyfork.content.world.service.dto.WorldReviewFinding
import tools.jackson.databind.DeserializationFeature
import tools.jackson.databind.MapperFeature
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/** AI 검토 응답에서 쓰는 부분. `reviewedCards` 같은 나머지 필드는 읽지 않는다(아는 필드만 다시 만들어 내보내므로 안전하다). */
data class WorldReviewAiOutput(val findings: List<WorldReviewFinding>, val model: String)

/**
 * AI가 돌려준 검토를 믿지 않고 Content가 보낸 카드와 다시 대조한다(docs/design/world-review-contract.md).
 * 어긋나면(읽을 수 없는 응답 포함) 입력 원문을 담지 않은 IllegalArgumentException이다.
 */
object WorldReviewOutputValidation {
    private val KINDS = setOf("contradiction", "doc_role", "missing_info", "other")
    private val TARGETS = setOf("body", "soul", "goal", "episode")
    private val mapper = JsonMapper.builder().addModule(KotlinModule.Builder().build())
        .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
        .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build()

    fun parse(sent: WorldReviewAiRequest, json: String): WorldReviewAiOutput = try {
        val output = requireNotNull(mapper.readValue(json, WorldReviewAiOutput::class.java))
        val cardTypes = sent.cards.associate { it.id to it.cardType }
        output.findings.forEach { verify(cardTypes, it) }
        output
    } catch (_: RuntimeException) {
        // 읽기 실패·널·형식 위반을 모두 같은 오류로 모은다. 예외 메시지에는 AI 응답 조각이 들어 있을 수 있어 버린다.
        throw IllegalArgumentException("INVALID_AI_OUTPUT")
    }

    private fun verify(cardTypes: Map<String, String>, finding: WorldReviewFinding) {
        require(finding.cardIds.size in 1..3 && finding.cardIds.all { it in cardTypes })
        require(finding.kind in KINDS)
        require(finding.message.isNotBlank() && finding.message.length <= 300)
        val fix = finding.fix ?: return
        require(fix.cardId in finding.cardIds && fix.target in TARGETS)
        // 회차는 episode 칸에만, 0 이상 정수로 있다. soul·goal·episode는 인물 카드에만 쓴다.
        require((fix.target == "episode") == (fix.episode != null) && (fix.episode ?: 0) >= 0)
        require(fix.target == "body" || cardTypes[fix.cardId] == "character")
        // 3,000자는 카드 본문 한도와 인물 문서 한도가 같다. 반영한 글이 저장 검증에서 거절되지 않게 한다.
        require(fix.text.isNotBlank() && fix.text.length <= 3000)
    }
}
