package ai.storyfork.content.proposal

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.proposal.entity.*
import ai.storyfork.content.proposal.repository.AiRunEventRepository
import ai.storyfork.content.proposal.service.AiRunProgressService
import ai.storyfork.content.proposal.service.dto.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.data.domain.Pageable
import tools.jackson.module.kotlin.jacksonMapperBuilder

class AiRunProgressTest {
    private val events=mock(AiRunEventRepository::class.java)
    private val service=AiRunProgressService(events,jacksonMapperBuilder().build())

    @Test fun `invalid free text event fails before persistence`() {
        val run=AiRunEntity(id="r")
        for(event in listOf(AiRunProgressInput("qa",1,"task",1,"secret text","running"),
            AiRunProgressInput("private manuscript",1,"task",1,"TEXT_LOADING","running"))) {
            assertEquals(502,assertThrows(ContentFailure::class.java) {service.append(run,event)}.status)
        }
        verifyNoInteractions(events)
        assertEquals(0,run.lastEventId)
    }

    @Test fun `expired gap returns 410 and future cursor is invalid`() {
        val run=AiRunEntity(id="r",lastEventId=5)
        `when`(events.findAllByRunIdAndSeqGreaterThanOrderBySeqAsc(eq("r") ?: "r",eq(1L),any(Pageable::class.java) ?: org.springframework.data.domain.PageRequest.of(0,100)))
            .thenReturn(listOf(AiRunEventEntity(runId="r",seq=4)))
        assertEquals(410,assertThrows(ContentFailure::class.java) {service.page(run,1)}.status)
        assertEquals(422,assertThrows(ContentFailure::class.java) {service.page(run,6)}.status)
        assertTrue(service.page(run,5).events.isEmpty())
    }

    @Test fun `explicit next proposal version publishes after previous terminal receipt`() {
        val run=AiRunEntity(id="r",status="revision_requested",lastEventId=4)
        `when`(events.findFirstByRunIdAndTaskIdAndAttemptAndPhaseOrderByStepDesc("r","run",1,"run"))
            .thenReturn(AiRunEventEntity(runId="r",seq=4,step=4,status="revision_requested",code="RESULT_READY"))
        service.state(run,"awaiting_approval",AiRunOutcome(proposalId="p"))
        val event=org.mockito.ArgumentCaptor.forClass(AiRunEventEntity::class.java)
        verify(events).saveAndFlush(event.capture() ?: AiRunEventEntity())
        assertEquals(5,event.value.step);assertEquals("PROPOSAL_PENDING",event.value.code)
        assertEquals(5,run.lastEventId)
    }
}
