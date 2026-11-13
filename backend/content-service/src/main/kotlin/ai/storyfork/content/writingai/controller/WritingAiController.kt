package ai.storyfork.content.writingai.controller

import ai.storyfork.content.writingai.service.WritingAiService
import ai.storyfork.content.writingai.service.dto.WritingAiRequest
import ai.storyfork.content.writingai.service.dto.WritingAiResponse
import jakarta.validation.Valid
import org.springframework.http.HttpHeaders
import java.security.Principal
import org.springframework.web.bind.annotation.*

@RestController
internal class WritingAiController(private val service: WritingAiService) {
    /**
     * 작가의 집필 AI 자유 입력(새 턴) 또는 멈춘 실행 이어가기. Writing 결과는 작가가 resume으로 승인할 때만
     * AI가 작가 권한(전달한 Bearer)으로 Content MCP를 통해 회차 초안에 반영한다.
     */
    @PostMapping("/api/v1/works/{id}/writing-ai/orchestrations")
    fun run(@PathVariable id: String, principal: Principal, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String,
            @Valid @RequestBody request: WritingAiRequest): WritingAiResponse =
        service.run(id, principal.name, authorization, request)
}
