package ai.storyfork.content.proposal.controller

import ai.storyfork.content.proposal.service.ChangeProposalService
import ai.storyfork.content.proposal.service.dto.*
import org.springframework.web.bind.annotation.*
import java.security.Principal

/** 기존 불변 제안 트랜잭션을 AI 공개 경로에서 재사용한다. 자연어 승인·자동 재생성은 없다. */
@RestController
@RequestMapping("/api/v1/works/{id}/ai/proposals/{pid}")
class AiChangeProposalController(private val service: ChangeProposalService) {
    /** 사용자가 검토할 불변 판을 현재 소유권으로 조회한다. */
    @GetMapping
    fun read(@PathVariable id: String,@PathVariable pid: String,principal: Principal,
        @RequestParam(required=false) version: Int?): ChangeSetResponse = service.read(id,principal.name,pid,version)

    /** 명시한 모든 기준 판본을 재검증하고 한 Content transaction에서만 적용한다. */
    @PostMapping("/approve")
    fun approve(@PathVariable id: String,@PathVariable pid: String,principal: Principal,
        @RequestHeader(name="Idempotency-Key",required=false) key: String?,@RequestBody data: ChangeActionRequest): ChangeReceipt =
        service.decide(id,pid,principal.name,key,ChangeDecisionRequest(data.proposalVersion,data.proposalHash,"approved",data.baseVersions))

    /** 거절 결정을 영속 기록한다. 원고를 변경하지 않는다. */
    @PostMapping("/reject")
    fun reject(@PathVariable id: String,@PathVariable pid: String,principal: Principal,
        @RequestHeader(name="Idempotency-Key",required=false) key: String?,@RequestBody data: ChangeActionRequest): ChangeReceipt =
        service.decide(id,pid,principal.name,key,ChangeDecisionRequest(data.proposalVersion,data.proposalHash,"rejected",data.baseVersions))

    /** 재수정 요청 영수증까지 반환한다. 새 run/판 자동 생성은 사용자 결정으로 제외했다. */
    @PostMapping("/revise")
    fun revise(@PathVariable id: String,@PathVariable pid: String,principal: Principal,
        @RequestHeader(name="Idempotency-Key",required=false) key: String?,@RequestBody data: ChangeActionRequest): ChangeReceipt =
        service.decide(id,pid,principal.name,key,ChangeDecisionRequest(data.proposalVersion,data.proposalHash,"revision_requested",data.baseVersions))
}
