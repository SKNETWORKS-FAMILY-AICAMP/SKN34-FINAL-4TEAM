package ai.storyfork.content.serial

import ai.storyfork.content.serial.client.SerialAiFailure
import ai.storyfork.content.serial.client.isLimitExceeded
import ai.storyfork.content.serial.client.isReviewFailure
import ai.storyfork.content.serial.client.parseChoices
import ai.storyfork.content.serial.client.parseEpisode
import ai.storyfork.content.serial.client.parseScene
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

    @Test fun `a credit limit overrun and an unreadable or empty body are not review failures`() {
        assertFalse(isReviewFailure(402, """{"detail":"크레딧 상한을 넘었습니다.","code":"CREDIT_LIMIT_EXCEEDED"}"""))
        for (body in listOf(null, "", "   ", "not json", "[1,2]", """{"code":42}""", """{"code":null}""")) {
            assertFalse(isReviewFailure(422, body), body.toString())
        }
        assertFalse(isReviewFailure(503, null))
    }

    @Test fun `only a 402 with the limit code is a credit limit overrun`() {
        assertTrue(isLimitExceeded(402, """{"detail":"크레딧 상한을 넘었습니다.","code":"CREDIT_LIMIT_EXCEEDED"}"""))
        assertFalse(isLimitExceeded(402, """{"detail":"x"}"""))
        assertFalse(isLimitExceeded(402, """{"detail":"x","code":"OTHER"}"""))
        assertFalse(isLimitExceeded(500, """{"detail":"x","code":"CREDIT_LIMIT_EXCEEDED"}"""))
        // 검수 실패(422)와 서로 섞이지 않는다.
        assertFalse(isLimitExceeded(422, """{"detail":"x","code":"SERIAL_REVIEW_FAILED"}"""))
        assertFalse(isReviewFailure(402, """{"detail":"x","code":"CREDIT_LIMIT_EXCEEDED"}"""))
        for (body in listOf(null, "", "   ", "not json", "[1,2]", """{"code":42}""", """{"code":null}""")) {
            assertFalse(isLimitExceeded(402, body), body.toString())
        }
    }

    @Test fun `a failure says which of review and limit it is and a plain failure says neither`() {
        assertEquals(listOf(true, false), SerialAiFailure(reviewFailed = true).let { listOf(it.reviewFailed, it.limitExceeded) })
        assertEquals(listOf(false, true), SerialAiFailure(limitExceeded = true).let { listOf(it.reviewFailed, it.limitExceeded) })
        assertEquals(listOf(false, false), SerialAiFailure().let { listOf(it.reviewFailed, it.limitExceeded) })
    }

    // ---- 선택지 응답

    private val okChoices = """{"choices":[" 두 사람이 폐교에서 만난다 ","편지가 도착한다","오래된 문이 열린다","비밀이 밝혀진다"],"credits":0.25,"usage":{"inputTokens":10,"outputTokens":20}}"""

    @Test fun `a choices answer keeps four trimmed texts in order and the exact credits`() {
        val answer = parseChoices(json(okChoices))

        assertEquals(listOf("두 사람이 폐교에서 만난다", "편지가 도착한다", "오래된 문이 열린다", "비밀이 밝혀진다"), answer.choices)
        same("0.25", answer.credits)
        same("2", parseChoices(json("""{"choices":["a","b","c","d"],"credits":"2"}""")).credits)
    }

    @Test fun `a choices answer with the wrong count a bad text or unreadable credits is a failure`() {
        for (bad in listOf(
            """{"credits":1}""", """{"choices":[],"credits":1}""", """{"choices":["a","b","c"],"credits":1}""", """{"choices":["a","b","c","d","e"],"credits":1}""",
            """{"choices":["a","b","c",""],"credits":1}""", """{"choices":["a","b","c","  "],"credits":1}""", """{"choices":["a","b","c",4],"credits":1}""",
            """{"choices":["a","b","c",null],"credits":1}""", """{"choices":["a","b","c","${"가".repeat(301)}"],"credits":1}""", """{"choices":"abcd","credits":1}""",
            """{"choices":["a","b","c","d"]}""", """{"choices":["a","b","c","d"],"credits":-1}""", """[]""", """null""",
        )) {
            assertFalse(failure { parseChoices(json(bad)) }, bad.take(60))
        }
        assertFalse(failure { parseChoices(null) })
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
