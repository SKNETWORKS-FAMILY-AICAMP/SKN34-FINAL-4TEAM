package ai.storyfork.content.serial.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit

/**
 * 작품의 AI 자율 연재 설정이다(UC-18). [days]는 'MON,WED'처럼 월요일부터의 순서이고 [runTime]은 KST 시각이다.
 * [lastRunDate]는 마지막으로 실행(선점)한 날(KST)이며, 오늘 이미 실행했으면 일정이 다시 오지 않는다.
 */
@Entity
@Table(name = "ai_serial")
class AiSerialEntity(
    @field:Id @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "enabled")
    var enabled: Boolean = false,
    @field:Column(name = "days")
    var days: String = "",
    @field:Column(name = "run_time")
    var runTime: LocalTime = LocalTime.of(21, 0),
    @field:Column(name = "direction")
    var direction: String = "",
    @field:Column(name = "last_run_date")
    var lastRunDate: LocalDate? = null,
    @field:Column(name = "updated_at")
    var updatedAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
)
