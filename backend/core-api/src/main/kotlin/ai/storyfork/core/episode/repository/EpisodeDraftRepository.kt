package ai.storyfork.core.episode.repository

import ai.storyfork.core.episode.entity.EpisodeDraftEntity
import org.springframework.data.jpa.repository.*

interface EpisodeDraftRepository : JpaRepository<EpisodeDraftEntity, String> {

}
