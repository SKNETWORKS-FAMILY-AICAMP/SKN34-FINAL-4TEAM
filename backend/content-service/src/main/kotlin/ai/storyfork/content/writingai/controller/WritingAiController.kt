package ai.storyfork.content.writingai.controller

import ai.storyfork.content.writingai.service.WritingAiService
import ai.storyfork.content.writingai.service.dto.ChatRename
import ai.storyfork.content.writingai.service.dto.ChatSessionCreated
import ai.storyfork.content.writingai.service.dto.WritingAiRequest
import ai.storyfork.content.writingai.service.dto.WritingAiResponse
import jakarta.servlet.http.HttpServletResponse
import jakarta.validation.Valid
import java.security.Principal
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.*
import tools.jackson.databind.JsonNode

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

    /** 새 대화 id를 발급한다. 대화는 첫 메시지를 보낼 때 AI 세이버에 생긴다. */
    @PostMapping("/api/v1/works/{id}/chat/sessions")
    @ResponseStatus(HttpStatus.CREATED)
    fun open(@PathVariable id: String, principal: Principal): ChatSessionCreated = service.open(id, principal.name)

    /** 이 작품에서 내가 나눈 대화 목록(최근 순). */
    @GetMapping("/api/v1/works/{id}/chat/sessions")
    fun sessions(@PathVariable id: String, principal: Principal): JsonNode = service.sessions(id, principal.name)

    /** 대화 제목과 턴별 요청·최종 응답. 승인·입력 대기 중인 턴은 마지막에 waiting으로 있다. */
    @GetMapping("/api/v1/works/{id}/chat/sessions/{threadId}")
    fun history(@PathVariable id: String, @PathVariable threadId: String, principal: Principal): JsonNode =
        service.history(id, principal.name, threadId)

    @PatchMapping("/api/v1/works/{id}/chat/sessions/{threadId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun rename(@PathVariable id: String, @PathVariable threadId: String, principal: Principal, @Valid @RequestBody body: ChatRename) =
        service.rename(id, principal.name, threadId, body.title)

    @DeleteMapping("/api/v1/works/{id}/chat/sessions/{threadId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable id: String, @PathVariable threadId: String, principal: Principal) =
        service.delete(id, principal.name, threadId)

    /** 새 턴 또는 resume을 AI 오케스트레이션 SSE(plan·started·step·waiting·done·error)로 그대로 중계한다. */
    @PostMapping("/api/v1/works/{id}/chat/sessions/{threadId}/messages")
    fun send(@PathVariable id: String, @PathVariable threadId: String, principal: Principal,
             @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String, @Valid @RequestBody request: WritingAiRequest,
             response: HttpServletResponse) =
        stream(service.message(id, principal.name, threadId, request), authorization, response)

    /** index번 메시지를 고쳐 그 턴부터 다시 실행한다. 그 뒤 대화는 지워진다. */
    @PutMapping("/api/v1/works/{id}/chat/sessions/{threadId}/messages/{index}")
    fun edit(@PathVariable id: String, @PathVariable threadId: String, @PathVariable index: Int, principal: Principal,
             @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String, @Valid @RequestBody request: WritingAiRequest,
             response: HttpServletResponse) =
        stream(service.message(id, principal.name, threadId, request, index), authorization, response)

    /** index번 메시지와 그 뒤 대화를 지운다. */
    @DeleteMapping("/api/v1/works/{id}/chat/sessions/{threadId}/messages/{index}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun truncate(@PathVariable id: String, @PathVariable threadId: String, @PathVariable index: Int, principal: Principal) =
        service.truncate(id, principal.name, threadId, index)

    /**
     * 요청 스레드에서 응답에 바로 써 흘린다. 비동기 응답(StreamingResponseBody)은 끝날 때 ASYNC dispatch가 Security에서
     * 다시 거부돼 연결이 비정상 종료되므로 쓰지 않는다(Security 설정은 바꾸지 않는다). 검증 실패는 쓰기 전에 JSON 오류가 된다.
     * shortcut: 대화 하나가 끝날 때까지(최대 3분) Tomcat 스레드 하나를 잡는다. 동시 대화가 많아지면 비동기 응답과 ASYNC 허용을 함께 검토한다.
     */
    private fun stream(body: Map<String, Any?>, authorization: String, response: HttpServletResponse) {
        response.contentType = MediaType.TEXT_EVENT_STREAM_VALUE
        response.characterEncoding = "UTF-8"
        response.setHeader("X-Accel-Buffering", "no") // nginx가 이벤트를 모아 보내지 않게 한다.
        service.relay(body, authorization, response.outputStream)
    }
}
