package ai.storyfork.content.work.service.dto

/** 운영 서비스 전용 통계(DEC-55)다. 대기 수는 지금까지 쌓인 전체이고, 나머지는 요청한 기간 안에 난 결정만 센다. */
data class OperationsStatsResponse(
    val pendingFeedbackReports: Long,
    val pendingEditSuggestions: Long,
    val proposalDecisions: ProposalDecisionStats,
    val editSuggestions: EditSuggestionStats,
)

/** AI 제안: [total]은 기간 안에 생성된 수, [adopted]는 그중 채택(적용)된 수다(둘 다 생성 시각 기준이라 adopted <= total, 결정 시각은 보지 않는다). */
data class ProposalDecisionStats(val adopted: Long, val total: Long)

/** 수정 제안 결정: [approved]는 승인, [decided]는 승인+거절이다(보류는 결정이 아니다). */
data class EditSuggestionStats(val approved: Long, val decided: Long)
