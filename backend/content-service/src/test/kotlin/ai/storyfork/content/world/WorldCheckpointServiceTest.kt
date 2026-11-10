package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.world.repository.WorldCheckpointRepository
import ai.storyfork.content.world.service.WorldCheckpointService
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.dto.SettingPayload
import ai.storyfork.content.world.service.dto.WorldCheckpointResponse
import ai.storyfork.content.world.service.dto.WorldCheckpointSummary
import ai.storyfork.content.world.service.dto.WorldResponse
import ai.storyfork.content.world.entity.WorldCheckpointEntity
import ai.storyfork.content.work.service.WorkAccessService
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.module.kotlin.jacksonObjectMapper

class WorldCheckpointServiceTest {
    @Test fun `manual checkpoint freezes saved settings without drafts or past versions`() {
        val world = mock(WorldService::class.java)
        val checkpoints = mock(WorldCheckpointRepository::class.java)
        val access = mock(WorkAccessService::class.java)
        val saved = SettingPayload(id = "rule", versionId = "v2", name = "규칙", content = "저장된 설정")
        val draft = saved.copy(content = "작성 중")
        val earlier = saved.copy(versionId = "v1", content = "과거 내용")
        `when`(world.read("work", "owner")).thenReturn(WorldResponse(
            "work", "설정집", 2, "own", null, draft, listOf(draft),
            listOf(saved), listOf(earlier, saved), "token", emptyList(),
        ))
        `when`(checkpoints.save(any(WorldCheckpointEntity::class.java))).thenAnswer { it.getArgument<WorldCheckpointEntity>(0) }
        val service = WorldCheckpointService(access, world, checkpoints, jacksonObjectMapper())

        val checkpoint = service.create("work", "owner")

        assertEquals(listOf(saved), checkpoint.settings)
        val stored = mockingDetails(checkpoints).invocations.single().getArgument<WorldCheckpointEntity>(0)
        assertEquals("work", stored.workId)
        assertFalse(stored.snapshot.contains(draft.content))
        assertFalse(stored.snapshot.contains(earlier.content))
    }

    private val access = mock(WorkAccessService::class.java)
    private val checkpoints = mock(WorldCheckpointRepository::class.java)
    private val service = WorldCheckpointService(access, mock(WorldService::class.java), checkpoints, jacksonObjectMapper())

    private fun row(rowId: String, at: Instant) = object : WorldCheckpointRepository.Summary {
        override val id = rowId
        override val createdAt = at
    }

    @Test fun `list checks ownership then maps repository rows to summaries in repository order`() {
        `when`(checkpoints.findAllByWorkIdOrderByCreatedAtDescIdDesc("work")).thenReturn(listOf(
            row("new", Instant.parse("2026-11-10T03:00:00Z")),
            row("old", Instant.parse("2026-11-10T02:00:00.123456Z")),
        ))

        val summaries = service.list("work", "owner")

        assertEquals(listOf(
            WorldCheckpointSummary("new", "2026-11-10T03:00:00Z"),
            WorldCheckpointSummary("old", "2026-11-10T02:00:00.123456Z"),
        ), summaries)
        verify(access).own("work", "owner")
    }

    @Test fun `read restores the stored snapshot as the settings list`() {
        val rule = SettingPayload(id = "rule", versionId = "v2", name = "규칙", content = "저장된 설정", toEpisode = 3)
        val city = SettingPayload(
            id = "city", versionId = "v1", name = "도시", content = "북쪽 도시", category = "장소",
            tags = listOf("북부"), visibility = "public", fromEpisode = 2, knownBy = listOf("hero"), evidence = "2화",
        )
        `when`(checkpoints.findByWorkIdAndId("work", "cp")).thenReturn(WorldCheckpointEntity(
            "cp", "work", Instant.parse("2026-11-10T02:00:00.123456Z"), jacksonObjectMapper().writeValueAsString(listOf(rule, city))))

        val checkpoint = service.read("work", "owner", "cp")

        assertEquals(WorldCheckpointResponse("cp", "2026-11-10T02:00:00.123456Z", listOf(rule, city)), checkpoint)
        verify(access).own("work", "owner")
    }

    @Test fun `read is 404 when the work scoped lookup finds no checkpoint`() {
        // A checkpoint of another work and an unknown id look the same: the lookup is keyed by work and id, so the mock's null is the answer.
        val failure = assertThrows(ContentFailure::class.java) { service.read("work", "owner", "foreign") }

        assertEquals(404, failure.status)
        verify(checkpoints).findByWorkIdAndId("work", "foreign")
    }

    @Test fun `a caller who does not own the work never reaches the checkpoint repository`() {
        doThrow(ContentFailure(404, "작품을 찾을 수 없어요.")).`when`(access).own("work", "stranger")

        assertEquals(404, assertThrows(ContentFailure::class.java) { service.list("work", "stranger") }.status)
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.read("work", "stranger", "cp") }.status)

        verifyNoInteractions(checkpoints)
    }
}
