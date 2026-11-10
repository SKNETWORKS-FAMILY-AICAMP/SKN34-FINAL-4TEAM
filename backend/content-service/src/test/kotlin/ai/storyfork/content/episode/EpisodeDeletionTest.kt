package ai.storyfork.content.episode

import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content._common.exception.ContentFailure
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
    private val images=mock(ai.storyfork.content.attachment.repository.ContentImageRepository::class.java)
    @Suppress("UNCHECKED_CAST")
    private val imageProviders=mock(org.springframework.beans.factory.ObjectProvider::class.java) as org.springframework.beans.factory.ObjectProvider<ai.storyfork.content.attachment.repository.ContentImageRepository>
    private val service=EpisodeService(access,works,episodes,drafts,current,versions,imageProviders,em,
        mock(ai.storyfork.content.fork.repository.ForkRepository::class.java),mock(ai.storyfork.content.episode_version.repository.CheckpointEpisodeRepository::class.java),
        mock(ai.storyfork.content.publication.repository.PublicationEventRepository::class.java))
    private val episode=EpisodeEntity("e","w",1)
    private val draft=EpisodeDraftEntity("e","title","original",4)
    private val row=EpisodeCurrentEntity("e","w",1)
    private val work=WorkEntity(id="w",revision=5)
    private fun setup() {
        `when`(imageProviders.getIfAvailable()).thenReturn(images)
        `when`(current.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(row))
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
    @Test fun `delete conflict names every real condition instead of an unexplained reference`() {
        setup(); `when`(episodes.referenceCount("e")).thenReturn(1)
        val message=assertThrows(ContentFailure::class.java) {service.deleteEpisode("w","owner",1,4)}.message
        listOf("마지막 회차","저장 버전","발행본","이미지").forEach { assertTrue(message.contains(it),"$it: $message") }
    }
    @Test fun `an episode that is not the last written one cannot be deleted`() {
        setup()
        val next=EpisodeEntity("next","w",2)
        `when`(current.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(row,EpisodeCurrentEntity("next","w",2)))
        `when`(episodes.findAllById(listOf("e","next"))).thenReturn(listOf(episode,next))
        `when`(drafts.findAllById(listOf("e","next"))).thenReturn(listOf(draft,EpisodeDraftEntity("next","second","",0)))
        assertEquals(409,assertThrows(ContentFailure::class.java) {service.deleteEpisode("w","owner",1,4)}.status)
        assertNull(episode.deletedAt)
    }
    @Test fun `unreferenced last episode is marked deleted and keeps its draft`() {
        setup(); service.deleteEpisode("w","owner",1,4)
        verify(drafts,never()).delete(draft);verify(episodes,never()).delete(episode)
        assertNotNull(episode.deletedAt)
        assertEquals(6,work.revision)
        assertEquals(6,work.deletedEpisodeRevision)
    }
    @Test fun `inherited episodes have no order candidates even without a reference row`() {
        setup()
        row.inherited=true
        val scope=service.orderScope("w","owner",1)
        assertTrue(scope.candidateNumbers.isEmpty())
        assertFalse(scope.executable)
    }
    @Test fun `future setting placeholder does not become a writing candidate`() {
        setup()
        val placeholder=EpisodeEntity("future","w",10)
        `when`(episodes.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(episode,placeholder))
        `when`(episodes.referenceCount("future")).thenReturn(1)
        assertEquals(listOf(1),service.orderScope("w","owner",1).candidateNumbers)
    }
    @Test fun `new episode reuses the hidden number with a fresh ID and edit revision`() {
        setup()
        episode.basisWorldId=java.util.UUID.randomUUID();episode.basisWorldRevisionId=java.util.UUID.randomUUID();episode.basisRevision=3
        service.deleteEpisode("w","owner",1,4)
        `when`(episodes.findByWorkIdAndSequence("w",1)).thenReturn(null)
        `when`(current.findAllByWorkIdOrderBySequence("w")).thenReturn(emptyList())
        lateinit var replacement: EpisodeEntity
        lateinit var replacementDraft: EpisodeDraftEntity
        doAnswer { replacement=it.getArgument(0);replacement }.`when`(episodes).saveAndFlush(any(EpisodeEntity::class.java))
        doAnswer { replacementDraft=it.getArgument(0);replacementDraft }.`when`(drafts).save(any(EpisodeDraftEntity::class.java))
        `when`(current.findByWorkIdAndSequence("w",1)).thenAnswer { EpisodeCurrentEntity(replacement.id,"w",1) }
        `when`(drafts.findAllById(anyCollection())).thenAnswer { listOf(replacementDraft) }
        val created=service.create("w","owner",ai.storyfork.content.episode.service.dto.CreateEpisodeRequest("새 회차"))
        assertEquals(1,created.number)
        assertNotEquals(episode.id,replacement.id)
        assertEquals(6,created.draft.revision)
        // 기준 세계관은 삭제된 행에 남을 뿐 같은 번호의 새 회차로 넘어가지 않는다(UC-10).
        assertNotNull(episode.basisWorldId)
        assertNull(replacement.basisWorldId);assertNull(replacement.basisWorldRevisionId);assertEquals(0,replacement.basisRevision)
    }
    @Test fun `disabled image metadata must not be assumed empty`() {
        setup()
        `when`(imageProviders.getIfAvailable()).thenReturn(null)
        assertThrows(ContentFailure::class.java) {service.deleteEpisode("w","owner",1,4)}
    }
    @Test fun `creating after chapter one ignores future setting rows`() {
        setup()
        `when`(episodes.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(episode,EpisodeEntity("future","w",10)))
        `when`(current.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(row))
        val next=EpisodeEntity("next","w",2)
        `when`(episodes.findByWorkIdAndSequence("w",2)).thenReturn(next)
        `when`(current.findByWorkIdAndSequence("w",2)).thenReturn(EpisodeCurrentEntity("next","w",2))
        `when`(episodes.findAllById(listOf("next"))).thenReturn(listOf(next))
        `when`(drafts.findAllById(listOf("next"))).thenReturn(listOf(EpisodeDraftEntity("next","second","",0)))
        assertEquals(2,service.create("w","owner",ai.storyfork.content.episode.service.dto.CreateEpisodeRequest("second")).number)
    }
    @Test fun `existing image blocks deletion even without any content references`() {
        setup(); `when`(images.countByWorkIdAndEpisodeNo("w",1)).thenReturn(1)
        assertEquals(409,assertThrows(ContentFailure::class.java) {service.deleteEpisode("w","owner",1,4)}.status)
        verify(drafts,never()).delete(draft);verify(episodes,never()).delete(episode)
    }
    @Test fun `image store failure does not authorize deletion`() {
        setup(); `when`(images.countByWorkIdAndEpisodeNo("w",1)).thenThrow(org.springframework.dao.DataAccessResourceFailureException("private database details"))
        val failure=assertThrows(ContentFailure::class.java) {service.deleteEpisode("w","owner",1,4)}
        assertEquals(503,failure.status);assertFalse(failure.message.contains("private database"))
        verify(episodes,never()).delete(episode)
    }
    @Test fun `future placeholder does not prevent deleting last written chapter`() {
        setup(); `when`(episodes.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(episode,EpisodeEntity("future","w",10)))
        service.deleteEpisode("w","owner",1,4)
        assertNotNull(episode.deletedAt)
        verify(episodes,never()).delete(episode)
    }
    @Test fun `ownership failure prevents every persistence operation`() {
        `when`(access.own("w","other")).thenThrow(ContentFailure(404,"missing"))
        assertThrows(ContentFailure::class.java) {service.deleteDraft("w","other",1,4)}
        verifyNoInteractions(episodes,drafts,versions)
    }
}
