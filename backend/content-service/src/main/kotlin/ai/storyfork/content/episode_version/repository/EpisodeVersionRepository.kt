package ai.storyfork.content.episode_version.repository

import ai.storyfork.content.episode_version.entity.EpisodeVersionEntity
import org.springframework.data.jpa.repository.*

interface EpisodeVersionRepository : JpaRepository<EpisodeVersionEntity, String> {
    @Query("""select new ai.storyfork.content.episode_version.domain.VersionLink(v.episodeId, v.id, v.restoredFromId)
        from EpisodeVersionEntity v where v.episodeId in :ids and v.isSaved = true
        order by v.createdAt, v.revisionNo, v.id""")
    fun savedLinks(@org.springframework.data.repository.query.Param("ids") ids: Collection<String>): List<ai.storyfork.content.episode_version.domain.VersionLink>

    fun findAllByEpisodeIdInOrderByCreatedAtAscIdAsc(episodeIds: Collection<String>): List<EpisodeVersionEntity>
    fun findByEpisodeIdAndContentVersionId(episodeId: String, contentVersionId: String): EpisodeVersionEntity?
}
