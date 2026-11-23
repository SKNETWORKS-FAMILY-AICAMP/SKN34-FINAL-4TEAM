package ai.storyfork.content.serial.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * 공개 회차 하나의 줄거리 요약이다(AI가 300자 안팎, 400자 이하로 만든다). 회차마다 하나이고, [versionId]는 요약을 만든 발행 버전이다:
 * 발행 버전이 바뀌면 낡은 요약이라 문맥에 싣지 않고 다시 만들어 이 행을 바꾼다. [createdAt]은 그 요약을 만든 시각이다.
 */
@Entity
@Table(name = "serial_episode_summary")
class SerialEpisodeSummaryEntity(
    @field:Id @field:Column(name = "episode_id")
    var episodeId: String = "",
    @field:Column(name = "version_id")
    var versionId: String = "",
    @field:Column(name = "summary")
    var summary: String = "",
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
)
