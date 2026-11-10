package ai.storyfork.content.proposal

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.helper.*
import ai.storyfork.content.context.service.ContextService
import ai.storyfork.content.context.service.dto.*
import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.episode_version.service.dto.*
import ai.storyfork.content.proposal.client.GenerationClient
import ai.storyfork.content.proposal.entity.*
import ai.storyfork.content.proposal.repository.*
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.proposal.service.dto.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.module.kotlin.jacksonMapperBuilder
import java.util.Optional

class ProposalServiceTest {
    @Test fun `legacy accept keeps draft response append history and duplicate conflict`() {
        val access=mock(WorkAccessService::class.java)
        val context=mock(ContextService::class.java)
        val publication=mock(PublicationService::class.java)
        val saved=mock(EpisodeVersionService::class.java)
        val episodes=mock(EpisodeRepository::class.java)
        val drafts=mock(EpisodeDraftRepository::class.java)
        val decisions=mock(ProposalDecisionRepository::class.java)
        val applications=mock(ProposalApplicationRepository::class.java)
        val changes=mock(ProposalEpisodeChangeRepository::class.java)
        val ai=mock(GenerationClient::class.java)
        val service=spy(ProposalService(access,context,publication,saved,episodes,drafts,mock(EpisodeVersionRepository::class.java),
            mock(AiJobRepository::class.java),mock(AiModelCallRepository::class.java),mock(AiInputSnapshotRepository::class.java),
            mock(AiProposalRepository::class.java),mock(AiEvidenceRepository::class.java),mock(ProposalEvidenceRepository::class.java),
            decisions,applications,changes,ai,jacksonMapperBuilder().build(),TransactionTemplate(mock(PlatformTransactionManager::class.java))))
        val selected=StoryContextResponse("작품","",1,"",emptyList(),"원문",emptyList(),SelectionResponse(0,0))
        val pending=ProposalResponse("p","제안","fixture",0,"pending","계속","원문",selected,null,null,"2026-11-10T00:00:00Z",1,null)
        val result=SavedEpisodeVersionResult(DraftResponse("제목","원문\n\n제안",1),VersionResponse("v","제목","원문\n\n제안",1,1,"2026-11-10T00:00:00Z"))
        `when`(access.own("w","owner")).thenReturn(WorkAccessResult("w","owner","작품","",0,"world","private",false,false,null))
        `when`(publication.publishedEpisodes("w")).thenReturn(PublishedEpisodeListResponse(emptyList()))
        `when`(context.read("w","owner",ContextRequest(1,"계속",""))).thenReturn(selected)
        `when`(episodes.findByWorkIdAndSequence("w",1)).thenReturn(EpisodeEntity(episodeId("w",1),"w",1))
        `when`(drafts.findById(episodeId("w",1))).thenReturn(Optional.of(EpisodeDraftEntity(episodeId("w",1),"제목","원문",0)))
        `when`(saved.saveCurrent("w","owner",DraftRequest("제목","원문\n\n제안",0))).thenReturn(result)
        doReturn(ProposalListResponse(listOf(pending)),ProposalListResponse(listOf(pending.copy(status="accepted",appliedVersionId="v"))))
            .`when`(service).history("w","owner")

        assertEquals(result.draft,service.accept("w","p","owner",0))
        val captor=ArgumentCaptor.forClass(ProposalEpisodeChangeEntity::class.java)
        verify(changes).saveAndFlush(captor.capture())
        assertEquals("원문",captor.value.beforeContent);assertEquals("원문\n\n제안",captor.value.afterContent)
        assertEquals(episodeVersionId("w",1,"v"),captor.value.resultVersionId)
        verify(decisions).saveAndFlush(any(ProposalDecisionEntity::class.java))
        verify(applications).saveAndFlush(any(ProposalApplicationEntity::class.java))
        assertEquals(409,assertThrows(ContentFailure::class.java) {service.accept("w","p","owner",1)}.status)
        verify(saved,times(1)).saveCurrent("w","owner",DraftRequest("제목","원문\n\n제안",0))
        verifyNoInteractions(ai)
    }
}
