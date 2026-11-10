package ai.storyfork.content.like.repository

import ai.storyfork.content.like.entity.WorkLikeEntity
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface WorkLikeRepository : JpaRepository<WorkLikeEntity, WorkLikeEntity.Key> {
    fun countByWorkId(workId: String): Long

    /** 요청한 작품들의 좋아요 수를 `[작품 id, 수]` 행으로 쿼리 한 번에 돌려준다. 좋아요가 없는 작품은 행이 없다. */
    @Query("select l.workId, count(l) from WorkLikeEntity l where l.workId in :ids group by l.workId")
    fun countByWork(@Param("ids") ids: Collection<String>): List<Array<Any>>

    /** 좋아요를 지운다. 없는 행이면 0건이라 멱등이며, 동시에 두 번 지워도 실패하지 않는다. */
    @Modifying
    @Query("delete from WorkLikeEntity l where l.workId = :workId and l.memberId = :memberId")
    fun deleteLike(@Param("workId") workId: String, @Param("memberId") memberId: String): Int
}
