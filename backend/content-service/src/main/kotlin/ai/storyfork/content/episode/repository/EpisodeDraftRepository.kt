package ai.storyfork.content.episode.repository

import ai.storyfork.content.episode.entity.EpisodeDraftEntity
import org.springframework.data.jpa.repository.*

interface EpisodeDraftRepository : JpaRepository<EpisodeDraftEntity, String> {

}
