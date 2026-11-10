package ai.storyfork.content.proposal.controller

import ai.storyfork.content.proposal.service.AiRunService
import ai.storyfork.content.proposal.service.AiRunStreamService
import ai.storyfork.content.proposal.service.dto.*
import jakarta.validation.Valid
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import org.springframework.web.bind.annotation.*

/** Core가 확인한 주체의 작품별 Run 접수·상태·대화 참조 조회를 제공한다. */
@RestController
@RequestMapping("/api/v1/works/{id}/ai")
class AiRunController(private val service: AiRunService,private val stream: AiRunStreamService) {
    /** 멱등 키로 작업을 접수한다. 인가/범위 실패는 404/422, 다른 요청의 키 재사용은 409다. */
    @PostMapping("/runs")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@PathVariable id: String,principal: Principal,
        @RequestHeader(value="Idempotency-Key",required=false) keys: List<String>?,
        @Valid @RequestBody data: AiRunRequest): AiRunResponse = service.create(id,principal.name,keys?.singleOrNull(),data)

    /** 매번 작품·run 소유권과 현재 허용 문맥을 확인하고 실행 상태만 반환한다. */
    @GetMapping("/runs/{runId}")
    fun read(@PathVariable id: String,@PathVariable runId: String,principal: Principal): AiRunResponse = service.read(id,principal.name,runId)

    /** 현재 권한과 인용 원문을 확인한 결과만 반환한다. */
    @GetMapping("/runs/{runId}/result")
    fun result(@PathVariable id: String,@PathVariable runId: String,principal: Principal): AiRunResultResponse = service.result(id,principal.name,runId)

    /** cursor 이후의 고정 진행 기록만 전송한다. 단절은 Run을 취소하거나 새 Run을 만들지 않는다. */
    @GetMapping("/runs/{runId}/events",produces=["text/event-stream"])
    fun events(@PathVariable id: String,@PathVariable runId: String,principal: Principal,
        @RequestHeader(value="Last-Event-ID",required=false) lastIds: List<String>?,
        @RequestParam(required=false) cursor: String?): ResponseEntity<SseEmitter> {
        ai.storyfork.content._common.exception.checkContent(lastIds==null || lastIds.size==1,message="진행 cursor를 하나만 보내 주세요.")
        return ResponseEntity.ok().header("Cache-Control","no-store").header("X-Accel-Buffering","no")
            .body(stream.open(id,principal.name,runId,lastIds?.singleOrNull(),cursor))
    }

    /** 명시적 취소만 접수한다. 기존 인증·CSRF 필터와 작품 잠금을 그대로 사용한다. */
    @PostMapping("/runs/{runId}/cancel")
    fun cancel(@PathVariable id: String,@PathVariable runId: String,principal: Principal): AiRunResponse = service.cancel(id,principal.name,runId)

    /** 같은 회원·작품·Fork의 실행 참조 목록을 제한된 크기로 조회한다. */
    @GetMapping("/threads/{threadId}")
    fun thread(@PathVariable id: String,@PathVariable threadId: String,principal: Principal,
        @RequestParam(defaultValue="0") cursor: Int,@RequestParam(defaultValue="20") limit: Int): AiThreadResponse =
        service.thread(id,principal.name,threadId,cursor,limit)
}
