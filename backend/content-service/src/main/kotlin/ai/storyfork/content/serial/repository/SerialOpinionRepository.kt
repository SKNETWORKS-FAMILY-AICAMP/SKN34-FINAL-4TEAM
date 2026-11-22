package ai.storyfork.content.serial.repository

import ai.storyfork.content.serial.entity.SerialOpinionEntity
import org.springframework.data.jpa.repository.JpaRepository

interface SerialOpinionRepository : JpaRepository<SerialOpinionEntity, String> {
    fun findAllByBoardId(boardId: String): List<SerialOpinionEntity>
    fun findByBoardIdAndAuthorId(boardId: String, authorId: String): SerialOpinionEntity?
}
