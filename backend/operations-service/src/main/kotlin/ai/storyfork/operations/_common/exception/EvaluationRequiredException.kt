package ai.storyfork.operations._common.exception

/** A prompt with an evaluation set becomes a candidate only once the version's newest run on that set passed (409 EVALUATION_REQUIRED, #787). */
class EvaluationRequiredException : RuntimeException("A passing regression evaluation on the prompt's evaluation set is required.")
