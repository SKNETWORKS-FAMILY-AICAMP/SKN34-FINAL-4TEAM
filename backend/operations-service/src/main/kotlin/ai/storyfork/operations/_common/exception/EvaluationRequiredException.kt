package ai.storyfork.operations._common.exception

/** Promoting a prompt version needs a passing regression evaluation of that very version (409 EVALUATION_REQUIRED). */
class EvaluationRequiredException : RuntimeException("A passing regression evaluation is required.")
