package ai.storyfork.content.feedbackreport.service

import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.feedbackreport.domain.reportStatusFilter
import ai.storyfork.content.feedbackreport.entity.FeedbackReportEntity
import ai.storyfork.content.feedbackreport.repository.FeedbackReportRepository
import ai.storyfork.content.feedbackreport.service.dto.OperationsFeedbackReportPageResponse
import ai.storyfork.content.feedbackreport.service.dto.OperationsFeedbackReportResponse
import ai.storyfork.content.work.domain.workPage
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 운영 서비스 전용 제보 열람이다(#750, 운영자는 읽기만 한다). 작품을 가리지 않는 모든 독자 제보를 작성 최신순으로 한 쪽씩 주며 상태로만 거른다.
 * 삭제된 작품의 제보는 작가 피드백함과 같이 뺀다. 제보자명은 Core 최신 닉네임이며 쪽의 제보자 ID를 모아 한 번만 조회하고,
 * Core에 없으면 탈퇴한 회원이며 Core 실패는 그대로 전파한다. 작품 제목은 목록 쿼리의 행에 들어 있어 행마다 조회하지 않는다.
 * ponytail: 상세 API와 정정·답변 이력은 없다. 운영자가 그 내용까지 읽어야 하면 `reportId`별 상세를 더한다(feedback-report-suggestion-contract.md).
 */
@Service
@Transactional(transactionManager = "contentTransactionManager", readOnly = true)
class InternalFeedbackReportService(private val reports: FeedbackReportRepository, private val nicknames: CoreNicknameService) {
    /** [status]는 제보 상태 하나이고 [page](0부터)·[size](1~100, 기본 20)와 함께 틀린 값이면 아무것도 읽기 전에 422다. */
    fun list(status: String?, page: String?, size: String?): OperationsFeedbackReportPageResponse {
        val filter = reportStatusFilter(status)
        // page를 채워 부르면 workPage는 항상 값을 준다(기본 size는 그쪽 기본값이다).
        val window = requireNotNull(workPage(page ?: "0", size))
        val request = PageRequest.of(window.page, window.size)
        val found = if (filter == null) reports.listForOperations(request) else reports.listForOperationsByStatus(filter, request)
        val names = nicknames.nicknames(found.content.map { (it[0] as FeedbackReportEntity).reporterId })
        return OperationsFeedbackReportPageResponse(
            found.content.map { row ->
                val r = row[0] as FeedbackReportEntity
                OperationsFeedbackReportResponse(r.id, r.workId, row[1] as String, r.episodeNumber, r.kind, r.body, r.quote, r.visibility, r.status,
                    names[r.reporterId] ?: WITHDRAWN_MEMBER_NAME, r.withdrawnAt != null, r.createdAt)
            },
            found.number, found.size, found.totalElements, found.totalPages,
        )
    }
}
