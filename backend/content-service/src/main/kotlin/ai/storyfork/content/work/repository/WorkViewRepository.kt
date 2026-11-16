package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.WorkViewEntity
import java.time.Instant
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface WorkViewRepository : JpaRepository<WorkViewEntity, WorkViewEntity.Key> {
    /** 작품별 [split] 이후(최근)와 [windowStart] 이상 [split] 미만(직전) 조회 수를 `[작품 id, 최근, 직전]` 행으로 돌려준다. 조회가 없는 작품은 행이 없다. */
    @Query("""select v.workId, sum(case when v.viewedAt >= :split then 1 else 0 end), sum(case when v.viewedAt < :split then 1 else 0 end)
        from WorkViewEntity v where v.viewedAt >= :windowStart group by v.workId""")
    fun countByWork(@Param("windowStart") windowStart: Instant, @Param("split") split: Instant): List<Array<Any>>
    /** 한 작품의 회차별 누적 조회 수를 `[회차 번호, 조회 수]` 행으로 돌려준다. 조회가 없는 회차는 행이 없다. */
    @Query("select v.episodeNumber, count(v) from WorkViewEntity v where v.workId = :workId group by v.episodeNumber")
    fun countByEpisode(@Param("workId") workId: String): List<Array<Any>>
}
