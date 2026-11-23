package ai.storyfork.content.serial.repository

import ai.storyfork.content.serial.entity.SerialEpisodeSummaryEntity
import org.springframework.data.jpa.repository.JpaRepository

interface SerialEpisodeSummaryRepository : JpaRepository<SerialEpisodeSummaryEntity, String> {
    fun findAllByEpisodeIdIn(episodeIds: Collection<String>): List<SerialEpisodeSummaryEntity>
}
