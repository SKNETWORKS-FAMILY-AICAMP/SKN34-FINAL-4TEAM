package ai.storyfork.content.world

import ai.storyfork.content.world.client.dto.WorldDocFillAiPassage
import ai.storyfork.content.world.service.WorldDocFillInput
import ai.storyfork.content.world.service.dto.CardPayload
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 인물 문서 채우기(docs/design/world-review-contract.md)의 AI 요청 재료: 채울 문서·이름·원고 발췌. 순수 함수라 저장소·AI 없이 확인한다. */
class WorldDocFillInputTest {
    private fun person(body: String = "", metadata: Map<String, Any?> = emptyMap(), type: String = "character", title: String = "치삼", aliases: List<String> = emptyList()) =
        CardPayload(UUID.randomUUID(), title, body, type, "society", aliases = aliases, semanticMetadata = metadata)

    private fun docs(soul: Any?) = mapOf("characterDocs" to mapOf("soul" to soul, "goal" to "", "episodes" to emptyMap<String, String>()))

    @Test fun `an empty IDENTITY and an empty SOUL are the targets in that order, and a card with none empty has none`() {
        assertEquals(listOf("body", "soul"), WorldDocFillInput.targets(person()))
        assertEquals(listOf("body", "soul"), WorldDocFillInput.targets(person(" \n", docs("  "))))   // 공백뿐이면 빈 문서다
        assertEquals(listOf("soul"), WorldDocFillInput.targets(person("정체", docs(""))))
        assertEquals(listOf("body"), WorldDocFillInput.targets(person("", docs("느긋한 말투"))))
        assertEquals(emptyList<String>(), WorldDocFillInput.targets(person("정체", docs("느긋한 말투"))))
    }

    @Test fun `a malformed characterDocs is read like the screen does, so the SOUL is empty`() {
        assertEquals(listOf("soul"), WorldDocFillInput.targets(person("정체", mapOf("characterDocs" to "문서"))))
        assertEquals(listOf("soul"), WorldDocFillInput.targets(person("정체", docs(null))))
        assertEquals(listOf("soul"), WorldDocFillInput.targets(person("정체", docs(7))))
    }

    @Test fun `the names are the title and the aliases trimmed and at least two letters`() {
        val card = person(title = " 치삼 ", aliases = listOf("치삼이", "삼", "", "  장사꾼  "))
        assertEquals(listOf("치삼", "치삼이", "장사꾼"), WorldDocFillInput.names(card))
    }

    private fun pass(episode: Int, text: String) = WorldDocFillAiPassage(episode, text)

    @Test fun `the excerpt is the text around each mention, clipped at the ends of the episode and tagged with its episode`() {
        val body = "가".repeat(10) + "치삼" + "나".repeat(10)
        assertEquals(listOf(pass(3, body)), WorldDocFillInput.passages(listOf("치삼"), listOf(3 to body)))
        val long = "가".repeat(1000) + "치삼" + "나".repeat(1000)
        val only = WorldDocFillInput.passages(listOf("치삼"), listOf(2 to long)).single()
        assertEquals(2, only.episode)
        assertEquals(WorldDocFillInput.BEFORE + WorldDocFillInput.AFTER, only.text.length)
        assertEquals("가".repeat(WorldDocFillInput.BEFORE) + "치삼" + "나".repeat(WorldDocFillInput.AFTER - 2), only.text)
    }

    @Test fun `a mention inside the previous excerpt adds nothing and a later one starts a separate excerpt that does not overlap`() {
        val gap = "가".repeat(WorldDocFillInput.AFTER * 2)
        val body = "치삼" + "나".repeat(50) + "치삼이" + gap + "치삼"
        val got = WorldDocFillInput.passages(listOf("치삼", "치삼이"), listOf(1 to body))
        assertEquals(2, got.size)
        assertEquals(body.substring(0, WorldDocFillInput.AFTER), got[0].text)
        assertTrue(got[1].text.endsWith("치삼") && got[1].text.length <= WorldDocFillInput.BEFORE + WorldDocFillInput.AFTER)
        assertTrue(got[0].text.length + got[1].text.length <= body.length)
    }

    @Test fun `the next excerpt starts where the previous one ended even when its name is nearer than the lead-in`() {
        val second = 2 + 398 // 둘째 이름의 자리: 첫 발췌(0~AFTER)가 끝난 뒤지만 그 앞 BEFORE자 안이다
        val body = "치삼" + "가".repeat(398) + "치삼이" + "나".repeat(1000)
        val got = WorldDocFillInput.passages(listOf("치삼", "치삼이"), listOf(1 to body))
        assertEquals(2, got.size)
        assertEquals(body.substring(0, second + WorldDocFillInput.AFTER), got[0].text + got[1].text) // 이어 붙이면 원문의 앞부분이다: 겹치지도 빠지지도 않는다
    }

    @Test fun `episodes are read in number order, only those that mention a name are kept, and no names means no excerpt`() {
        val episodes = listOf(5 to "다섯 번째 치삼이 왔다.", 2 to "아무도 없다.", 3 to "치삼은 웃었다.")
        assertEquals(listOf(3, 5), WorldDocFillInput.passages(listOf("치삼"), episodes).map { it.episode })
        assertEquals(emptyList<WorldDocFillAiPassage>(), WorldDocFillInput.passages(emptyList(), episodes))
        assertEquals(emptyList<WorldDocFillAiPassage>(), WorldDocFillInput.passages(listOf("치삼"), emptyList()))
    }

    @Test fun `the total is capped and the earliest episodes are the ones kept`() {
        val block = "가".repeat(WorldDocFillInput.BEFORE) + "치삼" + "나".repeat(WorldDocFillInput.AFTER)   // 발췌 하나가 정확히 BEFORE + AFTER자
        val episodes = (1..60).map { it to block }
        val got = WorldDocFillInput.passages(listOf("치삼"), episodes)
        assertEquals(WorldDocFillInput.MAX_PASSAGE_CHARS / (WorldDocFillInput.BEFORE + WorldDocFillInput.AFTER), got.size)
        assertTrue(got.sumOf { it.text.length } <= WorldDocFillInput.MAX_PASSAGE_CHARS)
        assertEquals((1..got.size).toList(), got.map { it.episode })
    }

    @Test fun `an excerpt never starts or ends in the middle of a surrogate pair`() {
        val emoji = "😀"
        val body = "가" + emoji.repeat(WorldDocFillInput.BEFORE) + "나" + "치삼" + "다" + emoji.repeat(WorldDocFillInput.AFTER) // 앞뒤 경계가 모두 쌍의 가운데에 걸린다
        val text = WorldDocFillInput.passages(listOf("치삼"), listOf(1 to body)).single().text
        assertFalse(text.first().isLowSurrogate() || text.last().isHighSurrogate())
        assertTrue(text.contains("치삼") && body.contains(text))
    }
}
