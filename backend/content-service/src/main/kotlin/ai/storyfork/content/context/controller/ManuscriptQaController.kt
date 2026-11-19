package ai.storyfork.content.context.controller

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.context.service.ManuscriptQaService
import ai.storyfork.content.context.service.dto.QaRetrievalRequest
import ai.storyfork.content.context.service.dto.QaRetrievalResponse
import jakarta.validation.Valid
import org.springframework.beans.factory.ObjectProvider
import org.springframework.web.bind.annotation.*

@RestController
internal class ManuscriptQaController(private val service: ObjectProvider<ManuscriptQaService>) {
    /** AI 오케스트레이션의 Retrieval 도구 전용. `X-Internal-Token`(INTERNAL_TOKEN)으로만 인증한다. */
    @PostMapping("/internal/v1/ai/qa/retrieval")
    fun retrieval(@Valid @RequestBody request: QaRetrievalRequest): QaRetrievalResponse = enabled().retrieveForAi(request)

    private fun enabled() = service.getIfAvailable()
        ?: throw ContentFailure(503, "원고 Q&A를 사용할 수 없어요.", "MANUSCRIPT_QA_UNAVAILABLE")
}
