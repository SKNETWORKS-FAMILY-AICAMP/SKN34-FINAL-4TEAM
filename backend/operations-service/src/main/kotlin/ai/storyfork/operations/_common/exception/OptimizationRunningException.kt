package ai.storyfork.operations._common.exception

/** An automatic improvement of the prompt is already running in the AI service (it answered 409): one per prompt (409 OPTIMIZATION_RUNNING, #823). */
class OptimizationRunningException : RuntimeException("An optimization of this prompt is already running.")
