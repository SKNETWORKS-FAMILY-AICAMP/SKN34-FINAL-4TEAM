package ai.storyfork.operations.report

import ai.storyfork.operations.report.entity.ReportKind
import ai.storyfork.operations.report.entity.ReportStatus
import ai.storyfork.operations.report.entity.ReportTarget
import ai.storyfork.operations.report.service.dto.ReportRequest
import ai.storyfork.operations.report.service.dto.ReportResponse
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** 신고 대상 종류는 JSON에서 소문자 낱말이고(DB는 다른 enum처럼 상수 이름), 대상 id는 종류가 묻는 것만 채운다. */
class ReportJsonTest {
    private val mapper = jacksonMapperBuilder().build()
    private val id = UUID.randomUUID()

    private fun request(json: String) = mapper.readValue(json, ReportRequest::class.java)

    @Test
    fun `a request without a target type is a work report and the other two types are read by their lowercase word`() {
        val work = request("""{"kind":"RIGHTS","workId":"${id}","reason":"도용"}""")
        val episode = request("""{"kind":"RIGHTS","targetType":"episode","workId":"${id}","episodeNumber":3,"reason":"도용"}""")
        val world = request("""{"kind":"HARMFUL","targetType":"world","worldId":"${id}","reason":"유해"}""")

        assertEquals(ReportTarget.WORK, work.targetType)
        assertEquals(id, work.workId)
        assertEquals(ReportTarget.EPISODE, episode.targetType)
        assertEquals(3, episode.episodeNumber)
        assertEquals(ReportTarget.WORLD, world.targetType)
        assertNull(world.workId)
        assertEquals(id, world.worldId)
    }

    @Test
    fun `an unknown target type is refused instead of becoming a work report`() {
        assertThrows(Exception::class.java) { request("""{"kind":"RIGHTS","targetType":"comment","workId":"${id}","reason":"x"}""") }
    }

    @Test
    fun `a world report answers with the lowercase type and null work fields`() {
        val response = ReportResponse(
            id = UUID.randomUUID(), kind = ReportKind.HARMFUL, targetType = ReportTarget.WORLD, workId = null, workTitle = null, workOwnerId = null,
            episodeNumber = null, worldId = id, worldName = "별빛 세계", reporterId = UUID.randomUUID(), reason = "유해", evidence = "",
            status = ReportStatus.RECEIVED, contentRestricted = false, createdAt = Instant.parse("2026-01-01T00:00:00Z"), updatedAt = Instant.parse("2026-01-01T00:00:00Z"),
        )

        val json = mapper.readTree(mapper.writeValueAsString(response))

        assertEquals("world", json.path("targetType").asString())
        assertEquals("${id}", json.path("worldId").asString())
        assertEquals("별빛 세계", json.path("worldName").asString())
        for (field in listOf("workId", "workTitle", "workOwnerId", "episodeNumber")) assertTrue(json.path(field).isNull, field)
        assertFalse(json.has("history"))
    }
}
