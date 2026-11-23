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

    /** 작가가 아직 확인하지 않은(`unchecked`) 제보 수다. 삭제된 작품의 제보는 작가 피드백함에 나오지 않으므로 세지 않는다(운영 통계, DEC-55). */
    @Query("select count(r) from FeedbackReportEntity r join WorkEntity w on w.id = r.workId where r.status = 'unchecked' and w.deletedAt is null")
    fun countUnchecked(): Long
}
