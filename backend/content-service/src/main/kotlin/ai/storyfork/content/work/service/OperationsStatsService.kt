package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.editsuggestion.domain.EditSuggestionRules
import ai.storyfork.content.editsuggestion.repository.EditSuggestionRepository
import ai.storyfork.content.feedbackreport.repository.FeedbackReportRepository
import ai.storyfork.content.proposal.repository.ProposalDecisionRepository
import ai.storyfork.content.work.service.dto.EditSuggestionStats
import ai.storyfork.content.work.service.dto.OperationsStatsResponse
import ai.storyfork.content.work.service.dto.ProposalDecisionStats
import java.time.DateTimeException
import java.time.Instant
import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 운영 서비스 전용 통계(DEC-55)다. 값마다 count 쿼리 하나라 행을 읽지도 Core를 부르지도 않는다.
 * - 대기: 작가가 아직 손대지 않은 것(제보 `unchecked`·수정 제안 `pending`)의 전체 수다. 삭제된 작품은 작가 피드백함에 안 나오므로 뺀다.
 * - 기간(`from`~`to`, 양 끝 포함, 생략하면 최근 7일): 그 안에 난 결정만 센다. 수정 제안은 승인·거절한 것이고 보류는 결정이 아니다.
 *   AI 제안 결정은 `ProposalService.accept`가 남기는 `accept`(채택)다.
 * ponytail: 제안 결정은 채택만 기록돼 total이 곧 adopted다(거절·무시 기록이 없다). 의미 있는 채택률은 생성된 제안 수를 분모로 해야 하니 그때 total의 정의를 바꾼다.
 */
@Service
@Transactional(transactionManager = "contentTransactionManager", readOnly = true)
class OperationsStatsService(
    private val reports: FeedbackReportRepository,
    private val suggestions: EditSuggestionRepository,
    private val decisions: ProposalDecisionRepository,
) {
    /** [from]·[to]는 ISO-8601 시각 문자열이다. 값 오류와 `from > to`는 아무것도 세기 전에 422다. */
    fun stats(from: String?, to: String?, now: Instant = Instant.now()): OperationsStatsResponse {
        val end = to?.let { instant(it, "to") } ?: now
        val start = from?.let { instant(it, "from") } ?: end.minus(7, ChronoUnit.DAYS)
        checkContent(!start.isAfter(end), message = "from은 to보다 늦을 수 없어요.")
        val approved = suggestions.countByStatusAndDecidedAtBetween(EditSuggestionRules.APPROVED, start, end)
        val rejected = suggestions.countByStatusAndDecidedAtBetween(EditSuggestionRules.REJECTED, start, end)
        return OperationsStatsResponse(
            pendingFeedbackReports = reports.countUnchecked(),
            pendingEditSuggestions = suggestions.countPending(),
            proposalDecisions = ProposalDecisionStats(adopted = decisions.countByDecisionAndDecidedAtBetween("accept", start, end), total = decisions.countByDecidedAtBetween(start, end)),
            editSuggestions = EditSuggestionStats(approved = approved, decided = approved + rejected),
        )
    }

    private fun instant(text: String, name: String): Instant =
        try { OffsetDateTime.parse(text).toInstant() } catch (_: DateTimeException) { throw ContentFailure(422, "$name 값을 확인해 주세요.") }
}
