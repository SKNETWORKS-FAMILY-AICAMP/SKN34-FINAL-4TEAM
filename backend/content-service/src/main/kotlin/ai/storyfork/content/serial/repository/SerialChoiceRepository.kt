package ai.storyfork.content.serial.repository

import ai.storyfork.content.serial.entity.SerialChoiceEntity
import org.springframework.data.jpa.repository.JpaRepository

interface SerialChoiceRepository : JpaRepository<SerialChoiceEntity, String> {
    fun findAllByBoardId(boardId: String): List<SerialChoiceEntity>
    fun existsByBoardId(boardId: String): Boolean
}
