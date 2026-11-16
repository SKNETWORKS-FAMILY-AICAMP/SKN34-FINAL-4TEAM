package ai.storyfork.content.reading.repository

import ai.storyfork.content.reading.entity.ReadingRecordEntity
import org.springframework.data.jpa.repository.JpaRepository

interface ReadingRecordRepository : JpaRepository<ReadingRecordEntity, ReadingRecordEntity.Key> {
    fun findAllByMemberIdOrderByUpdatedAtDescWorkIdAsc(memberId: String): List<ReadingRecordEntity>
    fun deleteAllByMemberIdAndWorkId(memberId: String, workId: String)
}
