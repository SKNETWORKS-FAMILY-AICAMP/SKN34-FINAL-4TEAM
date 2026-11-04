package ai.storyfork.content.publication.repository

import ai.storyfork.content.publication.entity.PublicationEventEntity
import org.springframework.data.jpa.repository.*

interface PublicationEventRepository : JpaRepository<PublicationEventEntity, String> {
    fun findAllByEpisodeVersionIdInOrderByOccurredAtAscIdAsc(episodeVersionIds: Collection<String>): List<PublicationEventEntity>
}
