package ai.storyfork.content.world.service

import ai.storyfork.content.world.client.dto.WorldDocFillAiRequest
import ai.storyfork.content.world.service.dto.WorldDocFillResponse

/**
 * AI가 돌려준 줄을 믿지 않고 Content가 보낸 발췌와 다시 대조한다(docs/design/world-review-contract.md): 줄은 채우라고 한 문서의 것이고, 보낸 그 회차의 한 발췌 안에
 * 글자 그대로 있는 300자 이하 문장이며, IDENTITY(`body`)는 첫 등장 회차(발췌 가운데 가장 작은 회차)의 문장이고, 문서마다 8줄 이하다. 어긋나면(읽을 수 없는 응답 포함)
 * 입력 원문을 담지 않은 IllegalArgumentException이다.
 */
object WorldDocFillOutputValidation {
    private val KINDS = setOf("fact", "description")
    private const val MAX_QUOTE = 300
    private const val MAX_LINES = 8

    fun parse(sent: WorldDocFillAiRequest, json: String): WorldDocFillResponse = try {
        val output = requireNotNull(WorldReviewOutputValidation.mapper.readValue(json, WorldDocFillResponse::class.java))
        val first = sent.passages.minOf { it.episode }
        output.lines.forEach { line ->
            require(line.target in sent.targets && line.kind in KINDS && line.quote.isNotBlank() && line.quote.length <= MAX_QUOTE)
            require(line.target != "body" || line.episode == first)
            require(sent.passages.any { it.episode == line.episode && line.quote in it.text })
        }
        require(sent.targets.all { target -> output.lines.count { it.target == target } <= MAX_LINES })
        output
    } catch (_: RuntimeException) {
        // 읽기 실패·널·형식 위반을 모두 같은 오류로 모은다. 예외 메시지에는 AI 응답 조각이 들어 있을 수 있어 버린다.
        throw IllegalArgumentException("INVALID_AI_OUTPUT")
    }
}
