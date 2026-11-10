package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.like.service.WorkLikeService
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
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
import java.util.Optional
import ai.storyfork.content.work.entity.WorkEntity

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
    @Mock lateinit var viewService: WorkViewService
    @Mock lateinit var nicknames: ai.storyfork.content.auth.service.CoreNicknameService
    @Mock lateinit var likeService: WorkLikeService
    @Mock lateinit var schedules: PublicationScheduleRepository
    @InjectMocks lateinit var service: WorkService

    private val work=WorkAccessResult("work","author","작품","소개",0,"world","private",false,false,null)
    private val row=WorkEntity(id=work.id,ownerId="author",title="작품")
    private val deletedSource=SourceResponse("source","원작",1,1,"분기",deleted=true)

    @Test fun `unauthorized deletion returns 404 without touching any row`() {
        `when`(access.own(work.id,"intruder")).thenThrow(ContentFailure(404,"작품을 찾을 수 없어요."))

        val failure=assertThrows(ContentFailure::class.java) { service.delete(work.id,"intruder") }

        assertEquals(404,failure.status)
        verifyNoInteractions(works)
    }

    @Test fun `deleting records only the deletion time and removes no rows`() {
        `when`(access.own(work.id,"author")).thenReturn(work)
        `when`(works.findById(work.id)).thenReturn(Optional.of(row))

        service.delete(work.id,"author")

        assertNotNull(row.deletedAt)
        verify(works).saveAndFlush(row)
    }

    @Test fun `a Fork and a work with settings can be deleted too`() {
        `when`(access.own(work.id,"author")).thenReturn(work.copy(source=SourceResponse("source","원작",1,1,"분기")))
        `when`(works.findById(work.id)).thenReturn(Optional.of(row))

        service.delete(work.id,"author")

        assertNotNull(row.deletedAt)
    }

    @Test fun `readers of a Fork whose source was deleted do not see the inherited episode bodies`() {
        `when`(access.published(work.id)).thenReturn(work.copy(visibility="public",source=deletedSource))
        `when`(publication.publishedEpisodes(work.id)).thenReturn(PublishedEpisodeListResponse(listOf(
            PublishedEpisodeResponse(1,1,"v1","분기 전","원작 본문",true),
            PublishedEpisodeResponse(2,1,"v2","내 회차","내 본문",false))))

        val episodes=service.publicEpisodes(work.id)

        assertEquals(listOf(1,2),episodes.map {it.number})
        assertEquals("",episodes[0].body)
        assertEquals("분기 전",episodes[0].title)
        assertEquals("내 본문",episodes[1].body)
    }

    @Test fun `readers of a Fork whose source still exists keep the inherited episodes`() {
        `when`(access.published(work.id)).thenReturn(work.copy(visibility="public",source=SourceResponse("source","원작",1,1,"분기")))
        `when`(publication.publishedEpisodes(work.id)).thenReturn(PublishedEpisodeListResponse(listOf(
            PublishedEpisodeResponse(1,1,"v1","분기 전","원작 본문",true))))

        assertEquals("원작 본문",service.publicEpisodes(work.id).single().body)
    }

    @Test fun `the owner list leaves out deleted works`() {
        val gone=WorkEntity(id="gone",ownerId="author",title="삭제").also {it.deletedAt=java.time.Instant.now()}
        `when`(works.findAllByOwnerIdOrderByCreatedAtDesc("author")).thenReturn(listOf(gone))

        assertTrue(service.list("author").items.isEmpty())
    }
}
