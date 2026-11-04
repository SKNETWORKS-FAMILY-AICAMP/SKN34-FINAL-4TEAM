package ai.storyfork.core.work.repository

import ai.storyfork.core.work.entity.GenreEntity
import org.springframework.data.jpa.repository.*

interface GenreRepository : JpaRepository<GenreEntity, String> {
    fun findAllByNameIn(names: Collection<String>): List<GenreEntity>
}
