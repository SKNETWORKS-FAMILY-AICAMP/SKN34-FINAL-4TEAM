package ai.storyfork.core.publication.repository

import ai.storyfork.core.publication.entity.PublicationEventEntity
import org.springframework.data.jpa.repository.*

interface PublicationEventRepository : JpaRepository<PublicationEventEntity, String> {
    fun findAllByEpisodeVersionIdInOrderByOccurredAtAscIdAsc(episodeVersionIds: Collection<String>): List<PublicationEventEntity>
}
