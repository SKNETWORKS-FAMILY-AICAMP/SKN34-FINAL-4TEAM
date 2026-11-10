package ai.storyfork.content.publication.repository

import ai.storyfork.content.publication.entity.PublicationScheduleEntity
import java.time.Instant
import org.springframework.data.jpa.repository.JpaRepository

interface PublicationScheduleRepository : JpaRepository<PublicationScheduleEntity, String> {
    fun findAllByEpisodeIdOrderByScheduledAtDescIdDesc(episodeId: String): List<PublicationScheduleEntity>
    fun existsByEpisodeIdAndStatus(episodeId: String, status: String): Boolean
    fun findTop25ByStatusAndScheduledAtLessThanEqualOrderByScheduledAtAscIdAsc(status: String, at: Instant): List<PublicationScheduleEntity>
}
