package ai.storyfork.content.world

import ai.storyfork.content.world.repository.WorldCheckpointRepository
import ai.storyfork.content.world.service.WorldCheckpointService
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.dto.SettingPayload
import ai.storyfork.content.world.service.dto.WorldResponse
import ai.storyfork.content.world.entity.WorldCheckpointEntity
import ai.storyfork.content.work.service.WorkAccessService
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
}
