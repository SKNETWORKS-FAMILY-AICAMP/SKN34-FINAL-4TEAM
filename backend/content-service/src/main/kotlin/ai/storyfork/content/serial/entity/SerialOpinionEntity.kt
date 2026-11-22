package ai.storyfork.content.serial.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

/**
 * 게시판의 독자 의견 하나다(게시판마다 회원당 하나). [kind]는 general·simulation이고, 시뮬레이션 의견의 [simulation]은 전제(premise)·장면 비트(beats)·AI가 만든 장면 미리보기(scene)다.
 * [hidden]은 작품 소유자가 숨긴 의견이다: 목록과 상위 의견에서 빠지지만 행은 남고, 그 회원은 같은 게시판에 다시 쓰지 못한다. 작성자 표시명은 저장하지 않는다.
 */
@Entity
@Table(name = "serial_opinion")
class SerialOpinionEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "board_id")
    var boardId: String = "",
    @field:Column(name = "author_id")
    var authorId: String = "",
    @field:Column(name = "kind")
    var kind: String = "general",
    @field:Column(name = "body")
    var body: String = "",
    @field:JdbcTypeCode(SqlTypes.JSON) @field:Column(name = "simulation", columnDefinition = "jsonb")
    var simulation: Map<String, Any?>? = null,
    @field:Column(name = "hidden")
    var hidden: Boolean = false,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
)
