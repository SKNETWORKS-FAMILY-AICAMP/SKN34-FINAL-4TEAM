package ai.storyfork.content.context.controller

import ai.storyfork.content.context.service.ManuscriptQaService
import ai.storyfork.content.context.service.dto.QaRetrievalRequest
import ai.storyfork.content.context.service.dto.QaRetrievalResponse
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.*

@RestController
internal class ManuscriptQaController(private val service: ManuscriptQaService) {
    /** AI 오케스트레이션의 Retrieval 도구 전용. `X-Internal-Token`(INTERNAL_TOKEN)으로만 인증한다. */
    @PostMapping("/internal/v1/ai/qa/retrieval")
    fun retrieval(@Valid @RequestBody request: QaRetrievalRequest): QaRetrievalResponse = service.retrieveForAi(request)
}
