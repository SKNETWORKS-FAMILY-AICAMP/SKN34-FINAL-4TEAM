package ai.storyfork.operations._common.exception

/** Only the character simulation prompts (act and narrate, text versions) can be improved automatically (422 OPTIMIZATION_UNSUPPORTED, #823). */
class OptimizationUnsupportedException : RuntimeException("This prompt cannot be optimized automatically.")
