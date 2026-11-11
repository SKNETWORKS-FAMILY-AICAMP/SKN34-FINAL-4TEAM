package ai.storyfork.content.notice.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * 작품 소식(공지)이다. 삭제는 [deletedAt] 기록뿐이다(DEC-42). [authorId]는 처음 쓴 회원(작가 또는 운영자)이며 수정해도 바뀌지 않는다.
 * 작성자 표시명은 저장하지 않고 응답에도 내보내지 않는다.
 */
@Entity
@Table(name = "work_notice")
class WorkNoticeEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "author_id")
    var authorId: String = "",
    @field:Column(name = "category")
    var category: String = "",
    @field:Column(name = "title")
    var title: String = "",
    @field:Column(name = "body")
    var body: String = "",
    @field:Column(name = "pinned")
    var pinned: Boolean = false,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "updated_at")
    var updatedAt: Instant = createdAt,
    @field:Column(name = "deleted_at")
    var deletedAt: Instant? = null,
)
