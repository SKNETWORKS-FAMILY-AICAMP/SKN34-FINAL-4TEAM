package ai.storyfork.content.serial.entity

import jakarta.persistence.*

/** 회원이 게시판에 던진 표 하나다. 게시판마다 회원당 한 표이고 다른 선택지로 옮기면 [choiceId]만 바뀐다. 취소는 이 행의 삭제다. */
@Entity
@Table(name = "serial_vote")
@IdClass(SerialVoteEntity.Key::class)
class SerialVoteEntity(
    @field:Id @field:Column(name = "board_id")
    var boardId: String = "",
    @field:Id @field:Column(name = "member_id")
    var memberId: String = "",
    @field:Column(name = "choice_id")
    var choiceId: String = "",
) {
    data class Key(var boardId: String = "", var memberId: String = "") : java.io.Serializable
}
