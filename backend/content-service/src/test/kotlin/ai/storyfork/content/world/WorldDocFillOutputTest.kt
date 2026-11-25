package ai.storyfork.content.world

import ai.storyfork.content.world.client.dto.WorldDocFillAiPassage
import ai.storyfork.content.world.client.dto.WorldDocFillAiRequest
import ai.storyfork.content.world.service.WorldDocFillOutputValidation
import ai.storyfork.content.world.service.dto.WorldDocFillLine
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/** AI가 돌려준 줄을 믿지 않고 Content가 보낸 발췌와 다시 대조한다: 발췌에 글자 그대로 있는 문장만 통과한다. */
class WorldDocFillOutputTest {
    private val look = "키가 작고 얼굴이 검게 탔다."
    private val voice = "난 안 할 거야, 치삼이 퉁명스럽게 말했다."
    private val sent = WorldDocFillAiRequest("card-1", "치삼", listOf("치삼이"), listOf("body", "soul"),
        listOf(WorldDocFillAiPassage(2, "장터의 소금장수 치삼이 다가왔다. $look"), WorldDocFillAiPassage(4, voice)))

    private fun line(target: String = "body", kind: String = "description", episode: Int = 2, quote: String = look) =
        """{"target":"$target","kind":"$kind","episode":$episode,"quote":"$quote"}"""

    private fun answer(vararg lines: String, skipped: Int = 0, model: String = "gpt-6-luna") =
        """{"lines":[${lines.joinToString(",")}],"skipped":$skipped,"model":"$model"}"""

    @Test fun `a verified answer is read as is`() {
        val output = WorldDocFillOutputValidation.parse(sent, answer(line(), line("soul", "fact", 4, voice), skipped = 2))

        assertEquals(listOf(WorldDocFillLine("body", "description", 2, look), WorldDocFillLine("soul", "fact", 4, voice)), output.lines)
        assertEquals(2, output.skipped)
        assertEquals("gpt-6-luna", output.model)
    }

    @Test fun `no evidence is an empty answer, not an error`() {
        assertEquals(emptyList<WorldDocFillLine>(), WorldDocFillOutputValidation.parse(sent, answer()).lines)
    }

    @Test fun `unknown fields are ignored`() {
        val output = WorldDocFillOutputValidation.parse(sent, """{"lines":[],"skipped":0,"model":"m","extra":1}""")
        assertEquals("m", output.model)
    }

    private fun rejected(json: String) = assertEquals("INVALID_AI_OUTPUT", assertThrows<IllegalArgumentException> { WorldDocFillOutputValidation.parse(sent, json) }.message)

    @Test fun `a line the sent excerpts do not support is rejected`() {
        rejected(answer(line(quote = "키가 크고 힘이 세다.")))                       // 지어낸 문장
        rejected(answer(line("soul", "fact", 2, voice)))                            // 문장은 4화에 있는데 2화라고 했다
        rejected(answer(line("body", "fact", 4, voice)))                            // IDENTITY는 첫 등장 회차(2화)의 문장만
        rejected(answer(line("body", "fact", 9, look)))                             // 보내지 않은 회차
    }

    @Test fun `a line outside the contract is rejected`() {
        rejected(answer(line("goal")))                                              // GOAL은 채우지 않는다
        rejected(answer(line(kind = "rule")))                                       // 표지는 fact·description뿐
        rejected(answer(line(quote = " ")))
        rejected(answer(line(quote = "가".repeat(301))))
        rejected(answer(*Array(9) { line("soul", "fact", 4, voice) }))              // 문서마다 8줄까지
    }

    @Test fun `a document that was not asked for is rejected`() {
        val onlyBody = sent.copy(targets = listOf("body"))
        assertThrows<IllegalArgumentException> { WorldDocFillOutputValidation.parse(onlyBody, answer(line("soul", "fact", 4, voice))) }
    }

    @Test fun `an unreadable or incomplete answer is rejected without echoing it`() {
        rejected("not json")
        rejected("{}")
        rejected("""{"lines":"x","skipped":0,"model":"m"}""")
        rejected("""{"lines":[],"skipped":-1,"model":"m"}""")
        rejected("""{"lines":[{"target":"body"}],"skipped":0,"model":"m"}""")
        rejected("null")
    }
}
