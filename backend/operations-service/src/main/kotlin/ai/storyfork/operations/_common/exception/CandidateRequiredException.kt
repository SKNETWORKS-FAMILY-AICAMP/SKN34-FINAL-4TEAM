package ai.storyfork.operations._common.exception

/** Only a version registered as a candidate (its own candidate-<version> label, #705) can be promoted to production (409 CANDIDATE_REQUIRED). */
class CandidateRequiredException : RuntimeException("Only a candidate prompt version can be promoted.")
