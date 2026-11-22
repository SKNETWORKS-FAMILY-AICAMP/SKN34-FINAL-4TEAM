package ai.storyfork.content.serial.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

/**
 * 제안 게시판의 글 하나다(회원당 개수 제한 없음). [kind]는 general·simulation이고, 시뮬레이션 글의 [simulation]은 전제(premise)·장면 비트(beats)·AI가 만든 장면 미리보기(scene)다.
 * [hidden]은 작품 소유자가 숨긴 글이다: 목록과 회차 실행 입력에서 빠지지만 행은 남는다. 작성자 표시명은 저장하지 않는다.
 */
@Entity
@Table(name = "serial_proposal")
class SerialProposalEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "board_id")
    var boardId: String = "",
    @field:Column(name = "author_id")
    var authorId: String = "",
    @field:Column(name = "kind")
    var kind: String = "general",
    @field:Column(name = "title")
    var title: String = "",
    @field:Column(name = "body")
    var body: String = "",
    @field:JdbcTypeCode(SqlTypes.JSON) @field:Column(name = "simulation", columnDefinition = "jsonb")
    var simulation: Map<String, Any?>? = null,
    @field:Column(name = "hidden")
    var hidden: Boolean = false,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
)
