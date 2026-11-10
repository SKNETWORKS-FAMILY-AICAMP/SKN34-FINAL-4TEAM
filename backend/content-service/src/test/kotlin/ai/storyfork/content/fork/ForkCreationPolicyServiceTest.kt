package ai.storyfork.content.fork

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.fork.entity.ForkEntity
import ai.storyfork.content.fork.repository.*
import ai.storyfork.content.fork.service.ForkService
import ai.storyfork.content.fork.service.dto.ChangeRequest
import ai.storyfork.content.fork.service.dto.ForkRequest
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.publication.repository.WorkPublicationHistoryRepository
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.*
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.service.WorldService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension

@ExtendWith(MockitoExtension::class)
class ForkCreationPolicyServiceTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var members: ContentMemberService
    @Mock lateinit var workService: WorkService
    @Mock lateinit var publication: PublicationService
    @Mock lateinit var world: WorldService
    @Mock lateinit var checkpoints: EpisodeVersionService
    @Mock lateinit var works: WorkRepository
    @Mock lateinit var workWorlds: WorkWorldHistoryRepository
    @Mock lateinit var visibility: WorkPublicationHistoryRepository
    @Mock lateinit var policies: ForkPolicyHistoryRepository
    @Mock lateinit var episodes: EpisodeRepository
    @Mock lateinit var drafts: EpisodeDraftRepository
    @Mock lateinit var versions: EpisodeVersionRepository
    @Mock lateinit var forks: ForkRepository
    @Mock lateinit var references: ForkWorldReferenceRepository
    @Mock lateinit var changes: ForkSourceChangeRepository
    @Mock lateinit var decisions: ForkChangeDecisionRepository
    @Mock lateinit var applications: ForkChangeApplicationRepository
    @InjectMocks lateinit var service: ForkService

    private fun original() {
        `when`(access.get("original")).thenReturn(WorkAccessResult("original","author","제목","",0,"world","public",true,true,null))
        `when`(publication.publishedEpisodes("original")).thenReturn(PublishedEpisodeListResponse(listOf(
            PublishedEpisodeResponse(1,1,"v1","1화","원문",false),
            PublishedEpisodeResponse(2,1,"v2","2화","원문",false)
        )))
    }
    private fun noWrites() = verifyNoInteractions(members,workService,world,checkpoints,works,workWorlds,visibility,policies,episodes,drafts,versions,references,changes,decisions,applications)

    @Test fun `unpublished basis is rejected before member or checkpoint writes`() {
        original()
        assertEquals(422,assertThrows(ContentFailure::class.java) {service.create("original","reader",ForkRequest(3,"포크"))}.status)
        noWrites()
        verifyNoInteractions(forks)
    }

    @Test fun `published but forbidden episode is rejected before member or checkpoint writes`() {
        original()
        `when`(access.forkable("original",listOf(1,2))).thenReturn(listOf(2))
        assertEquals(403,assertThrows(ContentFailure::class.java) {service.create("original","reader",ForkRequest(1,"포크"))}.status)
        noWrites()
        verifyNoInteractions(forks)
    }

    @Test fun `duplicate source is rejected without a second work or checkpoint`() {
        original()
        `when`(access.forkable("original",listOf(1,2))).thenReturn(listOf(2))
        `when`(forks.findAllByOwnerIdAndSourceWorkId("reader","original")).thenReturn(listOf(ForkEntity(workId="existing",sourceWorkId="original",ownerId="reader")))
        `when`(access.get("existing")).thenReturn(fork("existing",deleted=false))
        assertEquals(409,assertThrows(ContentFailure::class.java) {service.create("original","reader",ForkRequest(2,"포크"))}.status)
        noWrites()
        verify(forks,never()).saveAndFlush(org.mockito.ArgumentMatchers.any(ForkEntity::class.java))
    }

    @Test fun `a soft deleted earlier Fork does not block forking the same original again`() {
        original()
        `when`(access.forkable("original",listOf(1,2))).thenReturn(listOf(2))
        `when`(forks.findAllByOwnerIdAndSourceWorkId("reader","original")).thenReturn(listOf(ForkEntity(workId="gone",sourceWorkId="original",ownerId="reader")))
        `when`(access.get("gone")).thenReturn(fork("gone",deleted=true))
        // 중복 검사를 통과하면 다음 입력 검사(빈 제목)에서 422로 멈춘다.
        assertEquals(422,assertThrows(ContentFailure::class.java) {service.create("original","reader",ForkRequest(2," "))}.status)
        noWrites()
    }

    @Test fun `the Fork owner can still reject a change from a deleted original`() {
        `when`(access.own("fork","reader")).thenReturn(fork("fork",deleted=false,sourceDeleted=true))
        `when`(world.read("fork","reader")).thenThrow(ContentFailure(418,"검사 통과"))
        assertEquals(418,assertThrows(ContentFailure::class.java) {service.decideChange("fork","reader",ChangeRequest(0,"c","reject"))}.status)
    }

    @Test fun `applying a change from a deleted original stays blocked`() {
        `when`(access.own("fork","reader")).thenReturn(fork("fork",deleted=false,sourceDeleted=true))
        assertEquals(409,assertThrows(ContentFailure::class.java) {service.decideChange("fork","reader",ChangeRequest(0,"c","apply"))}.status)
        verifyNoInteractions(world)
    }

    private fun fork(id: String,deleted: Boolean,sourceDeleted: Boolean=false) = WorkAccessResult(id,"reader","포크","",0,"world","private",false,false,
        SourceResponse("original","제목",2,1,"",deleted=sourceDeleted),deleted=deleted)
}
