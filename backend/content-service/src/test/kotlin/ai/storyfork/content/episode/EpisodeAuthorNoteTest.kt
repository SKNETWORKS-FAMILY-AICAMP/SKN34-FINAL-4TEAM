package ai.storyfork.content.episode

import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.entity.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.episode_version.service.dto.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.dto.WorldSnapshotResult
import jakarta.persistence.EntityManager
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension

@ExtendWith(MockitoExtension::class)
class EpisodeAuthorNoteTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var episodeService: EpisodeService
    @Mock lateinit var publication: PublicationService
    @Mock lateinit var world: WorldService
    @Mock lateinit var episodes: EpisodeRepository
    @Mock lateinit var drafts: EpisodeDraftRepository
    @Mock lateinit var versions: EpisodeVersionRepository
    @Mock lateinit var checkpoints: CheckpointRepository
    @Mock lateinit var checkpointEpisodes: CheckpointEpisodeRepository
    @Mock lateinit var checkpointSettings: CheckpointSettingRepository
    @Mock lateinit var em: EntityManager
    @InjectMocks lateinit var service: EpisodeVersionService

    private fun response(note: String, revision: Int = 1) = EpisodeResponse(1,DraftResponse("제목","본문",revision,note),emptyList(),null,false,null)
    private fun snapshot() {
        `when`(episodes.findByWorkIdAndSequence("w",1)).thenReturn(EpisodeEntity("e","w",1))
        `when`(world.snapshot("w","owner",1)).thenReturn(WorldSnapshotResult("world","history",emptyList()))
    }
    @Test fun `saved version retains author note and does not publish`() {
        val request=DraftRequest("제목","본문",0,"후기")
        `when`(episodeService.update("w","owner",1,request)).thenReturn(response("후기"))
        `when`(episodeService.read("w","owner",1)).thenReturn(response("후기"))
        snapshot()
        service.save("w","owner",1,request)
        val saved=mockingDetails(versions).invocations.single {it.method.name=="saveAndFlush"}.getArgument<EpisodeVersionEntity>(0)
        assertEquals("후기",saved.authorNote)
        verifyNoInteractions(publication)
    }
    @Test fun `restoring a version restores its note as a new version`() {
        val old=VersionResponse("old","제목","본문",1,1,"2026-11-10T00:00:00Z","이전 후기")
        `when`(episodeService.read("w","owner",1)).thenReturn(response("현재 후기",2).copy(versions=listOf(old)))
        `when`(episodeService.update("w","owner",1,DraftRequest("제목","본문",2,"이전 후기"))).thenReturn(response("이전 후기",3))
        snapshot()
        service.restore("w","owner",1,RevertRequest(2,"old"))
        val saved=mockingDetails(versions).invocations.single {it.method.name=="saveAndFlush"}.getArgument<EpisodeVersionEntity>(0)
        assertEquals("이전 후기",saved.authorNote)
        assertNotNull(saved.restoredFromId)
        verifyNoInteractions(publication)
    }
    @Test fun `request validation rejects notes over 2000 characters`() {
        jakarta.validation.Validation.buildDefaultValidatorFactory().use { factory ->
            val validator=factory.validator
            assertTrue(validator.validate(DraftRequest("제목","본문",0,"가".repeat(2000))).isEmpty())
            assertTrue(validator.validate(DraftRequest("제목","본문",0,"가".repeat(2001))).any {it.propertyPath.toString()=="authorNote"})
        }
    }
    @Test fun `AI context includes manuscript but excludes the published author note`() {
        `when`(access.own("w","owner")).thenReturn(ai.storyfork.content.work.service.dto.WorkAccessResult("w","owner","제목","",0,"world","public",true,true,null))
        `when`(publication.publishedEpisodes("w")).thenReturn(ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse(listOf(ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse(1,1,"v1","제목","본문",false,"독자에게만 전할 후기"))))
        `when`(publication.nextEpisodeNumber("w")).thenReturn(2)
        `when`(world.historyForContext("w")).thenReturn(ai.storyfork.content.world.service.dto.SettingListResponse(emptyList()))
        val mapper=tools.jackson.databind.json.JsonMapper.builder().build()
        val context=ai.storyfork.content.context.service.ContextService(access,world,publication,episodes,drafts,mapper)
        val result=context.read("w","owner",ai.storyfork.content.context.service.dto.ContextRequest(1,"",""))
        val json=mapper.writeValueAsString(result)
        assertTrue(json.contains("본문"))
        assertFalse(json.contains("독자에게만 전할 후기"))
        assertFalse(json.contains("authorNote"))
    }
}
