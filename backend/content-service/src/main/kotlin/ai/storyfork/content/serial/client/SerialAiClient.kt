package ai.storyfork.content.serial.client

import ai.storyfork.content.serial.domain.cleanChoices
import ai.storyfork.content.serial.domain.cleanSummary
import java.math.BigDecimal
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** 시뮬레이션 제안 글에 붙일 장면 미리보기와 AI가 확정한 크레딧(소수 4자리, 요청한 상한 이하)이다. */
data class SerialScene(val text: String, val credits: BigDecimal)

/** AI가 만든 다음 전개 선택지 4개(검증된 글)와 확정 크레딧이다. */
data class GeneratedChoices(val choices: List<String>, val credits: BigDecimal)

/** AI가 만든 공개 회차 하나의 줄거리 요약(검증된 글, 400자 이하)과 확정 크레딧이다. */
data class GeneratedSummary(val summary: String, val credits: BigDecimal)

/** AI가 만든 다음 회차다. [summary]는 투표·제안 종합 문장(공개), [reviewPassed]는 AI 검수 결과, [credits]는 확정 크레딧이다. */
data class GeneratedEpisode(val summary: String, val title: String, val text: String, val credits: BigDecimal, val reviewPassed: Boolean = true)

/**
 * AI 호출 실패다. [reviewFailed]는 검수 2회 실패(422), [limitExceeded]는 크레딧 상한 초과(402)이고 그 밖의 모든 실패(연결·시간 초과·응답 오류)는 둘 다 false다.
 * 둘은 실행 실패 사유를 일반 실패 문구와 구분하는 데만 쓴다. 원문·응답 본문을 싣지 않는다.
 */
class SerialAiFailure(val reviewFailed: Boolean = false, cause: Throwable? = null, val limitExceeded: Boolean = false) :
    RuntimeException(if (reviewFailed) "SERIAL_REVIEW_FAILED" else if (limitExceeded) "CREDIT_LIMIT_EXCEEDED" else "SERIAL_AI_FAILED", cause)

private val json = JsonMapper.builder().build()

private fun errorCode(body: String?): String? = try {
    if (body.isNullOrBlank()) null else json.readTree(body).path("code").let { if (it.isString) it.asString() else null }
} catch (_: RuntimeException) {
    null
}

/**
 * AI 오류 응답이 검수 실패인가. 오류 본문은 {detail}이고 402·422에만 code가 있다. FastAPI의 요청 검증 실패도 422지만 code가 없고 detail이 배열이라,
 * 검수 실패는 422와 code SERIAL_REVIEW_FAILED일 때만이다. 읽을 수 없는 본문은 일반 실패다.
 */
internal fun isReviewFailure(status: Int, body: String?): Boolean = status == 422 && errorCode(body) == "SERIAL_REVIEW_FAILED"

/** AI 오류 응답이 크레딧 상한 초과인가: 402와 code CREDIT_LIMIT_EXCEEDED일 때만이다(AI의 CreditMiddleware가 상한 이상이면 다음 모델 호출 전에 끝낸다). */
internal fun isLimitExceeded(status: Int, body: String?): Boolean = status == 402 && errorCode(body) == "CREDIT_LIMIT_EXCEEDED"

private fun invalid(): Nothing = throw SerialAiFailure()

private fun text(node: JsonNode, name: String): String = node.path(name).let { if (it.isString) it.asString().trim() else "" }

/** 확정 크레딧은 0 이상의 숫자(또는 숫자 글)여야 한다. */
private fun credits(node: JsonNode): BigDecimal {
    val value = node.path("credits")
    val amount = when {
        value.isNumber -> value.decimalValue()
        value.isString -> value.asString().toBigDecimalOrNull()
        else -> null
    }
    return amount?.takeIf { it.signum() >= 0 } ?: invalid()
}

/** 시뮬레이션 응답 {scene, credits, usage}를 검증한다. 장면이 비었거나 크레딧을 읽을 수 없으면 실패다. */
internal fun parseScene(node: JsonNode?): SerialScene {
    if (node == null || !node.isObject) invalid()
    val scene = text(node, "scene")
    if (scene.isEmpty()) invalid()
    return SerialScene(scene, credits(node))
}

/** 선택지 응답 {choices:[4개 문자열], credits, usage}를 검증한다: 글이 정확히 4개이고 각각 1~300자여야 하며(앞뒤 공백은 뗀다) 어긋나거나 크레딧을 읽을 수 없으면 실패다. */
internal fun parseChoices(node: JsonNode?): GeneratedChoices {
    if (node == null || !node.isObject) invalid()
    val items = node.path("choices")
    if (!items.isArray) invalid()
    val texts = items.values().map { if (it.isString) it.asString() else invalid() }
    return GeneratedChoices(cleanChoices(texts) ?: invalid(), credits(node))
}

/** 요약 응답 {summary, credits, usage}를 검증한다: 요약이 비었거나 400자를 넘거나 크레딧을 읽을 수 없으면 실패다(줄여 쓰지 않는다). */
internal fun parseSummary(node: JsonNode?): GeneratedSummary {
    if (node == null || !node.isObject) invalid()
    return GeneratedSummary(cleanSummary(text(node, "summary")) ?: invalid(), credits(node))
}

/** 회차 응답 {summary, title, text, review:{passed, issues}, credits, usage}를 검증한다. 제목·본문·크레딧이 없으면 실패이고 review.passed가 없으면 통과하지 못한 것으로 본다. */
internal fun parseEpisode(node: JsonNode?): GeneratedEpisode {
    if (node == null || !node.isObject) invalid()
    val title = text(node, "title")
    val body = text(node, "text")
    if (title.isEmpty() || body.isEmpty()) invalid()
    return GeneratedEpisode(text(node, "summary"), title, body, credits(node), node.path("review").path("passed").asBoolean(false))
}

/**
 * AI 서비스의 자율 연재 내부 API(시뮬레이션 장면·선택지·회차 요약·회차 생성) 호출이다. 사용자 토큰·MCP를 쓰지 않고 [token]만 보낸다.
 * 시뮬레이션은 회원 요청 안에서 부르므로 회원 Bearer를 전달하는 클라이언트(추적에 회원을 남긴다)를, 선택지·회차 요약·회차 실행은 일정 점검 스레드에서 부르므로 긴 읽기 한도의 클라이언트를 쓴다.
 */
class SerialAiClient(private val simulationClient: RestClient, private val episodeClient: RestClient, private val token: String) {
    fun simulate(body: Map<String, Any?>): SerialScene = parseScene(post(simulationClient, "/internal/v1/serial/simulations", body))

    fun choices(body: Map<String, Any?>): GeneratedChoices = parseChoices(post(episodeClient, "/internal/v1/serial/choices", body))

    fun summarize(body: Map<String, Any?>): GeneratedSummary = parseSummary(post(episodeClient, "/internal/v1/serial/summaries", body))

    fun episode(body: Map<String, Any?>): GeneratedEpisode = parseEpisode(post(episodeClient, "/internal/v1/serial/episodes", body))

    private fun post(client: RestClient, uri: String, body: Map<String, Any?>): JsonNode? {
        if (token.isBlank()) invalid() // AI 내부 인증 설정이 없으면 보내지 않는다.
        try {
            return client.post().uri(uri).contentType(MediaType.APPLICATION_JSON).header("X-Internal-Token", token).body(body).retrieve().body(JsonNode::class.java)
        } catch (error: RestClientResponseException) {
            val status = error.statusCode.value()
            val body = error.responseBodyAsString
            throw SerialAiFailure(isReviewFailure(status, body), error, isLimitExceeded(status, body))
        } catch (error: RestClientException) {
            throw SerialAiFailure(cause = error)
        }
    }
}
