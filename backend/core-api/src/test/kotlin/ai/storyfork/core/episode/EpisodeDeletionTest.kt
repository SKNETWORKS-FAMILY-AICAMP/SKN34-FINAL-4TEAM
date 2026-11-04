package ai.storyfork.core.episode

import ai.storyfork.core.episode.service.EpisodeService
import ai.storyfork.core.episode.service.dto.DraftRequest
import ai.storyfork.core.episode.entity.*
import ai.storyfork.core.episode.repository.*
import ai.storyfork.core.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.core.work.repository.WorkRepository
import ai.storyfork.core.work.entity.WorkEntity
import ai.storyfork.core.work.service.WorkAccessService
import ai.storyfork.core._common.exception.ContentFailure
import jakarta.persistence.EntityManager
import java.util.Optional
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.mockito.Mockito.*

class EpisodeDeletionTest {
    private val access=mock(WorkAccessService::class.java)
    private val works=mock(WorkRepository::class.java)
    private val episodes=mock(EpisodeRepository::class.java)
    private val drafts=mock(EpisodeDraftRepository::class.java)
    private val current=mock(EpisodeCurrentRepository::class.java)
    private val versions=mock(EpisodeVersionRepository::class.java)
    private val em=mock(EntityManager::class.java)
    private val service=EpisodeService(access,works,episodes,drafts,current,versions,false,em)
    private val episode=EpisodeEntity("e","w",1)
    private val draft=EpisodeDraftEntity("e","title","original",4)
    private val row=EpisodeCurrentEntity("e","w",1)
    private val work=WorkEntity(id="w",revision=5)
    private fun setup() {
        `when`(episodes.findByWorkIdAndSequence("w",1)).thenReturn(episode)
        `when`(episodes.findAllById(listOf("e"))).thenReturn(listOf(episode))
        `when`(episodes.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(episode))
        `when`(current.findByWorkIdAndSequence("w",1)).thenReturn(row)
        `when`(drafts.findAllById(listOf("e"))).thenReturn(listOf(draft))
        `when`(drafts.findById("e")).thenReturn(Optional.of(draft))
        `when`(works.findById("w")).thenReturn(Optional.of(work))
    }
    @Test fun `draft deletion retains episode and rejects a delayed save`() {
        setup()
        service.deleteDraft("w","owner",1,4)
        verify(access).own("w","owner")
        verify(drafts).delete(draft)
        verify(episodes,never()).delete(episode)
        assertEquals(5,episode.draftRevisionFloor)
    }
    @Test fun `deleted draft remains visible and old revision cannot recreate it`() {
        setup(); episode.draftRevisionFloor=5
        `when`(drafts.findAllById(listOf("e"))).thenReturn(emptyList())
        assertFalse(service.read("w","owner",1).hasDraft)
        val error=assertThrows(ContentFailure::class.java) { service.update("w","owner",1,DraftRequest("title","late",4)) }
        assertEquals(409,error.status)
        verify(drafts,never()).save(org.mockito.ArgumentMatchers.any(EpisodeDraftEntity::class.java))
    }
    @Test fun `reference prevents any physical deletion`() {
        setup(); `when`(episodes.referenceCount("e")).thenReturn(1)
        assertEquals(409,assertThrows(ContentFailure::class.java) {service.deleteEpisode("w","owner",1,4)}.status)
        verify(drafts,never()).delete(draft);verify(episodes,never()).delete(episode)
    }
    @Test fun `unreferenced last episode is physically removed`() {
        setup(); service.deleteEpisode("w","owner",1,4)
        verify(drafts).delete(draft);verify(episodes).delete(episode)
        assertEquals(6,work.revision)
    }
    @Test fun `ownership failure prevents every persistence operation`() {
        `when`(access.own("w","other")).thenThrow(ContentFailure(404,"missing"))
        assertThrows(ContentFailure::class.java) {service.deleteDraft("w","other",1,4)}
        verifyNoInteractions(episodes,drafts,versions)
    }
}
