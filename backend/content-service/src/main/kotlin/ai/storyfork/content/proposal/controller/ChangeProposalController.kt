package ai.storyfork.content.proposal.controller

import ai.storyfork.content.proposal.service.ChangeProposalService
import ai.storyfork.content.proposal.service.dto.*
import org.springframework.web.bind.annotation.*
import java.security.Principal

/** 원고 변경 제안의 불변 판 조회와 사용자 명시 결정을 담당한다. 준비·모델 호출 경로는 없다. */
@RestController
@RequestMapping("/api/v1/works/{id}/change-proposals")
class ChangeProposalController(private val service: ChangeProposalService) {
    /** 소유자가 현재 판 또는 보존된 판의 전체 변경 범위를 확인한다. */
    @GetMapping("/{pid}")
    fun read(@PathVariable id: String,@PathVariable pid: String,principal: Principal,
        @RequestParam(required=false) version: Int?): ChangeSetResponse = service.read(id,principal.name,pid,version)

    /** 서버가 보존한 판·hash에만 결정한다. 동일 키 재전송은 원 영수증, 변경·중복 결정은 409다. */
    @PostMapping("/{pid}/decisions")
    fun decide(@PathVariable id: String,@PathVariable pid: String,principal: Principal,
        @RequestHeader(name="Idempotency-Key",required=false) key: String?,
        @RequestBody data: ChangeDecisionRequest): ChangeReceipt = service.decide(id,pid,principal.name,key,data)

    /** 응답 유실 시 현재 소유권 확인 후 이미 커밋한 결정·적용 결과를 조회한다. */
    @GetMapping("/{pid}/versions/{version}/receipt")
    fun receipt(@PathVariable id: String,@PathVariable pid: String,@PathVariable version: Int,
        principal: Principal): ChangeReceipt = service.receipt(id,principal.name,pid,version)
}
