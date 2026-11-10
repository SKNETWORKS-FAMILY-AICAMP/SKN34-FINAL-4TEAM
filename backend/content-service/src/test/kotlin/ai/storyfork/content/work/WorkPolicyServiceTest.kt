package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.entity.EpisodeEntity
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.like.service.WorkLikeService
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.*
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.*
import ai.storyfork.content.work.service.dto.*
import ai.storyfork.content.world.repository.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import java.util.Optional

@ExtendWith(MockitoExtension::class)
class WorkPolicyServiceTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var members: ContentMemberService
    @Mock lateinit var works: WorkRepository
    @Mock lateinit var worlds: WorldRepository
    @Mock lateinit var settings: SettingDocumentRepository
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

    private val work=WorkAccessResult("w","owner","제목","소개",4,"world","public",true,true,null)
    private fun own() { `when`(access.own("w","owner")).thenReturn(work) }
    private fun response() {
        `when`(works.findById("w")).thenReturn(Optional.of(WorkEntity(id="w",ownerId="owner",revision=4,slug="old-link",authorName="표시 작가")))
        `when`(publication.publishedEpisodes("w")).thenReturn(PublishedEpisodeListResponse(listOf(PublishedEpisodeResponse(1,1,"v1","1화","원고",false),PublishedEpisodeResponse(2,1,"v2","2화","원고",false))))
        // 작가명은 소유자의 Core 닉네임이다. 작품 행의 author_name("표시 작가")은 읽지 않는다.
        `when`(nicknames.nicknames(listOf("owner"))).thenReturn(mapOf("owner" to "코어 닉네임"))
    }

    @Test fun `stopping publication appends one private entry for a public Fork`() {
        val source=ai.storyfork.content.fork.service.dto.SourceResponse("original","원작",1,1,"분기")
        val row=WorkEntity(id="w",ownerId="owner",revision=4)
        `when`(access.own("w","owner")).thenReturn(work.copy(source=source))
        `when`(visibility.findFirstByWorkIdOrderByRevisionNoDesc("w")).thenReturn(
            ai.storyfork.content.publication.entity.WorkPublicationHistoryEntity(workId="w",revisionNo=2,visibility="public"),
            ai.storyfork.content.publication.entity.WorkPublicationHistoryEntity(workId="w",revisionNo=3,visibility="private")
        )
        `when`(works.findById("w")).thenReturn(Optional.of(row))
        repeat(2) { service.stopForkPublication("w","owner") }
        val event=mockingDetails(visibility).invocations.single {it.method.name=="save"}.getArgument<ai.storyfork.content.publication.entity.WorkPublicationHistoryEntity>(0)
        assertEquals("private",event.visibility)
        assertEquals(3,event.revisionNo)
        assertEquals(5,row.revision)
        verify(schedules).findAllByWorkIdAndStatus("w","pending") // 반복 호출은 비공개 상태에서 바로 끝난다
        verifyNoInteractions(episodes,drafts,publication)
    }

    private val forkSource=ai.storyfork.content.fork.service.dto.SourceResponse("original","원작",1,1,"분기")
    private fun pendingSchedule(id: String,episode: String)=
        ai.storyfork.content.publication.entity.PublicationScheduleEntity(id=id,workId="w",episodeId=episode,ownerId="owner",versionId="v-$episode",scheduledAt=java.time.Instant.now().plusSeconds(3600))

    @Test fun `stopping publication cancels the pending scheduled publications of the Fork`() {
        `when`(access.own("w","owner")).thenReturn(work.copy(source=forkSource))
        `when`(visibility.findFirstByWorkIdOrderByRevisionNoDesc("w")).thenReturn(ai.storyfork.content.publication.entity.WorkPublicationHistoryEntity(workId="w",revisionNo=2,visibility="public"))
        `when`(works.findById("w")).thenReturn(Optional.of(WorkEntity(id="w",ownerId="owner",revision=4)))
        val third=pendingSchedule("s3","e3");val fourth=pendingSchedule("s4","e4")
        `when`(schedules.findAllByWorkIdAndStatus("w","pending")).thenReturn(listOf(third,fourth))
        service.stopForkPublication("w","owner")
        assertEquals(listOf("canceled","canceled"),listOf(third.status,fourth.status))
        assertNotNull(third.completedAt)
    }

    @Test fun `stopping a Fork that is not public keeps its pending scheduled publications`() {
        `when`(access.own("w","owner")).thenReturn(work.copy(source=forkSource))
        `when`(visibility.findFirstByWorkIdOrderByRevisionNoDesc("w")).thenReturn(ai.storyfork.content.publication.entity.WorkPublicationHistoryEntity(workId="w",revisionNo=0,visibility="private"))
        service.stopForkPublication("w","owner")
        verifyNoInteractions(schedules,works)
    }

    @Test fun `stopping Fork publication rejects an original`() {
        own()
        assertEquals(404,assertThrows(ContentFailure::class.java) {service.stopForkPublication("w","owner")}.status)
        verifyNoInteractions(visibility,works)
    }

    @Test fun `selected policy resolves published episode IDs and returns real reading metadata`() {
        own();response()
        `when`(episodes.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(EpisodeEntity(id="e1",workId="w",sequence=1),EpisodeEntity(id="e2",workId="w",sequence=2)))
        var saved: ForkPolicyHistoryEntity?=null
        doAnswer { saved=it.getArgument(0); saved }.`when`(policies).saveAndFlush(org.mockito.ArgumentMatchers.any(ForkPolicyHistoryEntity::class.java))
        val result=service.policy("w","owner",PolicyRequest(4,true,false,"selected",episodes=listOf(2)))
        assertEquals("selected",saved!!.episodeScope)
        val selections=mockingDetails(selectedPolicyEpisodes).invocations.single {it.method.name=="saveAll"}.getArgument<Iterable<ForkPolicyEpisodeEntity>>(0)
        assertEquals(listOf(Triple(saved!!.id,"e2","w")),selections.map {Triple(it.policyHistoryId,it.episodeId,it.workId)})
        assertEquals("old-link",result.slug)
        assertEquals("코어 닉네임",result.authorName)
        assertEquals("owner",result.ownerId)
    }

    @Test fun `boolean only policy changes retain from boundary`() {
        own();response()
        `when`(policies.findFirstByWorkIdOrderByRevisionNoDesc("w")).thenReturn(ForkPolicyHistoryEntity(id="old",workId="w",episodeScope="from",startEpisodeId="e2",revisionNo=3))
        var saved: ForkPolicyHistoryEntity?=null
        doAnswer { saved=it.getArgument(0); saved }.`when`(policies).saveAndFlush(org.mockito.ArgumentMatchers.any(ForkPolicyHistoryEntity::class.java))
        service.policy("w","owner",PolicyRequest(4,false,false))
        assertEquals("from",saved!!.episodeScope)
        assertEquals("e2",saved!!.startEpisodeId)
    }

    @Test fun `from policy points to the active episode ID when a number was reused`() {
        own();response()
        `when`(episodes.findByWorkIdAndSequence("w",2)).thenReturn(EpisodeEntity(id="replacement",workId="w",sequence=2))
        service.policy("w","owner",PolicyRequest(4,true,false,"from",fromEpisode=2))
        val saved=mockingDetails(policies).invocations.single {it.method.name=="saveAndFlush"}.getArgument<ForkPolicyHistoryEntity>(0)
        assertEquals("replacement",saved.startEpisodeId)
    }

    @Test fun `invalid scope and unpublished selected episode fail without writes`() {
        own()
        for(data in listOf(PolicyRequest(4,true,true,"unknown"),PolicyRequest(4,true,true,"selected",episodes=listOf(99)))) {
            if(data.episodeScope=="selected") {
                `when`(publication.publishedEpisodes("w")).thenReturn(PublishedEpisodeListResponse(emptyList()))
            }
            assertEquals(422,assertThrows(ContentFailure::class.java) { service.policy("w","owner",data) }.status)
        }
        verifyNoInteractions(selectedPolicyEpisodes,works)
        verify(policies,never()).saveAndFlush(org.mockito.ArgumentMatchers.any(ForkPolicyHistoryEntity::class.java))
    }

    @Test fun `another owner and stale revision cannot change policy`() {
        `when`(access.own("w","intruder")).thenThrow(ContentFailure(404,"찾을 수 없어요"))
        assertEquals(404,assertThrows(ContentFailure::class.java) { service.policy("w","intruder",PolicyRequest(4,true,true)) }.status)
        own()
        doThrow(ContentFailure(409,"변경됨")).`when`(access).requireRevision(work,3)
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.policy("w","owner",PolicyRequest(3,true,true)) }.status)
        verifyNoInteractions(policies,selectedPolicyEpisodes,works)
    }
}
