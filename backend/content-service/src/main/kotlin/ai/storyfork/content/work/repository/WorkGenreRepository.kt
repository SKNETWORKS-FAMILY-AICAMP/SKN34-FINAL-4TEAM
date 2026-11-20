package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.WorkGenreEntity
import org.springframework.data.jpa.repository.*

interface WorkGenreRepository : JpaRepository<WorkGenreEntity, WorkGenreEntity.Key> {
    fun findAllByWorkId(workId: String): List<WorkGenreEntity>
    fun deleteAllByWorkId(workId: String)

    /** 장르별로 센 지우지 않은 작품 수 `[genre_id, 작품 수]`다. 운영 장르 표의 사용 수이며 쿼리 한 번이다. */
    @Query("select wg.genreId, count(w) from WorkGenreEntity wg join WorkEntity w on w.id = wg.workId where w.deletedAt is null group by wg.genreId")
    fun workCounts(): List<Array<Any>>
}
