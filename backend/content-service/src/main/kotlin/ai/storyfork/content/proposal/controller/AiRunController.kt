package ai.storyfork.content.proposal.controller

import ai.storyfork.content.proposal.service.AiRunService
import ai.storyfork.content.proposal.service.dto.*
import jakarta.validation.Valid
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

/** Core가 확인한 주체의 작품별 Run 접수·상태·대화 참조 조회를 제공한다. */
@RestController
@RequestMapping("/api/v1/works/{id}/ai")
class AiRunController(private val service: AiRunService) {
    /** 멱등 키로 작업을 접수한다. 인가/범위 실패는 404/422, 다른 요청의 키 재사용은 409다. */
    @PostMapping("/runs")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@PathVariable id: String,principal: Principal,
        @RequestHeader(value="Idempotency-Key",required=false) keys: List<String>?,
        @Valid @RequestBody data: AiRunRequest): AiRunResponse = service.create(id,principal.name,keys?.singleOrNull(),data)

    /** 매번 작품·run 소유권과 현재 허용 문맥을 확인하고 실행 상태만 반환한다. */
    @GetMapping("/runs/{runId}")
    fun read(@PathVariable id: String,@PathVariable runId: String,principal: Principal): AiRunResponse = service.read(id,principal.name,runId)

    /** 같은 회원·작품·Fork의 실행 참조 목록을 제한된 크기로 조회한다. */
    @GetMapping("/threads/{threadId}")
    fun thread(@PathVariable id: String,@PathVariable threadId: String,principal: Principal,
        @RequestParam(defaultValue="0") cursor: Int,@RequestParam(defaultValue="20") limit: Int): AiThreadResponse =
        service.thread(id,principal.name,threadId,cursor,limit)
}
