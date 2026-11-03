package ai.storyfork.core.episode_version.repository

import ai.storyfork.core.episode_version.entity.EpisodeVersionEntity
import org.springframework.data.jpa.repository.*

interface EpisodeVersionRepository : JpaRepository<EpisodeVersionEntity, String> {
    fun findAllByEpisodeIdInOrderByCreatedAtAscIdAsc(episodeIds: Collection<String>): List<EpisodeVersionEntity>
    fun findByEpisodeIdAndContentVersionId(episodeId: String, contentVersionId: String): EpisodeVersionEntity?
}
