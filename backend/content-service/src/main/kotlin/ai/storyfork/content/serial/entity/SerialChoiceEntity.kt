package ai.storyfork.content.serial.entity

import jakarta.persistence.*

/** AI가 만든 다음 전개 선택지 하나다. 게시판마다 4개이고 [position]은 1~4다(같은 게시판에서 번호는 겹치지 않는다). */
@Entity
@Table(name = "serial_choice")
class SerialChoiceEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "board_id")
    var boardId: String = "",
    @field:Column(name = "position")
    var position: Int = 1,
    @field:Column(name = "text")
    var text: String = "",
)
