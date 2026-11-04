package ai.storyfork.core.world.service.dto


data class CreateWorldRequest(
    val name: String, val description: String = ""
)
