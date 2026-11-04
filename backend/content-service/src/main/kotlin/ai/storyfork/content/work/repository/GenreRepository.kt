package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.GenreEntity
import org.springframework.data.jpa.repository.*

interface GenreRepository : JpaRepository<GenreEntity, String> {
    fun findAllByNameIn(names: Collection<String>): List<GenreEntity>
}
