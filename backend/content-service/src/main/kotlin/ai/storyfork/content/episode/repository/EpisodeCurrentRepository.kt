package ai.storyfork.content.episode.repository

import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface EpisodeCurrentRepository : JpaRepository<EpisodeCurrentEntity, String> {
    // Same active-row predicate as EpisodeService.assemble, without loading manuscript history.
    @Query("""
        SELECT COALESCE(MAX(e.sequence), 0)
        FROM EpisodeCurrentEntity e
        WHERE e.workId = :workId AND (
            e.draftRevisionFloor >= 0
            OR EXISTS (SELECT d.episodeId FROM EpisodeDraftEntity d WHERE d.episodeId = e.id)
            OR EXISTS (SELECT p.id FROM EpisodeVersionEntity p WHERE p.id = e.publishedVersionId)
            OR EXISTS (SELECT v.id FROM EpisodeVersionEntity v WHERE v.episodeId = e.id AND v.isSaved = true)
        )
    """)
    fun lastNumber(@Param("workId") workId: String): Int

    fun findAllByWorkIdOrderBySequence(workId: String): List<EpisodeCurrentEntity>
    fun findByWorkIdAndSequence(workId: String, sequence: Int): EpisodeCurrentEntity?
}
