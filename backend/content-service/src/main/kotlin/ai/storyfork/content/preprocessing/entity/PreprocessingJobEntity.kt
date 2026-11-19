package ai.storyfork.content.preprocessing.entity

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.preprocessing.domain.PREPROCESSING_STAGES
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus
import ai.storyfork.content.preprocessing.domain.checkProgress
import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

/** 회차 원고 전처리 작업 한 건(DEC-50, #343). 실행은 AI 서비스가 하고 이 행은 접수·진행·실패만 기록한다. */
@Entity
@Table(name = "preprocessing_job")
class PreprocessingJobEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    /** 접수 때 작품에 연결돼 있던 WorldStudio 세계관이다. 연결이 없으면 null이다. */
    @field:Column(name = "world_id")
    var worldId: UUID? = null,
    @field:Column(name = "member_id")
    var memberId: String = "",
    @field:Column(name = "status")
    var status: String = PreprocessingStatus.QUEUED,
    @field:Column(name = "done")
    var done: Int = 0,
    @field:Column(name = "total")
    var total: Int = 0,
    @field:Column(name = "failed_episodes", columnDefinition = "integer[]")
    @field:JdbcTypeCode(SqlTypes.ARRAY)
    var failedEpisodes: List<Int> = emptyList(),
    @field:Column(name = "failed_reason")
    var failedReason: String? = null,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "started_at")
    var startedAt: Instant? = null,
    @field:Column(name = "finished_at")
    var finishedAt: Instant? = null,
) {
    /**
     * AI가 보고한 단계·진행을 기록한다. 종료한 작업은 409, 값 오류는 422다. [failed]가 있으면 그 고정 사유로 작업을 끝낸다.
     * 시작 시각은 처음 진행 중이 될 때 한 번만 남긴다.
     */
    fun report(stage: String, done: Int, total: Int, failedEpisodes: List<Int>, failed: String?, now: Instant) {
        checkContent(status in PreprocessingStatus.OPEN, 409, "이미 끝난 전처리 작업이에요.")
        checkProgress(stage, done, total, failedEpisodes, failed)
        this.done = done
        this.total = total
        this.failedEpisodes = failedEpisodes.sorted()
        if (failed != null) return fail(failed, now)
        status = PREPROCESSING_STAGES.getValue(stage)
        if (startedAt == null) startedAt = now
    }

    fun fail(reason: String, now: Instant) {
        status = PreprocessingStatus.FAILED
        failedReason = reason
        finishedAt = now
    }

    /**
     * 실패한 작업만 다시 접수하려고 대기로 되돌린다(그 밖은 409). 끝 상태는 지우고 진행 수·실패 회차는 AI의 다음 보고가 바꿀 때까지 둔다.
     */
    fun requeue() {
        checkContent(status == PreprocessingStatus.FAILED, 409, "실패한 작업만 다시 실행할 수 있어요.")
        status = PreprocessingStatus.QUEUED
        failedReason = null
        startedAt = null
        finishedAt = null
    }
}
