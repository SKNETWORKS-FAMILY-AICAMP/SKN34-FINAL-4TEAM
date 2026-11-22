package ai.storyfork.content.interest.repository

import ai.storyfork.content.interest.entity.WorkInterestEntity
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface WorkInterestRepository : JpaRepository<WorkInterestEntity, WorkInterestEntity.Key> {
    /** 회원의 관심 작품을 최근 등록순으로 읽는다. 같은 시각이면 작품 id순이다. */
    fun findAllByMemberIdOrderByCreatedAtDescWorkIdAsc(memberId: String): List<WorkInterestEntity>
    fun findAllByWorkId(workId: String): List<WorkInterestEntity>

    /** 삭제되지 않은 작품에 담긴 관심 수다(운영 퍼널, DEC-57). */
    @Query("select count(i) from WorkInterestEntity i join WorkEntity w on w.id = i.workId where w.deletedAt is null")
    fun countOfLiveWorks(): Long
}
