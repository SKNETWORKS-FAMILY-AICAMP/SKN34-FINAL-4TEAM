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

    @Test fun `the reader board has board opinions my ids and summary`() {
        val empty = mapper.readTree(mapper.writeValueAsString(SerialBoardResponse(null, emptyList(), null, null, null)))
        assertEquals(listOf("board", "myOpinionId", "myVoteOpinionId", "opinions", "summary"), empty.propertyNames().toList().sorted())
        assertTrue(empty.path("board").isNull && empty.path("summary").isNull && empty.path("myOpinionId").isNull && empty.path("myVoteOpinionId").isNull)
        assertEquals(0, empty.path("opinions").size())

        val full = mapper.readTree(mapper.writeValueAsString(SerialBoardResponse(
            SerialBoardRef("b1", 4),
            listOf(SerialOpinionView("o1", "하나", "simulation", "본문", SerialSimulationView("전제", listOf("비트"), null), 2, t0)),
            "o1", "o2", "종합",
        )))
        assertEquals(listOf("episodeNumber", "id"), full.path("board").propertyNames().toList().sorted())
        val opinion = full.path("opinions")[0]
        assertEquals(listOf("authorName", "body", "createdAt", "id", "kind", "simulation", "votes"), opinion.propertyNames().toList().sorted())
        assertEquals(listOf("beats", "premise", "scene"), opinion.path("simulation").propertyNames().toList().sorted())
        assertTrue(opinion.path("simulation").path("scene").isNull)
        assertEquals(2, opinion.path("votes").asInt())
        assertEquals("2026-11-23T12:10:00Z", opinion.path("createdAt").asString())
    }

    @Test fun `a general opinion has a null simulation`() {
        val json = mapper.writeValueAsString(SerialOpinionView("o1", "하나", "general", "본문", null, 0, t0))

        assertTrue(mapper.readTree(json).path("simulation").isNull)
        assertTrue(mapper.readTree(json).has("simulation"))
    }

    @Test fun `the opinion and vote requests read the agreed bodies`() {
        val sim = mapper.readValue("""{"kind":"simulation","body":"","simulation":{"premise":"전제","beats":["비트1","비트2"]}}""", SerialOpinionRequest::class.java)
        assertEquals(SerialOpinionRequest("simulation", "", SerialSimulationRequest("전제", listOf("비트1", "비트2"))), sim)
        assertEquals(SerialOpinionRequest("general", "의견"), mapper.readValue("""{"kind":"general","body":"의견"}""", SerialOpinionRequest::class.java))
        assertEquals(SerialVoteRequest("o1"), mapper.readValue("""{"opinionId":"o1"}""", SerialVoteRequest::class.java))
        assertEquals(SerialVoteRequest(), mapper.readValue("{}", SerialVoteRequest::class.java))
    }
}
