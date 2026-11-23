package ai.storyfork.content.serial.repository

import ai.storyfork.content.serial.entity.SerialVoteEntity
import org.springframework.data.jpa.repository.JpaRepository

interface SerialVoteRepository : JpaRepository<SerialVoteEntity, SerialVoteEntity.Key> {
    fun findAllByBoardId(boardId: String): List<SerialVoteEntity>
    fun findByBoardIdAndMemberId(boardId: String, memberId: String): SerialVoteEntity?
}
