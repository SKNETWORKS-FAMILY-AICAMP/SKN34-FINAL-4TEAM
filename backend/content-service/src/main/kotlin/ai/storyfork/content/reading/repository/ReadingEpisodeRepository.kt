package ai.storyfork.content.reading.repository

import ai.storyfork.content.reading.entity.ReadingEpisodeEntity
import org.springframework.data.jpa.repository.JpaRepository

interface ReadingEpisodeRepository : JpaRepository<ReadingEpisodeEntity, ReadingEpisodeEntity.Key> {
    fun findAllByMemberId(memberId: String): List<ReadingEpisodeEntity>
    fun deleteAllByMemberIdAndWorkId(memberId: String, workId: String)
}
