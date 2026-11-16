package ai.storyfork.content.feedbackreport.repository

import ai.storyfork.content.feedbackreport.entity.FeedbackReportResponseEntity
import org.springframework.data.jpa.repository.JpaRepository

interface FeedbackReportResponseRepository : JpaRepository<FeedbackReportResponseEntity, String> {
    /** 여러 제보의 작가 답변을 한 번에 읽는다. 공개 여부 필터와 순서는 서비스가 정한다. */
    fun findAllByReportIdIn(reportIds: Collection<String>): List<FeedbackReportResponseEntity>
}
