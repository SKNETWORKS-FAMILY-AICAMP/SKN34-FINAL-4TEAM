package ai.storyfork.content.attachment.repository

import ai.storyfork.content.attachment.entity.ContentImage
import org.springframework.data.jpa.repository.JpaRepository

interface ContentImageRepository : JpaRepository<ContentImage, String> {
    fun findByWorkIdAndEpisodeNo(workId: String, episodeNo: Int): List<ContentImage>
    fun countByWorkIdAndEpisodeNo(workId: String, episodeNo: Int): Long
    fun findAllByWorkIdAndEpisodeNoOrderByCreatedAtAscIdAsc(workId: String, episodeNo: Int): List<ContentImage>
}
