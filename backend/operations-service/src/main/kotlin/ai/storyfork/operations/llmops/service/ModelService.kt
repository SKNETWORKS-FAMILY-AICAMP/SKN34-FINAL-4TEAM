package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.doubleOrNull
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.dto.ModelCreateRequest
import ai.storyfork.operations.llmops.service.dto.ModelListResponse
import ai.storyfork.operations.llmops.service.dto.ModelResponse
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode

private const val LLM = "llm"

/** Langfuse model definitions: a match pattern and a per-token price, from which Langfuse computes every cost. */
@Service
class ModelService(
    private val permissions: AdminPermissionRepository,
    private val langfuse: LangfuseClient,
    private val activities: AdminActivityService,
) {
    fun list(member: OperationsMember): ModelListResponse {
        permissions.requirePermission(member, LLM)
        return ModelListResponse(langfuse.models().map { it.model() })
    }

    fun create(member: OperationsMember, request: ModelCreateRequest): ModelResponse {
        permissions.requirePermission(member, LLM)
        require(request.modelName.isNotBlank() && request.modelName.length <= 100) { "Invalid model name." }
        require(request.matchPattern.isNotBlank() && request.matchPattern.length <= 300) { "Invalid match pattern." }
        require(request.inputPrice != null || request.outputPrice != null) { "A model needs an input or an output price." }
        for (price in listOfNotNull(request.inputPrice, request.outputPrice)) require(price.isFinite() && price >= 0) { "Invalid price." }
        val body = mutableMapOf<String, Any?>("modelName" to request.modelName, "matchPattern" to request.matchPattern, "unit" to "TOKENS")
        request.inputPrice?.let { body["inputPrice"] = it }
        request.outputPrice?.let { body["outputPrice"] = it }
        val created = langfuse.createModel(body).model()
        activities.record(member, "MODEL_CREATE", "MODEL", created.id.take(100), request.modelName)
        return created
    }

    /** Langfuse sends the prices either flat (inputPrice) or under prices.input.price, depending on how the model was defined. */
    private fun JsonNode.model() = ModelResponse(
        path("id").asString(), path("modelName").asString(), path("matchPattern").asString(),
        path("inputPrice").doubleOrNull() ?: path("prices").path("input").path("price").doubleOrNull(),
        path("outputPrice").doubleOrNull() ?: path("prices").path("output").path("price").doubleOrNull(),
        path("unit").textOrNull() ?: "TOKENS",
    )
}
