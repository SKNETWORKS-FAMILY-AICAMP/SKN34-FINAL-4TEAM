package ai.storyfork.content.reading.entity

import jakarta.persistence.*
import java.time.Instant

/** 회원이 작품에서 마지막으로 연 회차(이어 읽기 위치). 회원·작품당 한 행이며 최댓값이 아니라 가장 최근에 연 회차를 담는다. */
@Entity
@Table(name = "reading_record")
@IdClass(ReadingRecordEntity.Key::class)
class ReadingRecordEntity(
    @field:Id @field:Column(name = "member_id")
    var memberId: String = "",
    @field:Id @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "last_episode")
    var lastEpisode: Int = 0,
    @field:Column(name = "updated_at")
    var updatedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
) {
    data class Key(var memberId: String = "", var workId: String = "") : java.io.Serializable
}
