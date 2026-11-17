package ai.storyfork.content.world

import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.world.service.ManuscriptBuildSnapshot
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

class ManuscriptBuildSnapshotTest {
    private val episodes=mock(EpisodeService::class.java)
    private val current=mock(EpisodeCurrentRepository::class.java)
    private val manager=mock(PlatformTransactionManager::class.java).also { `when`(it.getTransaction(org.mockito.ArgumentMatchers.any())).thenAnswer { SimpleTransactionStatus() } }
    private val service=ManuscriptBuildSnapshot(episodes,current,TransactionTemplate(manager))
    private fun row(number:Int)=EpisodeResponse(number,DraftResponse("미저장 제목","미저장 원문",4),
        listOf(VersionResponse("saved-$number","${number}화","저장된 원문 $number",3,number,"2026-11-17T00:00:00Z")),null,false,null)
    init { `when`(current.findAllByWorkIdOrderBySequence("work")).thenReturn((1..4).map { EpisodeCurrentEntity("episode-$it","work",it) }) }

    @Test fun `four unpublished saved episodes preserve original IDs and do not read unsaved draft`() {
        `when`(episodes.list("work","owner")).thenReturn(EpisodeListResponse((1..4).map(::row)))
        val input=service.read("work","owner")
        assertEquals((1..4).toList(),input.episodes.map { it.number })
        assertEquals("saved-1",input.episodes.first().versionId)
        assertEquals("episode-1",input.episodes.first().episodeId)
        assertEquals("저장된 원문 1",input.episodes.first().body)
        verify(episodes).list("work","owner")
    }
    @Test fun `missing saved episode fails the full snapshot instead of silently skipping it`() {
        `when`(episodes.list("work","owner")).thenReturn(EpisodeListResponse(listOf(row(1),row(2).copy(versions=emptyList()))))
        assertThrows(IllegalArgumentException::class.java) { service.read("work","owner") }
    }
    @Test fun `inherited episodes are not treated as this initial import`() {
        `when`(episodes.list("work","owner")).thenReturn(EpisodeListResponse(listOf(row(1).copy(inherited=true))))
        assertThrows(IllegalArgumentException::class.java) { service.read("work","owner") }
    }
}
