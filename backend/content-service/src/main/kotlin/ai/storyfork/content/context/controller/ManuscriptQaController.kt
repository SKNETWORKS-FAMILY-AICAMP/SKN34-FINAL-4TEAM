package ai.storyfork.content.context.controller

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.context.service.ManuscriptQaService
import ai.storyfork.content.context.service.dto.ManuscriptQaRequest
import ai.storyfork.content.context.service.dto.ManuscriptQaResponse
import ai.storyfork.content.context.service.dto.QaRetrievalRequest
import ai.storyfork.content.context.service.dto.QaRetrievalResponse
import jakarta.validation.Valid
import java.security.Principal
import org.springframework.beans.factory.ObjectProvider
import org.springframework.web.bind.annotation.*

@RestController
internal class ManuscriptQaController(private val service: ObjectProvider<ManuscriptQaService>) {
    @PostMapping("/api/v1/works/{id}/context/qa")
    fun owner(@PathVariable id: String, principal: Principal, @Valid @RequestBody request: ManuscriptQaRequest): ManuscriptQaResponse =
        enabled().ask(id, principal.name, request)

    @PostMapping("/api/v1/public/works/{id}/context/qa")
    fun reader(@PathVariable id: String, @Valid @RequestBody request: ManuscriptQaRequest): ManuscriptQaResponse =
        enabled().ask(id, null, request)

    /** AI 오케스트레이션의 Retrieval 도구 전용. `X-Internal-Token`(INTERNAL_TOKEN)으로만 인증한다. */
    @PostMapping("/internal/v1/ai/works/{id}/qa/retrieval")
    fun retrieval(@PathVariable id: String, @Valid @RequestBody request: QaRetrievalRequest): QaRetrievalResponse =
        enabled().retrieveForAi(id, request)

    private fun enabled() = service.getIfAvailable()
        ?: throw ContentFailure(503, "원고 Q&A를 사용할 수 없어요.", "MANUSCRIPT_QA_UNAVAILABLE")
}
