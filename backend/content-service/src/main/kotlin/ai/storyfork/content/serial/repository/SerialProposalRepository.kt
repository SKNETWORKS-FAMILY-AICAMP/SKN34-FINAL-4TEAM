package ai.storyfork.content.serial.repository

import ai.storyfork.content.serial.entity.SerialProposalEntity
import org.springframework.data.jpa.repository.JpaRepository

interface SerialProposalRepository : JpaRepository<SerialProposalEntity, String> {
    /** 숨긴 글을 포함한 게시판의 모든 글이다(회차 실행 입력·실패로 새 게시판에 옮길 때). */
    fun findAllByBoardId(boardId: String): List<SerialProposalEntity>

    /** 독자 화면의 글이다: 숨기지 않은 글을 최신순(같은 시각은 id 역순) 최대 200개다. */
    fun findTop200ByBoardIdAndHiddenFalseOrderByCreatedAtDescIdDesc(boardId: String): List<SerialProposalEntity>
}
