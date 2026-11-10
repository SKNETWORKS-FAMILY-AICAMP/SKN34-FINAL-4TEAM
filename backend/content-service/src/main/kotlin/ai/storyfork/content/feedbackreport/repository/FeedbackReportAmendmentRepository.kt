package ai.storyfork.content.feedbackreport.repository

import ai.storyfork.content.feedbackreport.entity.FeedbackReportAmendmentEntity
import org.springframework.data.jpa.repository.JpaRepository

interface FeedbackReportAmendmentRepository : JpaRepository<FeedbackReportAmendmentEntity, String> {
    /** 여러 제보의 정정·철회 기록을 한 번에 읽는다. 순서는 서비스가 정한다. */
    fun findAllByReportIdIn(reportIds: Collection<String>): List<FeedbackReportAmendmentEntity>
}
