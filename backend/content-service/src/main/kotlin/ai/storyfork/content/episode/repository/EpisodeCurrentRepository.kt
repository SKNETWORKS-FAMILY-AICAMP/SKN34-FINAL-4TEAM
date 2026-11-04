package ai.storyfork.content.episode.repository

import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import org.springframework.data.jpa.repository.*

interface EpisodeCurrentRepository : JpaRepository<EpisodeCurrentEntity, String> {
    fun findAllByWorkIdOrderBySequence(workId: String): List<EpisodeCurrentEntity>
    fun findByWorkIdAndSequence(workId: String, sequence: Int): EpisodeCurrentEntity?
}
