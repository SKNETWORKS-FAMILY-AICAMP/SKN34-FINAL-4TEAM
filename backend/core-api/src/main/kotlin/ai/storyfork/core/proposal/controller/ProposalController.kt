package ai.storyfork.core.proposal.controller

import jakarta.validation.Valid
import java.security.Principal
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.web.bind.annotation.*
import ai.storyfork.core.episode.service.dto.*
import ai.storyfork.core.proposal.service.dto.*

/** AI 제안 접수와 명시적 승인·반영을 담당한다. */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
class ProposalController(private val service: ai.storyfork.core.proposal.service.ProposalService) {

    /** 동의한 허용 문맥으로 AI 제안을 생성한다. 소유자만 가능, 기준 충돌은 409, 외부 장애는 503다. 원고는 바꾸지 않는다. */
    @PostMapping("/works/{id}/proposals")
    fun propose(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: ProposalRequest): ProposalResponse = service.propose(id,principal.name,data)

    /** 선택 제안을 검증 후 원고와 새 버전에 반영한다. 소유자만 가능하며 만료·중복·문맥 충돌은 409다. */
    @PostMapping("/works/{id}/proposals/{pid}/accept")
    fun accept(@PathVariable id: String,@PathVariable pid: String,principal: Principal,@Valid @RequestBody data: AcceptProposalRequest): DraftResponse = service.accept(id,pid,principal.name,data.revision)

}
