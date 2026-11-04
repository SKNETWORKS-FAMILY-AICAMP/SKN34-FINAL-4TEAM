package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.WorkGenreEntity
import org.springframework.data.jpa.repository.*

interface WorkGenreRepository : JpaRepository<WorkGenreEntity, WorkGenreEntity.Key> {
    fun findAllByWorkId(workId: String): List<WorkGenreEntity>
    fun deleteAllByWorkId(workId: String)
}
