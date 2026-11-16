package ai.storyfork.content.world

import ai.storyfork.content.world.client.dto.WorldReviewAiCard
import ai.storyfork.content.world.client.dto.WorldReviewAiRequest
import ai.storyfork.content.world.service.WorldReviewOutputValidation
import ai.storyfork.content.world.service.dto.WorldReviewFinding
import ai.storyfork.content.world.service.dto.WorldReviewFix
import ai.storyfork.content.world.service.dto.WorldReviewResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** AI 검토 응답은 믿지 않고 Content가 보낸 카드와 다시 대조한다(world-review-contract.md). 어긋나면 IllegalArgumentException이다. */
class WorldReviewOutputTest {
    private val hero = UUID.randomUUID().toString()
    private val rival = UUID.randomUUID().toString()
    private val rule = UUID.randomUUID().toString()
    private val sent = WorldReviewAiRequest("세계", "설명", listOf(
        WorldReviewAiCard(hero, "character", "basic", "영웅", "본문"),
        WorldReviewAiCard(rival, "character", "basic", "라이벌", "본문"),
        WorldReviewAiCard(rule, "rule", "basic", "규칙", "본문")), emptyList())
    private val mapper = JsonMapper.builder().build()

    // 기본값 위에 넘긴 키를 덮어써 만든다. 값을 Map으로 두면 1.5·"3"·null 같은 어긋난 값도 그대로 보낼 수 있다.
    private fun fix(vararg parts: Pair<String, Any?>) = mapOf<String, Any?>("cardId" to hero, "target" to "soul", "text" to "바꾼 글") + parts
    private fun finding(vararg parts: Pair<String, Any?>) =
        mapOf<String, Any?>("cardIds" to listOf(hero), "kind" to "contradiction", "message" to "두 설정이 어긋나요.") + parts
    private fun response(vararg findings: Map<String, Any?>) =
        mapper.writeValueAsString(mapOf("findings" to findings.toList(), "reviewedCards" to 3, "model" to "gpt-6-luna"))
    private fun parse(json: String) = WorldReviewOutputValidation.parse(sent, json)
    private fun accepted(vararg findings: Map<String, Any?>) = parse(response(*findings))
    private fun rejected(why: String, vararg findings: Map<String, Any?>) {
        assertThrows<IllegalArgumentException>(why) { parse(response(*findings)) }
    }

    @Test fun `accepts a well-formed response and keeps the findings in order with their fixes`() {
        val output = accepted(
            finding("cardIds" to listOf(hero, rival), "fix" to fix("cardId" to rival, "target" to "goal", "text" to "목표를 이렇게 바꿔요.")),
            finding("cardIds" to listOf(rule), "kind" to "missing_info", "message" to "회차가 빠졌어요.",
                "fix" to fix("cardId" to rule, "target" to "body", "text" to "규칙 본문")))
        assertEquals("gpt-6-luna", output.model)
        assertEquals(listOf(
            WorldReviewFinding(listOf(hero, rival), "contradiction", "두 설정이 어긋나요.", WorldReviewFix(rival, "goal", text = "목표를 이렇게 바꿔요.")),
            WorldReviewFinding(listOf(rule), "missing_info", "회차가 빠졌어요.", WorldReviewFix(rule, "body", text = "규칙 본문"))), output.findings)
    }

    @Test fun `a finding without a fix is fine whether the key is absent or null`() {
        assertEquals(listOf(null, null), accepted(finding(), finding("fix" to null)).findings.map { it.fix })
    }

    @Test fun `every finding names one to three of the cards that were sent`() {
        for (ids in listOf(listOf(hero), listOf(hero, rival), listOf(hero, rival, rule))) accepted(finding("cardIds" to ids))
        rejected("카드 0개", finding("cardIds" to emptyList<String>()))
        rejected("카드 4개", finding("cardIds" to listOf(hero, rival, rule, hero)))
        rejected("보내지 않은 카드", finding("cardIds" to listOf(UUID.randomUUID().toString())))
        rejected("하나라도 모르는 카드", finding("cardIds" to listOf(hero, UUID.randomUUID().toString())))
    }

    @Test fun `kind must be one of the four known ones`() {
        for (kind in listOf("contradiction", "doc_role", "missing_info", "other")) accepted(finding("kind" to kind))
        rejected("모르는 종류", finding("kind" to "bug"))
    }

    @Test fun `message is one to 300 characters`() {
        accepted(finding("message" to "가".repeat(300)))
        rejected("301자", finding("message" to "가".repeat(301)))
        rejected("공백뿐", finding("message" to "  "))
    }

    @Test fun `a fix targets one of its own finding's cards`() {
        accepted(finding("cardIds" to listOf(hero, rival), "fix" to fix("cardId" to rival)))
        rejected("다른 지적의 카드", finding("cardIds" to listOf(hero), "fix" to fix("cardId" to rival)))
        rejected("보내지 않은 카드", finding("cardIds" to listOf(hero), "fix" to fix("cardId" to UUID.randomUUID().toString())))
    }

    @Test fun `soul goal and episode fixes exist only for character cards while body fits any card`() {
        accepted(finding("cardIds" to listOf(rule), "fix" to fix("cardId" to rule, "target" to "body")))
        accepted(finding("fix" to fix("target" to "body")))
        accepted(finding("fix" to fix("target" to "goal")))
        accepted(finding("fix" to fix("target" to "episode", "episode" to 2)))
        for (target in listOf("soul", "goal")) rejected("규칙 카드의 $target", finding("cardIds" to listOf(rule), "fix" to fix("cardId" to rule, "target" to target)))
        rejected("규칙 카드의 episode", finding("cardIds" to listOf(rule), "fix" to fix("cardId" to rule, "target" to "episode", "episode" to 0)))
        rejected("모르는 칸", finding("fix" to fix("target" to "title")))
    }

    @Test fun `episode is a non-negative integer exactly when the target is episode`() {
        accepted(finding("fix" to fix("target" to "episode", "episode" to 0)))
        rejected("회차 없음", finding("fix" to fix("target" to "episode")))
        rejected("회차 null", finding("fix" to fix("target" to "episode", "episode" to null)))
        rejected("음수 회차", finding("fix" to fix("target" to "episode", "episode" to -1)))
        rejected("소수 회차", finding("fix" to fix("target" to "episode", "episode" to 1.5)))
        rejected("문자열 회차", finding("fix" to fix("target" to "episode", "episode" to "3")))
        rejected("본문 수정에 회차", finding("fix" to fix("target" to "body", "episode" to 0)))
        rejected("soul 수정에 회차", finding("fix" to fix("target" to "soul", "episode" to 0)))
    }

    @Test fun `fix text is one to 3000 characters`() {
        accepted(finding("fix" to fix("text" to "가".repeat(3000))))
        rejected("3001자", finding("fix" to fix("text" to "가".repeat(3001))))
        rejected("공백뿐", finding("fix" to fix("text" to " \n ")))
    }

    @Test fun `anything that is not the contract shape is rejected without echoing the input`() {
        val secret = "비밀 설정 원문"
        val bad = listOf(
            "not json", "null", "[]", "{}", """{"findings":[]}""", """{"model":"m"}""",
            """{"findings":"$secret","model":"m"}""", """{"findings":[null],"model":"m"}""", """{"findings":[],"model":null}""",
            """{"findings":[{"cardIds":[null],"kind":"other","message":"$secret"}],"model":"m"}""",
            """{"findings":[{"cardIds":["$hero"],"kind":"other"}],"model":"m"}""",
            """{"findings":[{"cardIds":["$hero"],"kind":"other","message":"$secret","fix":{"cardId":"$hero","target":"body"}}],"model":"m"}""",
            """{"findings":[{"cardIds":"$hero","kind":"other","message":"$secret"}],"model":"m"}""",
        )
        for (json in bad) {
            val error = assertThrows<IllegalArgumentException>(json) { parse(json) }
            assertFalse(error.message.orEmpty().contains(secret), json)
        }
    }

    @Test fun `the public JSON omits an absent fix and an absent episode but keeps every other field`() {
        val findings = listOf(
            WorldReviewFinding(listOf(hero), "other", "수정안 없음"),
            WorldReviewFinding(listOf(hero), "doc_role", "본문 수정안", WorldReviewFix(hero, "body", text = "새 본문")),
            WorldReviewFinding(listOf(hero), "missing_info", "회차 수정안", WorldReviewFix(hero, "episode", 2, "새 기억")))
        // valueToTree는 Long을 LongNode로 만들어 파싱한 IntNode와 달라지므로 문자열을 거쳐 같은 방식으로 읽는다.
        val actual: JsonNode = mapper.readTree(mapper.writeValueAsString(WorldReviewResponse(5, 3, 4, findings, "gpt-6-luna")))
        val expected = mapper.readTree("""
            {"draftRevision":5,"reviewedCards":3,"totalCards":4,"findings":[
              {"cardIds":["$hero"],"kind":"other","message":"수정안 없음"},
              {"cardIds":["$hero"],"kind":"doc_role","message":"본문 수정안","fix":{"cardId":"$hero","target":"body","text":"새 본문"}},
              {"cardIds":["$hero"],"kind":"missing_info","message":"회차 수정안","fix":{"cardId":"$hero","target":"episode","episode":2,"text":"새 기억"}}],"model":"gpt-6-luna"}""")
        assertEquals(expected, actual)
    }

    @Test fun `unknown properties are ignored because only the known fields are passed on`() {
        val output = parse("""{"findings":[],"model":"m","reviewedCards":3,"usage":{"tokens":10}}""")
        assertEquals(emptyList<WorldReviewFinding>(), output.findings)
        assertEquals("m", output.model)
    }
}
