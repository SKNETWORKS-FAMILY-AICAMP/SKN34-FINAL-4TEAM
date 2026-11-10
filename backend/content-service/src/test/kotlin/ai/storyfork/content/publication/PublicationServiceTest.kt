package ai.storyfork.content.publication

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.entity.EpisodeVersionEntity
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.publication.entity.*
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.*
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import jakarta.persistence.EntityManager
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import java.util.Optional

@ExtendWith(MockitoExtension::class)
class PublicationServiceTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var episodeService: EpisodeService
    @Mock lateinit var episodes: EpisodeRepository
    @Mock lateinit var current: EpisodeCurrentRepository
    @Mock lateinit var versions: EpisodeVersionRepository
    @Mock lateinit var events: PublicationEventRepository
    @Mock lateinit var visibility: WorkPublicationHistoryRepository
    @Mock lateinit var rights: WorkRightsDeclarationRepository
    @Mock lateinit var drafts: EpisodeDraftRepository
    @Mock lateinit var works: WorkRepository
    @Mock lateinit var policies: ForkPolicyHistoryRepository
    @Mock lateinit var selectedPolicyEpisodes: ForkPolicyEpisodeRepository
    @Mock lateinit var em: EntityManager
    @Mock lateinit var interests: ai.storyfork.content.interest.service.WorkInterestService
    @InjectMocks lateinit var service: PublicationService

    private val work=WorkAccessResult("w","owner","제목","",4,"world","public",true,true,null)
    private val version=EpisodeVersionEntity(id="ev",episodeId="e",contentVersionId="v",title="제목",content="본문",isSaved=true)
    private fun prepare(status: String, inherited: Boolean=false) {
        `when`(access.own("w","owner")).thenReturn(work)
        `when`(episodeService.read("w","owner",2)).thenReturn(EpisodeResponse(2,DraftResponse("제목","초안",4),emptyList(),if(status=="published") "v" else null,inherited,null,publicationStatus=status))
    }
    private fun history(action: String) {
        `when`(episodes.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(EpisodeEntity(id="e",workId="w",sequence=2)))
        `when`(versions.findAllByEpisodeIdInOrderByCreatedAtAscIdAsc(setOf("e"))).thenReturn(listOf(version))
        `when`(events.findAllByEpisodeVersionIdInOrderByOccurredAtAscIdAsc(setOf("ev"))).thenReturn(listOf(PublicationEventEntity(id="old",episodeVersionId="ev",action=action,outcome="applied")))
    }
    private fun writable() {
        `when`(episodes.findByWorkIdAndSequence("w",2)).thenReturn(EpisodeEntity(id="e",workId="w",sequence=2))
        `when`(versions.findByEpisodeIdAndContentVersionId("e","v")).thenReturn(version)
        `when`(works.findById("w")).thenReturn(Optional.of(WorkEntity(id="w",revision=4)))
        `when`(drafts.findById("e")).thenReturn(Optional.of(EpisodeDraftEntity(episodeId="e",editRevision=4)))
    }
    private fun savedAction() = mockingDetails(events).invocations.single {it.method.name=="saveAndFlush"}.getArgument<PublicationEventEntity>(0)

    @Test fun `suspend appends an event without rewriting stored versions`() {
        prepare("published");writable()
        service.visibility("w","owner",2,PublicationVisibilityRequest(4,false))
        assertEquals("unpublish",savedAction().action)
        assertEquals("ev",savedAction().episodeVersionId)
        verifyNoInteractions(rights,visibility,interests)
        verify(versions,never()).save(any(EpisodeVersionEntity::class.java))
    }
    @Test fun `republish restores suspended version and rechecks rights`() {
        prepare("suspended");history("unpublish");writable()
        service.visibility("w","owner",2,PublicationVisibilityRequest(4,true,true))
        assertEquals("republish",savedAction().action)
        verifyNoInteractions(interests)
        assertEquals("ev",savedAction().episodeVersionId)
        verify(episodeService).requireImageReferences("w",2,"본문")
    }
    @Test fun `stale inherited draft and repeated transitions do not write`() {
        for ((status,inherited,request) in listOf(
            Triple("published",false,PublicationVisibilityRequest(3,false)),
            Triple("published",true,PublicationVisibilityRequest(4,false)),
            Triple("draft",false,PublicationVisibilityRequest(4,true,true)),
            Triple("suspended",false,PublicationVisibilityRequest(4,false)),
            Triple("published",false,PublicationVisibilityRequest(4,true,true)),
            Triple("suspended",false,PublicationVisibilityRequest(4,true,false)))) {
            prepare(status,inherited)
            assertThrows(ContentFailure::class.java) {service.visibility("w","owner",2,request)}
        }
        verifyNoInteractions(events,versions,works)
    }
    @Test fun `unauthorized user cannot change visibility`() {
        `when`(access.own("w","other")).thenThrow(ContentFailure(404,"없음"))
        assertThrows(ContentFailure::class.java) {service.visibility("w","other",2,PublicationVisibilityRequest(4,false))}
        verifyNoInteractions(events,versions,episodeService)
    }
    @Test fun `history includes transitions and excludes failed events`() {
        history("publish")
        `when`(events.findAllByEpisodeVersionIdInOrderByOccurredAtAscIdAsc(setOf("ev"))).thenReturn(
            listOf("publish","replace","unpublish","republish").map {PublicationEventEntity(episodeVersionId="ev",action=it,outcome="applied")}+
            PublicationEventEntity(episodeVersionId="ev",action="replace",outcome="failed"))
        assertEquals(listOf("publish","replace","unpublish","republish"),service.history("w").items.map {it.action})
    }
    @Test fun `next episode never reuses a suspended number`() {
        `when`(current.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(
            EpisodeCurrentEntity(id="1",sequence=1,publishedVersionId="v1",publicationStatus="published"),
            EpisodeCurrentEntity(id="2",sequence=2,publicationStatus="suspended"),
            EpisodeCurrentEntity(id="3",sequence=3,publicationStatus="draft")))
        assertEquals(3,service.nextEpisodeNumber("w"))
    }
    @Test fun `restricted work cannot be republished`() {
        prepare("suspended")
        `when`(access.own("w","owner")).thenReturn(work.copy(restricted=true))
        assertEquals(403,assertThrows(ContentFailure::class.java) {service.visibility("w","owner",2,PublicationVisibilityRequest(4,true,true))}.status)
        verifyNoInteractions(events,versions,works)
    }
    /** 공개를 중단해 비공개로 돌아온 Fork다. 원작의 Fork 공개 허용은 [sourceAllows]다. */
    private fun stoppedFork(sourceAllows: Boolean) {
        val source=ai.storyfork.content.fork.service.dto.SourceResponse("src","원작",1,1,"분기")
        `when`(access.own("w","owner")).thenReturn(work.copy(visibility="private",source=source))
        `when`(access.get("src")).thenReturn(WorkAccessResult("src","author","원작","",0,"world","public",true,sourceAllows,null))
    }
    @Test fun `stopped Fork cannot be republished after the source revokes Fork publication`() {
        prepare("suspended");stoppedFork(false)
        assertEquals(403,assertThrows(ContentFailure::class.java) {service.visibility("w","owner",2,PublicationVisibilityRequest(4,true,true))}.status)
        verifyNoInteractions(events,versions,works)
    }
    @Test fun `stopped Fork becomes public again while the source still allows Fork publication`() {
        prepare("suspended");history("unpublish");writable();stoppedFork(true)
        `when`(visibility.findFirstByWorkIdOrderByRevisionNoDesc("w")).thenReturn(WorkPublicationHistoryEntity(workId="w",revisionNo=2,visibility="private"))
        service.visibility("w","owner",2,PublicationVisibilityRequest(4,true,true))
        val reopened=mockingDetails(visibility).invocations.single {it.method.name=="save"}.getArgument<WorkPublicationHistoryEntity>(0)
        assertEquals("public",reopened.visibility)
        assertEquals(3,reopened.revisionNo)
    }
    @Test fun `visibility change advances revision even when the draft was deleted`() {
        prepare("published");writable()
        val row=EpisodeEntity(id="e",workId="w",sequence=2,draftRevisionFloor=4)
        `when`(episodes.findByWorkIdAndSequence("w",2)).thenReturn(row)
        `when`(drafts.findById("e")).thenReturn(Optional.empty())
        service.visibility("w","owner",2,PublicationVisibilityRequest(4,false))
        assertEquals(5,row.draftRevisionFloor)
    }

    @Test fun `replacement and checkpoint rollback do not send a new episode notification`() {
        prepare("published");writable()
        val saved=ai.storyfork.content.episode_version.service.dto.VersionResponse("v","제목","본문",1,2,"2026-11-01T00:00:00Z")
        `when`(episodeService.read("w","owner",2)).thenReturn(EpisodeResponse(2,DraftResponse("제목","초안",4),listOf(saved),"previous",false,null))
        `when`(current.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(EpisodeCurrentEntity(id="e",sequence=2,publishedVersionId="previous")))
        service.publishEpisode("w","owner",2,PublishRequest(4,true,versionId="v"))
        assertEquals("replace",savedAction().action)
        verifyNoInteractions(interests)
    }

}
