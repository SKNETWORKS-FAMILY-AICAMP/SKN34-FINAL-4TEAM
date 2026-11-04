package ai.storyfork.content.regression

import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.CreateWorkRequest
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.ProposalRequest
import ai.storyfork.content.fixture.WorkResponse
import ai.storyfork.content.fixture.model.Draft
import ai.storyfork.content.fixture.model.Version
import ai.storyfork.content.fixture.model.WritingEpisode
import ai.storyfork.content.context.service.dto.StoryContextResponse
import ai.storyfork.content.proposal.client.GenerationClient
import ai.storyfork.content.proposal.client.dto.GenerationPayload
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

class ContentPostgresFixtureTest {
    @Test fun `overlapping revision fixture creates episodes and sends the work revision before AI`() {
        val work=WorkResponse("work","소설","","private",false,false,null,emptyList(),Draft(revision=7))
        val driver=mock(ContentTestDriver::class.java) { call ->
            if(call.method.name=="create") work else RETURNS_DEFAULTS.answer(call)
        }
        val ai=mock(GenerationClient::class.java)
        val first=WritingEpisode(1,Draft("1화","첫 원고",1),listOf(Version(title="1화",body="첫 원고",revision=1,episode=1)),null,false,null)
        val second=first.copy(number=2,draft=Draft("2화","다른 회차",1),versions=listOf(Version(title="2화",body="다른 회차",revision=1,episode=2)))
        val target=WritingEpisode(3,Draft("3화","",0),emptyList(),null,false,null)
        `when`(driver.read("work","author")).thenReturn(work)
        `when`(driver.createEpisode("work","author",CreateWorkRequest("2화"))).thenReturn(second.copy(draft=Draft("2화","",0)))
        `when`(driver.createEpisode("work","author",CreateWorkRequest("3화"))).thenReturn(target)
        `when`(driver.writeEpisode("work","author",1,DraftRequest("1화","첫 원고",0),true)).thenReturn(first)
        `when`(driver.writeEpisode("work","author",2,DraftRequest("2화","다른 회차",0),true)).thenAnswer {
            verify(driver).createEpisode("work","author",CreateWorkRequest("2화"))
            second
        }
        var targetRevision=0
        `when`(driver.writing("work","author",3)).thenAnswer {
            verify(driver).createEpisode("work","author",CreateWorkRequest("3화"))
            target.copy(draft=target.draft.copy(revision=targetRevision))
        }
        `when`(driver.writeEpisode("work","author",3,DraftRequest("3화","대상 초안",0),false)).thenAnswer {
            targetRevision=1
            target.copy(draft=Draft("3화","대상 초안",targetRevision))
        }
        val payload=GenerationPayload(mock(StoryContextResponse::class.java),"계속")
        `when`(driver.generationRequest("work","author",3,"계속","")).thenReturn(payload)
        val reachedProposal=IllegalStateException("fixture ready; no database or provider call")
        `when`(driver.propose("work","author",ProposalRequest(7,"계속",true,episode=3))).thenThrow(reachedProposal)
        val regression=ContentPostgresTest().apply { service=driver; this.ai=ai }

        val failure=assertThrows(IllegalStateException::class.java) {
            regression.`AI references explicit target and result when episode revisions overlap`()
        }

        assertSame(reachedProposal,failure)
        assertEquals(first.versions.single().revision,targetRevision)
        verify(driver).propose("work","author",ProposalRequest(7,"계속",true,episode=3))
    }
}
