package ai.storyfork.content.preprocessing.domain

import ai.storyfork.content._common.exception.checkContent

/** 전처리 작업 상태(DEC-50 실행 계약). 종료 상태는 completed·failed이고 그 밖은 진행 중이다. */
object PreprocessingStatus {
    const val QUEUED = "queued"
    const val RUNNING = "running"
    const val LOADING = "loading"
    const val COMPLETED = "completed"
    const val FAILED = "failed"

    /** AI가 진행을 보고할 수 있는(종료하지 않은) 상태다. */
    val OPEN = setOf(QUEUED, RUNNING, LOADING)
    val ALL = OPEN + setOf(COMPLETED, FAILED)
}

/** AI가 보고하는 단계(계약의 `preprocessing_progress` stage)와 그 단계에서의 작업 상태다. */
val PREPROCESSING_STAGES = mapOf(
    "extracting" to PreprocessingStatus.RUNNING, "resolving" to PreprocessingStatus.RUNNING,
    "organizing" to PreprocessingStatus.RUNNING, "loading" to PreprocessingStatus.LOADING,
)

private const val MAX_REASON_LENGTH = 200

/** AI 진행 보고의 값 검사다. 422에는 고정 문구만 쓰고 받은 값을 메시지에 넣지 않는다. */
fun checkProgress(stage: String, done: Int, total: Int, failedEpisodes: List<Int>, failed: String?) =
    checkContent(
        stage in PREPROCESSING_STAGES && done in 0..total && failedEpisodes.all { it >= 1 } &&
            failedEpisodes.toSet().size == failedEpisodes.size && failedEpisodes.size <= total &&
            (failed == null || (failed.isNotBlank() && failed.length <= MAX_REASON_LENGTH)),
        422, "전처리 진행 값을 확인해 주세요.",
    )
