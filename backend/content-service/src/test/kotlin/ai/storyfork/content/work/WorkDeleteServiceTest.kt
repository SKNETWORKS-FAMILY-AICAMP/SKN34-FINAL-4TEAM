package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.entity.EpisodeEntity
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.*
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.repository.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import org.springframework.dao.DataIntegrityViolationException

@ExtendWith(MockitoExtension::class)
class WorkDeleteServiceTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var members: ContentMemberService
    @Mock lateinit var works: WorkRepository
    @Mock lateinit var worlds: WorldRepository
    @Mock lateinit var workWorlds: WorkWorldHistoryRepository
    @Mock lateinit var visibility: WorkPublicationHistoryRepository
    @Mock lateinit var policies: ForkPolicyHistoryRepository
    @Mock lateinit var selectedPolicyEpisodes: ForkPolicyEpisodeRepository
    @Mock lateinit var genreRows: GenreRepository
    @Mock lateinit var workGenres: WorkGenreRepository
    @Mock lateinit var hashtagRows: WorkHashtagRepository
    @Mock lateinit var rightsRows: WorkRightsDeclarationRepository
    @Mock lateinit var episodes: EpisodeRepository
    @Mock lateinit var drafts: EpisodeDraftRepository
    @Mock lateinit var publication: PublicationService
    @Mock lateinit var versions: EpisodeVersionService
    @Mock lateinit var proposals: ProposalService
    @Mock lateinit var settings: SettingDocumentRepository
    @Mock lateinit var viewService: WorkViewService
    @InjectMocks lateinit var service: WorkService

    private val work=WorkAccessResult("work","author","작품","소개",0,"world","private",false,false,null)
    private val episode=EpisodeEntity(id="episode",workId=work.id,sequence=1)
    private fun own(source: SourceResponse? = null) {
        `when`(access.own(work.id,"author")).thenReturn(work.copy(source=source))
    }
    private fun noDeletionInteractions() = verifyNoInteractions(
        works,worlds,workWorlds,visibility,policies,workGenres,hashtagRows,rightsRows,episodes,drafts,
        members,genreRows,publication,versions,proposals,viewService,
    )

    @Test fun `unauthorized deletion returns 404 without looking up settings`() {
        `when`(access.own(work.id,"intruder")).thenThrow(ContentFailure(404,"작품을 찾을 수 없어요."))

        val failure=assertThrows(ContentFailure::class.java) { service.delete(work.id,"intruder") }

        assertEquals(404,failure.status)
        assertEquals("작품을 찾을 수 없어요.",failure.message)
        verifyNoInteractions(settings)
        noDeletionInteractions()
    }

    @Test fun `world settings return a clear 409 before any deletions`() {
        own()
        `when`(settings.existsByWorldId(work.worldId)).thenReturn(true)

        val failure=assertThrows(ContentFailure::class.java) { service.delete(work.id,"author") }

        assertEquals(409,failure.status)
        assertTrue(failure.message.contains("설정"))
        val ordered=inOrder(access,settings)
        ordered.verify(access).own(work.id,"author")
        ordered.verify(settings).existsByWorldId(work.worldId)
        verifyNoMoreInteractions(settings)
        noDeletionInteractions()
    }

    @Test fun `an empty world keeps the existing successful deletion path`() {
        own()
        `when`(settings.existsByWorldId(work.worldId)).thenReturn(false)
        val rows=listOf(episode)
        `when`(episodes.findAllByWorkIdOrderBySequence(work.id)).thenReturn(rows)

        service.delete(work.id,"author")

        val ordered=inOrder(access,settings,episodes,drafts,workGenres,hashtagRows,rightsRows,workWorlds,visibility,policies,works,worlds)
        ordered.verify(access).own(work.id,"author")
        ordered.verify(settings).existsByWorldId(work.worldId)
        ordered.verify(episodes).findAllByWorkIdOrderBySequence(work.id)
        ordered.verify(drafts).deleteAllById(listOf(episode.id))
        ordered.verify(episodes).deleteAll(rows)
        ordered.verify(workGenres).deleteAllByWorkId(work.id)
        ordered.verify(hashtagRows).deleteAllByWorkId(work.id)
        ordered.verify(rightsRows).deleteAllByWorkId(work.id)
        ordered.verify(workWorlds).deleteAllByWorkId(work.id)
        ordered.verify(visibility).deleteAllByWorkId(work.id)
        ordered.verify(policies).deleteAllByWorkId(work.id)
        ordered.verify(works).deleteById(work.id)
        ordered.verify(worlds).deleteById(work.worldId)
        ordered.verify(works).flush()
        verifyNoMoreInteractions(settings)
    }

    @Test fun `Fork deletion remains blocked before settings lookup or mutation`() {
        own(SourceResponse("source","원작",1,1,"분기"))

        val failure=assertThrows(ContentFailure::class.java) { service.delete(work.id,"author") }

        assertEquals(409,failure.status)
        assertEquals("분기 작품은 아직 삭제할 수 없어요.",failure.message)
        verifyNoInteractions(settings)
        noDeletionInteractions()
    }

    @Test fun `saved version FK failure remains a sanitized 409`() {
        own()
        val rows=listOf(episode)
        `when`(episodes.findAllByWorkIdOrderBySequence(work.id)).thenReturn(rows)
        doThrow(DataIntegrityViolationException("episode_version foreign key")).`when`(episodes).deleteAll(rows)

        val failure=assertThrows(ContentFailure::class.java) { service.delete(work.id,"author") }

        assertEquals(409,failure.status)
        assertEquals("발행·저장 이력이 있거나 분기된 작품은 삭제할 수 없어요.",failure.message)
        verifyNoInteractions(works,worlds,workGenres,hashtagRows,rightsRows,workWorlds,visibility,policies)
    }
}
