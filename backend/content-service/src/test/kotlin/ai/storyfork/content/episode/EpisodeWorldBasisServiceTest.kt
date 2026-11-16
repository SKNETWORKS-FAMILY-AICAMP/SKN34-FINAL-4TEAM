package ai.storyfork.content.episode

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.entity.EpisodeEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.EpisodeWorldBasisService
import ai.storyfork.content.episode.service.dto.EpisodeWorldBasisRequest
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.WorldRevisionSummaryResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

class EpisodeWorldBasisServiceTest {
    private val owner = UUID.randomUUID()
    private val world = UUID.randomUUID()
    private val version = UUID.randomUUID()
    private val second = UUID.randomUUID()
    private val access = mock(WorkAccessService::class.java)
    private val episodes = mock(EpisodeRepository::class.java)
    private val current = mock(EpisodeCurrentRepository::class.java)
    private val worlds = mock(WorldStudioService::class.java)
    private val manager = mock(PlatformTransactionManager::class.java)
    private val service = EpisodeWorldBasisService(access, episodes, current, worlds, TransactionTemplate(manager))
    private val row = EpisodeEntity(id = "episode", workId = "work", sequence = 2)
    private fun prepare(inherited: Boolean = false) {
        `when`(manager.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
        `when`(current.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeCurrentEntity(id = "episode", inherited = inherited))
        `when`(episodes.countWritingAt("work", 2)).thenReturn(1L)
        `when`(episodes.findByWorkIdAndSequence("work", 2)).thenReturn(row)
    }
    private fun summary(id: UUID, number: Long) = WorldRevisionSummaryResponse(world, id, number, "세계관", "2026-11-10T00:00:00Z")

    @Test fun `sets reads and changes the exact owned sealed revision`() {
        prepare()
        val v1 = summary(version, 1)
        val v2 = summary(second, 2)
        `when`(worlds.revisionSummary(world, owner, version)).thenReturn(v1)
        `when`(worlds.revisionSummary(world, owner, second)).thenReturn(v2)
        assertNull(service.read("work", owner, 2).basis)
        assertEquals(v1, service.choose("work", owner, 2, EpisodeWorldBasisRequest(world, version, 0)).basis)
        assertEquals(1, service.read("work", owner, 2).revision)
        assertEquals(409, assertThrows(ContentFailure::class.java) {
            service.choose("work", owner, 2, EpisodeWorldBasisRequest(world, second, 0))
        }.status)
        assertEquals(v2, service.choose("work", owner, 2, EpisodeWorldBasisRequest(world, second, 1)).basis)
        assertEquals(second, row.basisWorldRevisionId)
    }

    @Test fun `rejects inherited episodes and never links an inaccessible version`() {
        prepare(true)
        `when`(worlds.revisionSummary(world, owner, version)).thenThrow(WorldNotFound())
        assertEquals(403, assertThrows(ContentFailure::class.java) {
            service.choose("work", owner, 2, EpisodeWorldBasisRequest(world, version, 0))
        }.status)
        verifyNoInteractions(worlds)
        prepare()
        assertEquals(404, assertThrows(ContentFailure::class.java) {
            service.choose("work", owner, 2, EpisodeWorldBasisRequest(world, version, 0))
        }.status)
        assertNull(row.basisWorldRevisionId)
    }

    @Test fun `an episode placeholder cannot acquire a writing basis`() {
        prepare()
        `when`(episodes.countWritingAt("work", 2)).thenReturn(0L)
        assertEquals(404, assertThrows(ContentFailure::class.java) {
            service.choose("work", owner, 2, EpisodeWorldBasisRequest(world, version, 0))
        }.status)
        verifyNoInteractions(worlds)
    }
}
