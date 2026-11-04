package ai.storyfork.core.episode.service.dto

data class EpisodeOrderScopeResponse(val number: Int, val candidateNumbers: List<Int>, val reasons: List<String>, val executable: Boolean = false)
