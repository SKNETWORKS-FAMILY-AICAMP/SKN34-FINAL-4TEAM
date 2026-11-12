package ai.storyfork.content.writingai.controller

import ai.storyfork.content.writingai.service.WritingAiService
import ai.storyfork.content.writingai.service.dto.WritingAiRequest
import ai.storyfork.content.writingai.service.dto.WritingAiResponse
import jakarta.validation.Valid
import java.security.Principal
import org.springframework.web.bind.annotation.*

@RestController
internal class WritingAiController(private val service: WritingAiService) {
    /** 작가의 집필 AI 자유 입력(새 턴) 또는 멈춘 실행 이어가기. 결과는 제안이며 저장·반영은 기존 승인 경로로 한다. */
    @PostMapping("/api/v1/works/{id}/writing-ai/orchestrations")
    fun run(@PathVariable id: String, principal: Principal, @Valid @RequestBody request: WritingAiRequest): WritingAiResponse =
        service.run(id, principal.name, request)
}
