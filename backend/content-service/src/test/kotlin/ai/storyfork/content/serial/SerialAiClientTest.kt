package ai.storyfork.content.serial

import ai.storyfork.content.serial.client.SerialAiFailure
import ai.storyfork.content.serial.client.aiFailure
import ai.storyfork.content.serial.client.failureDetail
import ai.storyfork.content.serial.client.isLimitExceeded
import ai.storyfork.content.serial.client.isReviewFailure
import ai.storyfork.content.serial.client.parseChoices
import ai.storyfork.content.serial.client.parseEpisode
import ai.storyfork.content.serial.client.parseScene
import ai.storyfork.content.serial.client.parseSummary
import java.math.BigDecimal
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatusCode
import org.springframework.web.client.HttpClientErrorException
import org.springframework.web.client.HttpServerErrorException
import org.springframework.web.client.RestClientResponseException
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

    // ---- 인물 시뮬레이션이 막은 실패: AI의 문구

    private val noCharacters = "연결된 세계관에 인물 카드가 없어 시뮬레이션을 실행할 수 없어요."
    private val emptyDocs = "인물 문서가 비어 있어요: 카엘(IDENTITY.md, SOUL.md), 리나(SOUL.md). 세계관 관리 화면에서 채워 주세요."

    /** FastAPI의 JSONResponse가 돌려주는 오류 응답이다: charset 없는 application/json에 UTF-8 본문(한국어 문구가 그대로 온다). */
    private fun answer(status: Int, body: String): RestClientResponseException {
        val headers = HttpHeaders().apply { set(HttpHeaders.CONTENT_TYPE, "application/json") }
        val code = HttpStatusCode.valueOf(status)
        val bytes = body.toByteArray(Charsets.UTF_8)
        return if (code.is4xxClientError) HttpClientErrorException.create(code, "error", headers, bytes, null) else HttpServerErrorException.create(code, "error", headers, bytes, null)
    }

    @Test fun `a 409 or 422 with a sentence and no code is an explanation the board can show as it is`() {
        assertEquals(noCharacters, failureDetail(409, """{"detail":"$noCharacters"}"""))
        assertEquals(emptyDocs, failureDetail(422, """{"detail":"$emptyDocs"}"""))
    }

    @Test fun `only the statuses 409 and 422 explain themselves`() {
        // 계약의 '장면이 끝나지 않음'(AI 502)·장면 시간 초과(504)도 AI 문구지만 이번 범위 밖이다: 이 줄이 바뀌면 의도한 변경이어야 한다.
        for (status in listOf(200, 400, 401, 402, 403, 404, 429, 500, 502, 503, 504)) {
            assertNull(failureDetail(status, """{"detail":"$noCharacters"}"""), status.toString())
        }
    }

    @Test fun `a validation error array or any detail that is not a sentence is not shown`() {
        for (body in listOf(
            """{"detail":[{"type":"missing","loc":["body","world"],"msg":"Field required"}]}""", """{"detail":{"msg":"객체"}}""", """{"detail":42}""",
            """{"detail":true}""", """{"detail":null}""", """{"code":"OTHER"}""", """{}""",
        )) {
            assertNull(failureDetail(422, body), body)
            assertNull(failureDetail(409, body), body)
        }
    }

    @Test fun `the review failure and the credit limit overrun are told apart by their codes and never explained`() {
        assertNull(failureDetail(422, """{"detail":"검수를 통과하지 못했습니다.","code":"SERIAL_REVIEW_FAILED"}"""))
        assertNull(failureDetail(409, """{"detail":"x","code":"SERIAL_REVIEW_FAILED"}"""))
        assertNull(failureDetail(422, """{"detail":"크레딧 상한을 넘었습니다.","code":"CREDIT_LIMIT_EXCEEDED"}"""))
        assertNull(failureDetail(409, """{"detail":"x","code":"CREDIT_LIMIT_EXCEEDED"}"""))
        // 다른 code와 문자열이 아닌 code는 그대로 설명한다.
        assertEquals("문구", failureDetail(422, """{"detail":"문구","code":"OTHER"}"""))
        assertEquals("문구", failureDetail(422, """{"detail":"문구","code":42}"""))
        assertEquals("문구", failureDetail(422, """{"detail":"문구","code":null}"""))
    }

    @Test fun `an unreadable body or a blank sentence explains nothing`() {
        for (body in listOf(null, "", "   ", "not json", "[1,2]", "\"text\"", """{"detail":""}""", """{"detail":"   "}""", """{"detail":"\n\t"}""")) {
            assertNull(failureDetail(422, body), body.toString())
        }
    }

    @Test fun `the sentence is tidied and capped before it is kept`() {
        assertEquals("인물 문서가 비어 있어요.", failureDetail(422, """{"detail":"  인물 문서가\n비어   있어요.\t "}"""))
        assertEquals(300, failureDetail(409, """{"detail":"${"가".repeat(500)}"}""")!!.length)
    }

    @Test fun `an error answer becomes a failure with the right flags and the sentence only for the explained ones`() {
        val explained = aiFailure(answer(422, """{"detail":"$emptyDocs"}"""))
        assertEquals(listOf<Any?>(false, false, emptyDocs), listOf(explained.reviewFailed, explained.limitExceeded, explained.detail))

        val review = aiFailure(answer(422, """{"detail":"검수를 통과하지 못했습니다.","code":"SERIAL_REVIEW_FAILED"}"""))
        assertEquals(listOf<Any?>(true, false, null), listOf(review.reviewFailed, review.limitExceeded, review.detail))

        val limit = aiFailure(answer(402, """{"detail":"크레딧 상한을 넘었습니다.","code":"CREDIT_LIMIT_EXCEEDED"}"""))
        assertEquals(listOf<Any?>(false, true, null), listOf(limit.reviewFailed, limit.limitExceeded, limit.detail))

        val plain = aiFailure(answer(502, """{"detail":"$emptyDocs"}"""))
        assertEquals(listOf<Any?>(false, false, null), listOf(plain.reviewFailed, plain.limitExceeded, plain.detail))
    }

    @Test fun `the failure keeps the error answer as its cause but never prints the sentence or the body in its message`() {
        val error = answer(409, """{"detail":"$noCharacters"}""")
        val failure = aiFailure(error)

        assertSame(error, failure.cause)
        assertEquals("SERIAL_AI_FAILED", failure.message)
        assertFalse(failure.toString().contains(noCharacters))
        assertEquals(noCharacters, failure.detail)
        assertNull(SerialAiFailure().detail)
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

    // ---- 회차 요약 응답

    @Test fun `a summary answer keeps the trimmed text and the exact credits`() {
        val answer = parseSummary(json("""{"summary":"  두 사람은 폐교에서 재회했다.  ","credits":2.5,"usage":{"inputTokens":3000,"outputTokens":300}}"""))

        assertEquals("두 사람은 폐교에서 재회했다.", answer.summary)
        same("2.5", answer.credits)
        assertEquals(400, parseSummary(json("""{"summary":"${"가".repeat(400)}","credits":1}""")).summary.length)
    }

    @Test fun `a summary answer that is empty or too long or has unreadable credits is a failure and is never cut short`() {
        for (bad in listOf(
            """{"credits":1}""", """{"summary":"","credits":1}""", """{"summary":"  ","credits":1}""", """{"summary":null,"credits":1}""", """{"summary":["a"],"credits":1}""",
            """{"summary":"${"가".repeat(401)}","credits":1}""", """{"summary":"요약"}""", """{"summary":"요약","credits":-1}""", """[]""", """null""",
        )) {
            assertFalse(failure { parseSummary(json(bad)) }, bad.take(60))
        }
        assertFalse(failure { parseSummary(null) })
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
