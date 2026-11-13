package ai.storyfork.content.episode.repository

import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface EpisodeCurrentRepository : JpaRepository<EpisodeCurrentEntity, String> {
    // Same active-row predicate as EpisodeService.assemble, without loading manuscript history.
    @Query(value = """
        SELECT COALESCE(MAX(e.sequence), 0)
        FROM episode_current e
        WHERE e.work_id = :workId AND (
            e.draft_revision_floor >= 0
            OR EXISTS (SELECT 1 FROM episode_draft d WHERE d.episode_id = e.id)
            OR EXISTS (SELECT 1 FROM episode_version p WHERE p.id = e.published_version_id)
            OR EXISTS (SELECT 1 FROM episode_version v WHERE v.episode_id = e.id AND v.is_saved)
        )
    """, nativeQuery = true)
    fun lastNumber(@Param("workId") workId: String): Int

    fun findAllByWorkIdOrderBySequence(workId: String): List<EpisodeCurrentEntity>
    fun findByWorkIdAndSequence(workId: String, sequence: Int): EpisodeCurrentEntity?
}
