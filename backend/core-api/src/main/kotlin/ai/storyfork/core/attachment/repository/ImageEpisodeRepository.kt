package ai.storyfork.core.attachment.repository

import ai.storyfork.core.attachment.entity.ImageEpisode
import org.springframework.data.repository.Repository

interface ImageEpisodeRepository : Repository<ImageEpisode, String> {
    fun existsByWorkIdAndSequence(workId: String, sequence: Int): Boolean
}
