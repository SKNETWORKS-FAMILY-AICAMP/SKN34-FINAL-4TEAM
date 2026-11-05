package ai.storyfork.content.world.service.dto


data class CreateWorldRequest(
    val name: String, val description: String = "", val id: java.util.UUID = java.util.UUID.randomUUID()
)
