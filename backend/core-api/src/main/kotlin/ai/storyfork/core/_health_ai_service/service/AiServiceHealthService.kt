package ai.storyfork.core._health_ai_service.service

import ai.storyfork.core._common.exception.AiServiceCallException
import ai.storyfork.core._health_ai_service.client.AiServiceHealthClient
import ai.storyfork.core._health_ai_service.service.dto.AiServiceHealthResult
import org.springframework.stereotype.Service

@Service
class AiServiceHealthService(
    private val aiServiceHealthClient: AiServiceHealthClient,
) {
    fun getHealth(): AiServiceHealthResult {
        val payload = aiServiceHealthClient.getHealth()

        val status = payload.status
        val service = payload.service
        if (status != EXPECTED_STATUS || service != EXPECTED_SERVICE) {
            throw AiServiceCallException.invalidResponse(
                "AI Service health response violated the expected contract",
                null,
            )
        }

        return AiServiceHealthResult(status, service)
    }

    private companion object {
        const val EXPECTED_STATUS = "up"
        const val EXPECTED_SERVICE = "storyfork-ai-service"
    }
}
