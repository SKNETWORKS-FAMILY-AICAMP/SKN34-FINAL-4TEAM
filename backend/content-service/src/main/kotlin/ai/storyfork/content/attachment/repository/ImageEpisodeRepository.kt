package ai.storyfork.content.attachment.repository

import ai.storyfork.content.attachment.entity.ImageEpisode
import org.springframework.data.repository.Repository

interface ImageEpisodeRepository : Repository<ImageEpisode, String> {
    fun existsByWorkIdAndSequence(workId: String, sequence: Int): Boolean
}
