package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.editsuggestion.repository.EditSuggestionRepository
import ai.storyfork.content.feedbackreport.repository.FeedbackReportRepository
import ai.storyfork.content.proposal.repository.AiProposalRepository
import ai.storyfork.content.work.service.OperationsStatsService
import ai.storyfork.content.work.service.dto.EditSuggestionStats
import ai.storyfork.content.work.service.dto.OperationsStatsResponse
import ai.storyfork.content.work.service.dto.ProposalDecisionStats
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.databind.json.JsonMapper

/** 운영 통계(DEC-55) 조립을 저장소 대역으로 검증한다. 실제 JPQL·HTTP·서비스 토큰은 InternalOperationsStatsIntegrationTest가 CI에서 확인한다. */
class OperationsStatsServiceTest {
    private val reports = mock(FeedbackReportRepository::class.java)
    private val suggestions = mock(EditSuggestionRepository::class.java)
    private val proposals = mock(AiProposalRepository::class.java)
    private val service = OperationsStatsService(reports, suggestions, proposals)
    private val now = Instant.parse("2026-11-19T03:00:00Z")

    /** 기간 안 수 대역: 수정 제안 승인·거절, 기간 안에 생성된 AI 제안과 그중 채택된 제안(둘 다 생성 시각 기준, 같은 집단)이다. */
    private fun decided(from: Instant, to: Instant, approved: Long = 0, rejected: Long = 0, adopted: Long = 0, generated: Long = 0) {
        `when`(suggestions.countByStatusAndDecidedAtBetween("approved", from, to)).thenReturn(approved)
        `when`(suggestions.countByStatusAndDecidedAtBetween("rejected", from, to)).thenReturn(rejected)
        `when`(proposals.countAdoptedByCreatedAtBetween(from, to)).thenReturn(adopted)
        `when`(proposals.countByCreatedAtBetween(from, to)).thenReturn(generated)
    }

    @Test fun `every number of the contract comes from its own count, decided is approved plus rejected and the adopted proposals are counted among the ones generated in the window`() {
        val from = now.minus(7, ChronoUnit.DAYS)
        `when`(reports.countUnchecked()).thenReturn(4)
        `when`(suggestions.countPending()).thenReturn(2)
        decided(from, now, approved = 3, rejected = 1, adopted = 7, generated = 10)

        assertEquals(
            OperationsStatsResponse(4, 2, ProposalDecisionStats(adopted = 7, total = 10), EditSuggestionStats(approved = 3, decided = 4)),
            service.stats(null, null, now),
        )
    }

    @Test fun `without a window the last seven days up to now are counted and the pending counts take no window`() {
        service.stats(null, null, now)

        val from = now.minus(7, ChronoUnit.DAYS)
        verify(suggestions).countByStatusAndDecidedAtBetween("approved", from, now)
        verify(suggestions).countByStatusAndDecidedAtBetween("rejected", from, now)
        verify(proposals).countAdoptedByCreatedAtBetween(from, now)
        verify(proposals).countByCreatedAtBetween(from, now)
        verify(reports).countUnchecked()
        verify(suggestions).countPending()
        verifyNoMoreInteractions(reports, suggestions, proposals)
    }

    @Test fun `an explicit window is used as given with Z or an offset and a missing end falls back to the other end`() {
        val from = Instant.parse("2026-11-01T00:00:00Z")
        val to = Instant.parse("2026-11-08T00:00:00Z")
        decided(from, to, approved = 1, rejected = 1, adopted = 5)
        assertEquals(EditSuggestionStats(1, 2), service.stats("2026-11-01T00:00:00Z", "2026-11-08T09:00:00+09:00", now).editSuggestions)

        // only [to]: the start is seven days before it. only [from]: the end is now.
        decided(to.minus(7, ChronoUnit.DAYS), to, approved = 2, rejected = 0)
        assertEquals(2, service.stats(null, "2026-11-08T00:00:00Z", now).editSuggestions.approved)
        decided(from, now, approved = 6, rejected = 0)
        assertEquals(6, service.stats("2026-11-01T00:00:00Z", null, now).editSuggestions.approved)
    }

    @Test fun `a malformed or reversed window is 422 and nothing is counted`() {
        listOf("어제" to null, "2026-11-19" to null, null to "2026-11-19 03:00", "2026-11-09T00:00:00Z" to "2026-11-08T00:00:00Z").forEach { (from, to) ->
            val failure = assertThrows(ContentFailure::class.java) { service.stats(from, to, now) }
            assertEquals(422, failure.status, "$from $to")
        }
        verifyNoInteractions(reports, suggestions, proposals)
    }

    @Test fun `the response serializes to the contract field names`() {
        val json = JsonMapper.builder().findAndAddModules().build()
        val tree = json.readTree(json.writeValueAsString(OperationsStatsResponse(4, 2, ProposalDecisionStats(7, 10), EditSuggestionStats(3, 4))))

        assertEquals(setOf("pendingFeedbackReports", "pendingEditSuggestions", "proposalDecisions", "editSuggestions"), tree.propertyNames().toSet())
        assertEquals(listOf(4L, 2L), listOf(tree.path("pendingFeedbackReports").asLong(), tree.path("pendingEditSuggestions").asLong()))
        assertEquals(listOf(7L, 10L), listOf(tree.path("proposalDecisions").path("adopted").asLong(), tree.path("proposalDecisions").path("total").asLong()))
        assertEquals(listOf(3L, 4L), listOf(tree.path("editSuggestions").path("approved").asLong(), tree.path("editSuggestions").path("decided").asLong()))
        assertEquals(setOf("adopted", "total"), tree.path("proposalDecisions").propertyNames().toSet())
        assertEquals(setOf("approved", "decided"), tree.path("editSuggestions").propertyNames().toSet())
    }
}
