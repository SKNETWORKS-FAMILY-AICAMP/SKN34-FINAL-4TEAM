package ai.storyfork.content.context.controller

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.context.service.ManuscriptQaService
import ai.storyfork.content.context.service.dto.ManuscriptQaRequest
import ai.storyfork.content.context.service.dto.ManuscriptQaResponse
import jakarta.validation.Valid
import java.security.Principal
import org.springframework.beans.factory.ObjectProvider
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1")
internal class ManuscriptQaController(private val service: ObjectProvider<ManuscriptQaService>) {
    @PostMapping("/works/{id}/context/qa")
    fun owner(@PathVariable id: String, principal: Principal, @Valid @RequestBody request: ManuscriptQaRequest): ManuscriptQaResponse =
        enabled().ask(id, principal.name, request)

    @PostMapping("/public/works/{id}/context/qa")
    fun reader(@PathVariable id: String, @Valid @RequestBody request: ManuscriptQaRequest): ManuscriptQaResponse =
        enabled().ask(id, null, request)

    private fun enabled() = service.getIfAvailable()
        ?: throw ContentFailure(503, "원고 Q&A를 사용할 수 없어요.", "MANUSCRIPT_QA_UNAVAILABLE")
}
