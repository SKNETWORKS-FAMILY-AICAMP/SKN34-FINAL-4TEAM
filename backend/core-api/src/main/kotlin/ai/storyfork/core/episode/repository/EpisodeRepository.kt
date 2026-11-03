package ai.storyfork.core.episode.repository

import ai.storyfork.core.episode.entity.EpisodeEntity
import org.springframework.data.jpa.repository.*

interface EpisodeRepository : JpaRepository<EpisodeEntity, String> {
    fun findAllByWorkIdOrderBySequence(workId: String): List<EpisodeEntity>
    fun findByWorkIdAndSequence(workId: String, sequence: Int): EpisodeEntity?
}
