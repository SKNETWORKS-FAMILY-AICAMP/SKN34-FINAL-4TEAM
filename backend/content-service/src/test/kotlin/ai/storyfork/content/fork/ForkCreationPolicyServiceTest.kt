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
        assertEquals(409,assertThrows(ContentFailure::class.java) {service.create("original","reader",ForkRequest(2,"포크"))}.status)
        noWrites()
        verify(forks,never()).saveAndFlush(org.mockito.ArgumentMatchers.any(ForkEntity::class.java))
    }
    @Test fun `fork after a suspended gap pins only public prefix and starts after basis number`() {
        original()
        val publicRows=listOf(1,3,4).map {PublishedEpisodeResponse(it,1,"v$it","${it}화","원문",false)}
        `when`(publication.publishedEpisodes("original")).thenReturn(PublishedEpisodeListResponse(publicRows))
        `when`(access.forkable("original",listOf(1,3,4))).thenReturn(listOf(1,3,4))
        `when`(world.historyForContext("original")).thenReturn(ai.storyfork.content.world.service.dto.SettingListResponse(emptyList()))
        `when`(workWorlds.saveAndFlush(org.mockito.ArgumentMatchers.any())).thenAnswer {it.arguments[0]}
        `when`(episodes.saveAndFlush(org.mockito.ArgumentMatchers.any())).thenAnswer {it.arguments[0]}
        `when`(workService.read(org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyString())).thenReturn(
            ai.storyfork.content.work.service.dto.WorkResponse("fork","포크","","private",false,false,null,emptyList(),null))
        service.create("original","reader",ForkRequest(3,"포크"))
        val created=mockingDetails(episodes).invocations.filter {it.method.name=="saveAndFlush"}.map {it.getArgument<ai.storyfork.content.episode.entity.EpisodeEntity>(0).sequence}
        assertEquals(listOf(1,3,4),created)
        val capture=mockingDetails(checkpoints).invocations.single {it.method.name=="capture"}.getArgument<ai.storyfork.content.episode_version.service.dto.CheckpointRequest>(0)
        assertEquals(listOf(1,3),capture.episodes.map {it.number})
    }

    @Test fun `suspended middle basis cannot create a fork`() {
        original()
        `when`(publication.publishedEpisodes("original")).thenReturn(PublishedEpisodeListResponse(listOf(PublishedEpisodeResponse(1,1,"v1","1화","원문",false),PublishedEpisodeResponse(3,1,"v3","3화","원문",false))))
        assertEquals(422,assertThrows(ContentFailure::class.java) {service.create("original","reader",ForkRequest(2,"포크"))}.status)
        noWrites()
    }

    @Test fun `fork copies the original published author note into its pinned version`() {
        `when`(access.get("original")).thenReturn(WorkAccessResult("original","author","제목","",0,"world","public",true,true,null))
        `when`(publication.publishedEpisodes("original")).thenReturn(PublishedEpisodeListResponse(listOf(PublishedEpisodeResponse(1,1,"v1","제목","본문",false,"원작 후기"))))
        `when`(access.forkable("original",listOf(1))).thenReturn(listOf(1))
        `when`(world.historyForContext("original")).thenReturn(ai.storyfork.content.world.service.dto.SettingListResponse(emptyList()))
        `when`(workWorlds.saveAndFlush(org.mockito.ArgumentMatchers.any(ai.storyfork.content.work.entity.WorkWorldHistoryEntity::class.java) ?: ai.storyfork.content.work.entity.WorkWorldHistoryEntity())).thenAnswer {it.arguments[0]}
        `when`(episodes.saveAndFlush(org.mockito.ArgumentMatchers.any(ai.storyfork.content.episode.entity.EpisodeEntity::class.java) ?: ai.storyfork.content.episode.entity.EpisodeEntity())).thenAnswer {it.arguments[0]}
        service.create("original","reader",ForkRequest(1,"분기"))
        val version=mockingDetails(versions).invocations.single {it.method.name=="saveAndFlush"}.getArgument<ai.storyfork.content.episode_version.entity.EpisodeVersionEntity>(0)
        assertEquals("원작 후기",version.authorNote)
        assertFalse(version.isSaved)
    }

    @Test fun `a soft deleted earlier Fork still blocks forking the same original again`() {
        // fork 테이블의 UNIQUE(owner_id,source_work_id)가 소프트 삭제 행에도 남으므로 저장 단계 500 대신 409로 막는다.
        original()
        `when`(access.forkable("original",listOf(1,2))).thenReturn(listOf(2))
        `when`(forks.findAllByOwnerIdAndSourceWorkId("reader","original")).thenReturn(listOf(ForkEntity(workId="gone",sourceWorkId="original",ownerId="reader")))
        assertEquals(409,assertThrows(ContentFailure::class.java) {service.create("original","reader",ForkRequest(2,"포크"))}.status)
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
