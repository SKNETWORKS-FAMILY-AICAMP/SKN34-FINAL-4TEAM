package ai.storyfork.content.comment.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.hibernate.annotations.DynamicUpdate

/**
 * 공개 회차 댓글이다. 작성 시점의 발행 버전 ID를 고정 저장하고 삭제는 [deletedAt] 기록뿐이다(DEC-42).
 * 본문·스포일러 여부만 수정할 수 있으며 인용 문장(quote)은 바뀌지 않는다.
 * [hidden]은 운영 숨김이다. 켜도 원문은 지우지 않고 공개 응답에서만 자리표시로 바꾼다.
 * 작성자 표시명은 저장하지 않는다. 응답 때마다 [authorId]로 Core 닉네임을 조회한다.
 */
@Entity
@Table(name = "episode_comment")
// 작성자 수정과 운영 숨김이 같은 행을 동시에 저장해도 서로의 칼럼을 옛 값으로 덮지 않도록 바뀐 칼럼만 UPDATE한다.
@DynamicUpdate
class EpisodeCommentEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "episode_number")
    var episodeNumber: Int = 0,
    @field:Column(name = "published_version_id")
    var publishedVersionId: String = "",
    @field:Column(name = "author_id")
    var authorId: String = "",
    @field:Column(name = "body")
    var body: String = "",
    @field:Column(name = "quote")
    var quote: String? = null,
    @field:Column(name = "spoiler")
    var spoiler: Boolean = false,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "updated_at")
    var updatedAt: Instant = createdAt,
    @field:Column(name = "deleted_at")
    var deletedAt: Instant? = null,
    @field:Column(name = "hidden")
    var hidden: Boolean = false,
)
