package ai.storyfork.content.fork.service.dto

data class ForkIntegrityResponse(
    val basisEpisode: Int,
    val forkHash: String,
    val sourceHash: String,
    val matches: Boolean,
    val characterStateStatus: String = "unavailable",
)
