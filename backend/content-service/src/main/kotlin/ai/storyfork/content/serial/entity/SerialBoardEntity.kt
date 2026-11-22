package ai.storyfork.content.serial.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * 회차마다 열리는 독자 의견 게시판이다. 작품당 open·queued·running은 하나뿐이다(부분 유니크).
 * [closedAt]은 실행을 선점해 마감한 시각이다(open·queued에서는 비어 있고, running이 오래 남았는지 보는 기준이다).
 */
@Entity
@Table(name = "serial_board")
class SerialBoardEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "episode_number")
    var episodeNumber: Int = 0,
    @field:Column(name = "status")
    var status: String = "open",
    @field:Column(name = "summary")
    var summary: String? = null,
    @field:Column(name = "published_episode_number")
    var publishedEpisodeNumber: Int? = null,
    @field:Column(name = "failure_reason")
    var failureReason: String? = null,
    @field:Column(name = "opened_at")
    var openedAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "closed_at")
    var closedAt: Instant? = null,
)
