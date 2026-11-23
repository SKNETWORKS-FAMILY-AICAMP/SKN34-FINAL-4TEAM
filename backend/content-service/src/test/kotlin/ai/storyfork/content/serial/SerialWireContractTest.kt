package ai.storyfork.content.serial

import ai.storyfork.content.serial.service.dto.*
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper

/** 프런트와 합의한 JSON 모양(필드 이름·null 포함 여부·시각 형식)을 고정한다. 필드를 바꾸면 화면이 조용히 깨진다. */
class SerialWireContractTest {
    private val mapper = JsonMapper.builder().findAndAddModules().build()
    private val t0 = Instant.parse("2026-11-23T12:10:00Z")
    private fun keys(json: String) = mapper.readTree(json).propertyNames().toList().sorted()

    @Test fun `settings have exactly the four fields`() {
        val json = mapper.writeValueAsString(SerialSettingsResponse(true, listOf("MON", "SUN"), "21:00", "방향"))

        assertEquals(listOf("days", "direction", "enabled", "time"), keys(json))
        assertEquals(listOf("MON", "SUN"), mapper.readTree(json).path("days").values().map { it.asString() })
        assertEquals("21:00", mapper.readTree(json).path("time").asString())
    }

    @Test fun `a settings request tolerates a sparse body`() {
        assertEquals(SerialSettingsRequest(true, listOf("MON"), "20:30", "x"), mapper.readValue("""{"enabled":true,"days":["MON"],"time":"20:30","direction":"x"}""", SerialSettingsRequest::class.java))
        assertEquals(SerialSettingsRequest(), mapper.readValue("{}", SerialSettingsRequest::class.java))
        assertEquals(SerialSettingsResponse(false, emptyList(), "21:00", ""), SerialSettingsResponse(false, emptyList(), "21:00", ""))
    }

    @Test fun `a board record keeps null fields and exactly six names`() {
        val json = mapper.writeValueAsString(listOf(SerialBoardRecord("b1", 4, "open", null, null, null), SerialBoardRecord("b0", 3, "failed", null, "크레딧이 부족합니다.", t0)))

        val rows = mapper.readTree(json)
        assertTrue(rows.isArray)
        assertEquals(listOf("closedAt", "episodeNumber", "failureReason", "id", "publishedEpisodeNumber", "status"), rows[0].propertyNames().toList().sorted())
        assertTrue(rows[0].path("closedAt").isNull && rows[0].path("publishedEpisodeNumber").isNull && rows[0].path("failureReason").isNull)
        assertEquals("2026-11-23T12:10:00Z", rows[1].path("closedAt").asString())
    }

    @Test fun `the reader board has enabled board choices my choice proposals and summary`() {
        val empty = mapper.readTree(mapper.writeValueAsString(SerialBoardResponse(false, null, emptyList(), null, emptyList(), null)))
        assertEquals(listOf("board", "choices", "enabled", "myChoiceId", "proposals", "summary"), empty.propertyNames().toList().sorted())
        assertTrue(empty.path("board").isNull && empty.path("summary").isNull && empty.path("myChoiceId").isNull)
        assertFalse(empty.path("enabled").asBoolean())
        assertEquals(listOf(0, 0), listOf(empty.path("choices").size(), empty.path("proposals").size()))

        val full = mapper.readTree(mapper.writeValueAsString(SerialBoardResponse(
            true,
            SerialBoardRef("b1", 4),
            listOf(SerialChoiceView("c1", 1, "두 사람이 폐교에서 만난다", 3), SerialChoiceView("c2", 2, "편지가 도착한다", 0)),
            "c1",
            listOf(SerialProposalView("p1", "하나", "simulation", "제목", "본문", SerialSimulationView("전제", listOf("비트"), null), 2, true, false, t0)),
            "종합",
        )))
        assertTrue(full.path("enabled").asBoolean())
        assertEquals(listOf("episodeNumber", "id"), full.path("board").propertyNames().toList().sorted())
        assertEquals("c1", full.path("myChoiceId").asString())
        val choice = full.path("choices")[0]
        assertEquals(listOf("id", "position", "text", "votes"), choice.propertyNames().toList().sorted())
        assertEquals(listOf(1, 3), listOf(choice.path("position").asInt(), choice.path("votes").asInt()))
        val proposal = full.path("proposals")[0]
        assertEquals(listOf("authorName", "body", "createdAt", "id", "kind", "likedByMe", "likes", "mine", "simulation", "title"), proposal.propertyNames().toList().sorted())
        assertEquals(listOf("beats", "premise", "scene"), proposal.path("simulation").propertyNames().toList().sorted())
        assertTrue(proposal.path("simulation").path("scene").isNull)
        assertEquals(listOf(2, true, false), listOf(proposal.path("likes").asInt(), proposal.path("likedByMe").asBoolean(), proposal.path("mine").asBoolean()))
        assertEquals("2026-11-23T12:10:00Z", proposal.path("createdAt").asString())
    }

    @Test fun `a general proposal has a null simulation`() {
        val json = mapper.writeValueAsString(SerialProposalView("p1", "하나", "general", "제목", "본문", null, 0, false, true, t0))

        assertTrue(mapper.readTree(json).path("simulation").isNull)
        assertTrue(mapper.readTree(json).has("simulation"))
    }

    @Test fun `the proposal vote and created bodies match the agreed shapes`() {
        val sim = mapper.readValue("""{"kind":"simulation","title":"폐교 장면","body":"","simulation":{"premise":"전제","beats":["비트1","비트2"]}}""", SerialProposalRequest::class.java)
        assertEquals(SerialProposalRequest("simulation", "폐교 장면", "", SerialSimulationRequest("전제", listOf("비트1", "비트2"))), sim)
        assertEquals(SerialProposalRequest("general", "제목", "본문"), mapper.readValue("""{"kind":"general","title":"제목","body":"본문"}""", SerialProposalRequest::class.java))
        assertEquals(SerialProposalRequest(), mapper.readValue("{}", SerialProposalRequest::class.java))
        assertEquals(SerialVoteRequest("c1"), mapper.readValue("""{"choiceId":"c1"}""", SerialVoteRequest::class.java))
        assertEquals(SerialVoteRequest(), mapper.readValue("{}", SerialVoteRequest::class.java))
        assertEquals(listOf("id"), keys(mapper.writeValueAsString(SerialProposalCreated("p1"))))
    }
}
