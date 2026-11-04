package ai.storyfork.content.episode_version.repository

import ai.storyfork.content.episode_version.entity.EpisodeVersionEntity
import org.springframework.data.jpa.repository.*

interface EpisodeVersionRepository : JpaRepository<EpisodeVersionEntity, String> {
    fun findAllByEpisodeIdInOrderByCreatedAtAscIdAsc(episodeIds: Collection<String>): List<EpisodeVersionEntity>
    fun findByEpisodeIdAndContentVersionId(episodeId: String, contentVersionId: String): EpisodeVersionEntity?
}
