package ai.storyfork.content.publication

import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode_version.entity.EpisodeVersionEntity
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.interest.service.WorkInterestService
import ai.storyfork.content.publication.entity.PublicationEventEntity
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishRequest
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import jakarta.persistence.EntityManager
import java.time.Instant
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.mockito.ArgumentMatchers
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension

@ExtendWith(MockitoExtension::class)
class PublicationPolicyServiceTest {
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
    @Mock lateinit var interests: WorkInterestService
    @InjectMocks lateinit var service: PublicationService

    @Test
    fun `publishing asks for the interest notifications before the publication event is saved`() {
        val work=WorkAccessResult("w","owner","제목","",0,"world","public",true,true,null)
        `when`(access.own("w","owner")).thenReturn(work)
        `when`(episodes.findByWorkIdAndSequence("w",1)).thenReturn(EpisodeEntity(id="e1",workId="w",sequence=1))
        `when`(episodes.findByWorkIdAndSequence("w",2)).thenReturn(EpisodeEntity(id="e2",workId="w",sequence=2))
        `when`(versions.findByEpisodeIdAndContentVersionId("e1","content-v1")).thenReturn(EpisodeVersionEntity(id="v1",episodeId="e1",contentVersionId="content-v1",revisionNo=1,content="본문",isSaved=true))
        `when`(works.findById("w")).thenReturn(Optional.of(WorkEntity(id="w",ownerId="owner",revision=0)))
        `when`(policies.findFirstByWorkIdOrderByRevisionNoDesc("w")).thenReturn(ForkPolicyHistoryEntity(id="old",workId="w",allowCreation=true,allowPublication=true,revisionNo=3,episodeScope="all"))

        service.publishCurrent("w","owner",PublishRequest(0,true,true,true,"content-v1"))

        val order=inOrder(interests,events)
        order.verify(interests).episodePublished("w","owner",1)
        order.verify(events).saveAndFlush(ArgumentMatchers.any(PublicationEventEntity::class.java) ?: PublicationEventEntity())
    }

    @ParameterizedTest
    @ValueSource(strings = ["from", "selected"])
    fun `publication boolean change never widens the existing episode scope`(scope: String) {
        val work=WorkAccessResult("w","owner","제목","",0,"world","public",true,true,null)
        `when`(access.own("w","owner")).thenReturn(work)
        `when`(episodes.findByWorkIdAndSequence("w",1)).thenReturn(EpisodeEntity(id="e1",workId="w",sequence=1))
        `when`(episodes.findByWorkIdAndSequence("w",2)).thenReturn(EpisodeEntity(id="e2",workId="w",sequence=2))
        `when`(versions.findByEpisodeIdAndContentVersionId("e1","content-v1")).thenReturn(EpisodeVersionEntity(id="v1",episodeId="e1",contentVersionId="content-v1",revisionNo=1,content="본문",isSaved=true))
        `when`(works.findById("w")).thenReturn(Optional.of(WorkEntity(id="w",ownerId="owner",revision=0)))
        `when`(policies.findFirstByWorkIdOrderByRevisionNoDesc("w")).thenReturn(ForkPolicyHistoryEntity(id="old",workId="w",allowCreation=true,allowPublication=true,revisionNo=3,episodeScope=scope,startEpisodeId=if(scope=="from") "e2" else null))
        if(scope=="selected") `when`(selectedPolicyEpisodes.findAllByPolicyHistoryId("old")).thenReturn(listOf(ForkPolicyEpisodeEntity("old","e2","w")))

        service.publishCurrent("w","owner",PublishRequest(0,true,true,false,"content-v1"))

        val saved=mockingDetails(policies).invocations.single {it.method.name=="saveAndFlush"}.getArgument<ForkPolicyHistoryEntity>(0)
        assertEquals(scope,saved.episodeScope)
        assertEquals(4,saved.revisionNo)
        assertFalse(saved.allowPublication)
        if(scope=="from") {
            assertEquals("e2",saved.startEpisodeId)
            verifyNoInteractions(selectedPolicyEpisodes)
        } else {
            val links=mockingDetails(selectedPolicyEpisodes).invocations.single {it.method.name=="saveAll"}.getArgument<Iterable<ForkPolicyEpisodeEntity>>(0)
            assertEquals(listOf(Triple(saved.id,"e2","w")),links.map {Triple(it.policyHistoryId,it.episodeId,it.workId)})
        }
    }

    @Test
    fun `last published maps the latest applied publication time of each work`() {
        val at=Instant.parse("2026-11-10T01:00:00Z")
        `when`(events.lastPublishedByWork()).thenReturn(listOf(arrayOf<Any>("w1",at),arrayOf<Any>("w2",at.plusSeconds(60))))

        assertEquals(mapOf("w1" to at,"w2" to at.plusSeconds(60)),service.lastPublished())
    }
}
