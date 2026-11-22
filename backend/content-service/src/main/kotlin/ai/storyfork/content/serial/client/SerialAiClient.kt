package ai.storyfork.content.serial.client

import java.math.BigDecimal
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** 시뮬레이션 의견에 붙일 장면 미리보기와 AI가 확정한 크레딧(소수 4자리, 요청한 상한 이하)이다. */
data class SerialScene(val text: String, val credits: BigDecimal)

/** AI가 만든 다음 회차다. [summary]는 의견 종합 문장(공개), [reviewPassed]는 AI 검수 결과, [credits]는 확정 크레딧이다. */
data class GeneratedEpisode(val summary: String, val title: String, val text: String, val credits: BigDecimal, val reviewPassed: Boolean = true)

/** AI 호출 실패다. [reviewFailed]는 검수 2회 실패(422)이고 그 밖의 모든 실패(연결·시간 초과·크레딧 상한 초과 402·응답 오류)는 false다. 원문·응답 본문을 싣지 않는다. */
class SerialAiFailure(val reviewFailed: Boolean = false, cause: Throwable? = null) : RuntimeException(if (reviewFailed) "SERIAL_REVIEW_FAILED" else "SERIAL_AI_FAILED", cause)

private val json = JsonMapper.builder().build()

/**
 * AI 오류 응답이 검수 실패인가. 오류 본문은 {detail}이고 402·422에만 code가 있다. FastAPI의 요청 검증 실패도 422지만 code가 없고 detail이 배열이라,
 * 검수 실패는 422와 code SERIAL_REVIEW_FAILED일 때만이다(크레딧 상한 초과 402는 일반 실패로 해제한다). 읽을 수 없는 본문은 일반 실패다.
 */
internal fun isReviewFailure(status: Int, body: String?): Boolean {
    val code = try {
        if (body.isNullOrBlank()) null else json.readTree(body).path("code").let { if (it.isString) it.asString() else null }
    } catch (_: RuntimeException) {
        null
    }
    return status == 422 && code == "SERIAL_REVIEW_FAILED"
}

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

/** 회차 응답 {summary, title, text, review:{passed, issues}, credits, usage}를 검증한다. 제목·본문·크레딧이 없으면 실패이고 review.passed가 없으면 통과하지 못한 것으로 본다. */
internal fun parseEpisode(node: JsonNode?): GeneratedEpisode {
    if (node == null || !node.isObject) invalid()
    val title = text(node, "title")
    val body = text(node, "text")
    if (title.isEmpty() || body.isEmpty()) invalid()
    return GeneratedEpisode(text(node, "summary"), title, body, credits(node), node.path("review").path("passed").asBoolean(false))
}

/**
 * AI 서비스의 자율 연재 내부 API(시뮬레이션 장면·회차 생성) 호출이다. 사용자 토큰·MCP를 쓰지 않고 [token]만 보낸다.
 * 시뮬레이션은 회원 요청 안에서 부르므로 회원 Bearer를 전달하는 클라이언트(추적에 회원을 남긴다)를, 회차 실행은 일정 점검 스레드에서 부르므로 긴 읽기 한도의 클라이언트를 쓴다.
 */
class SerialAiClient(private val simulationClient: RestClient, private val episodeClient: RestClient, private val token: String) {
    fun simulate(body: Map<String, Any?>): SerialScene = parseScene(post(simulationClient, "/internal/v1/serial/simulations", body))

    fun episode(body: Map<String, Any?>): GeneratedEpisode = parseEpisode(post(episodeClient, "/internal/v1/serial/episodes", body))

    private fun post(client: RestClient, uri: String, body: Map<String, Any?>): JsonNode? {
        if (token.isBlank()) invalid() // AI 내부 인증 설정이 없으면 보내지 않는다.
        try {
            return client.post().uri(uri).contentType(MediaType.APPLICATION_JSON).header("X-Internal-Token", token).body(body).retrieve().body(JsonNode::class.java)
        } catch (error: RestClientResponseException) {
            throw SerialAiFailure(isReviewFailure(error.statusCode.value(), error.responseBodyAsString), error)
        } catch (error: RestClientException) {
            throw SerialAiFailure(cause = error)
        }
    }
}
