package ai.storyfork.content.reading.entity

import jakarta.persistence.*
import java.time.Instant

/** 회원이 작품에서 연 적 있는 회차. 같은 회차를 다시 열어도 한 행이다. */
@Entity
@Table(name = "reading_episode")
@IdClass(ReadingEpisodeEntity.Key::class)
class ReadingEpisodeEntity(
    @field:Id @field:Column(name = "member_id")
    var memberId: String = "",
    @field:Id @field:Column(name = "work_id")
    var workId: String = "",
    @field:Id @field:Column(name = "episode_number")
    var episodeNumber: Int = 0,
    @field:Column(name = "read_at")
    var readAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
) {
    data class Key(var memberId: String = "", var workId: String = "", var episodeNumber: Int = 0) : java.io.Serializable
}
