package ai.storyfork.content.serial

import ai.storyfork.content.serial.client.SerialAiFailure
import ai.storyfork.content.serial.client.parseEpisode
import ai.storyfork.content.serial.client.parseScene
import ai.storyfork.content.serial.client.isReviewFailure
import java.math.BigDecimal
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper

/** AI 응답 해석(오류 분류·성공 본문 검증)을 HTTP 없이 고정한다. 실제 호출은 CI의 SerialAiClientIntegrationTest가 확인한다. */
class SerialAiClientTest {
    private val mapper = JsonMapper.builder().build()
    private fun json(text: String) = mapper.readTree(text)
    private fun failure(block: () -> Unit) = assertThrows(SerialAiFailure::class.java, block).reviewFailed
    private fun same(expected: String, actual: BigDecimal) = assertEquals(0, BigDecimal(expected).compareTo(actual), "expected=" + expected + " actual=" + actual)

    // ---- 오류 분류

    @Test fun `only a 422 with the review code is a failed review`() {
        assertTrue(isReviewFailure(422, """{"detail":"검수를 통과하지 못했어요.","code":"SERIAL_REVIEW_FAILED"}"""))
        // FastAPI 요청 검증 실패도 422지만 code가 없고 detail이 배열이다.
        assertFalse(isReviewFailure(422, """{"detail":[{"type":"missing","loc":["body","context"],"msg":"Field required"}]}"""))
        assertFalse(isReviewFailure(422, """{"detail":"x","code":"OTHER"}"""))
        assertFalse(isReviewFailure(500, """{"detail":"x","code":"SERIAL_REVIEW_FAILED"}"""))
    }

    @Test fun `a credit limit overrun and an unreadable or empty body are plain failures`() {
        assertFalse(isReviewFailure(402, """{"detail":"크레딧 상한을 넘었습니다.","code":"CREDIT_LIMIT_EXCEEDED"}"""))
        for (body in listOf(null, "", "   ", "not json", "[1,2]", """{"code":42}""", """{"code":null}""")) {
            assertFalse(isReviewFailure(422, body), body.toString())
        }
        assertFalse(isReviewFailure(503, null))
    }

    // ---- 시뮬레이션 응답

    @Test fun `a scene answer keeps the trimmed text and the exact credits`() {
        val scene = parseScene(json("""{"scene":"  달빛이 비치는 복도였다.  ","credits":0.4321,"usage":{"inputTokens":300,"outputTokens":132}}"""))

        assertEquals("달빛이 비치는 복도였다.", scene.text)
        same("0.4321", scene.credits)
        same("2", parseScene(json("""{"scene":"장면","credits":"2"}""")).credits)
        same("0", parseScene(json("""{"scene":"장면","credits":0}""")).credits)
    }

    @Test fun `a scene answer without text or valid credits is a failure`() {
        for (bad in listOf(
            """{"credits":1}""", """{"scene":"","credits":1}""", """{"scene":"  ","credits":1}""", """{"scene":null,"credits":1}""", """{"scene":"장면"}""",
            """{"scene":"장면","credits":-0.1}""", """{"scene":"장면","credits":"abc"}""", """{"scene":"장면","credits":null}""", """{"scene":"장면","credits":[1]}""",
            """[]""", """null""",
        )) {
            assertFalse(failure { parseScene(json(bad)) }, bad)
        }
    }

    // ---- 회차 응답

    private val okEpisode = """{"summary":"독자들은 재회를 원했다.","title":" 새 제목 ","text":"본문입니다.","review":{"passed":true,"issues":[]},"credits":3.5,"usage":{"inputTokens":1,"outputTokens":2}}"""

    @Test fun `an episode answer keeps summary title text credits and the review result`() {
        val episode = parseEpisode(json(okEpisode))

        assertEquals(listOf("독자들은 재회를 원했다.", "새 제목", "본문입니다.", true), listOf(episode.summary, episode.title, episode.text, episode.reviewPassed))
        same("3.5", episode.credits)
    }

    @Test fun `a review that did not pass or is missing is not passed`() {
        assertFalse(parseEpisode(json("""{"summary":"s","title":"t","text":"b","review":{"passed":false,"issues":["설정 충돌"]},"credits":1}""")).reviewPassed)
        assertFalse(parseEpisode(json("""{"summary":"s","title":"t","text":"b","credits":1}""")).reviewPassed)
        assertFalse(parseEpisode(json("""{"summary":"s","title":"t","text":"b","review":{},"credits":1}""")).reviewPassed)
    }

    @Test fun `a missing summary is empty but missing title text or credits is a failure`() {
        assertEquals("", parseEpisode(json("""{"title":"t","text":"b","review":{"passed":true},"credits":1}""")).summary)
        for (bad in listOf(
            """{"summary":"s","text":"b","review":{"passed":true},"credits":1}""", """{"summary":"s","title":" ","text":"b","review":{"passed":true},"credits":1}""",
            """{"summary":"s","title":"t","review":{"passed":true},"credits":1}""", """{"summary":"s","title":"t","text":"  ","review":{"passed":true},"credits":1}""",
            """{"summary":"s","title":"t","text":"b","review":{"passed":true}}""", """{"summary":"s","title":"t","text":"b","review":{"passed":true},"credits":-1}""",
            """{}""", """"text"""", """null""",
        )) {
            assertFalse(failure { parseEpisode(json(bad)) }, bad)
        }
    }
}
