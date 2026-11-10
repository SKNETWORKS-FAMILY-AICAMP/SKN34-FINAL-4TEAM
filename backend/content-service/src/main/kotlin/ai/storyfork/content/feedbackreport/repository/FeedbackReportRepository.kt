package ai.storyfork.content.feedbackreport.repository

import ai.storyfork.content.feedbackreport.entity.FeedbackReportEntity
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface FeedbackReportRepository : JpaRepository<FeedbackReportEntity, String> {
    /** 한 회차의 제보를 최신순으로 최대 200개 돌려준다. 열람 권한 필터는 서비스가 한다. */
    fun findTop200ByWorkIdAndEpisodeNumberOrderByCreatedAtDesc(workId: String, episodeNumber: Int): List<FeedbackReportEntity>

    /** 제보 하나다. 작품이나 회차가 다르면 없는 것으로 본다. */
    fun findByIdAndWorkIdAndEpisodeNumber(id: String, workId: String, episodeNumber: Int): FeedbackReportEntity?

    /** 내가 남긴 제보를 최신순으로 최대 200개 돌려준다. */
    fun findTop200ByReporterIdOrderByCreatedAtDesc(reporterId: String): List<FeedbackReportEntity>

    /** 주어진 작품들의 제보를 최신순으로 최대 200개 돌려준다. */
    fun findTop200ByWorkIdInOrderByCreatedAtDesc(workIds: Collection<String>): List<FeedbackReportEntity>

    /** 쓰기 대상 제보를 잠그고 읽는다. 같은 제보의 동시 철회·정정·상태 변경이 한 줄씩 차례로 처리된다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from FeedbackReportEntity r where r.id = :id and r.workId = :workId")
    fun lockByIdAndWorkId(@Param("id") id: String, @Param("workId") workId: String): FeedbackReportEntity?
}
