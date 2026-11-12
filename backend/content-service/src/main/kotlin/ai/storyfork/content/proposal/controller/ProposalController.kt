package ai.storyfork.content.proposal.controller

import jakarta.validation.Valid
import java.security.Principal
import org.springframework.web.bind.annotation.*
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.proposal.service.dto.*

/** AI 제안 접수와 명시적 승인·반영을 담당한다. */
@RestController
@RequestMapping("/api/v1")
class ProposalController(private val service: ai.storyfork.content.proposal.service.ProposalService) {

    /** 동의한 허용 문맥으로 AI 제안을 생성한다. 소유자만 가능, 기준 충돌은 409, 외부 장애는 503다. 원고는 바꾸지 않는다. */
    @PostMapping("/works/{id}/proposals")
    fun propose(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: ProposalRequest): ProposalResponse = service.propose(id,principal.name,data)

    /** 계획(BeatPlan/콘티)으로 작성 중 회차의 새 원고 후보를 만든다(#62). 원고는 바꾸지 않고 승인은 accept로 한다. */
    @PostMapping("/works/{id}/writing/drafts")
    fun writeDraft(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: WritingDraftRequest): ProposalResponse = service.writeDraft(id,principal.name,data)

    /** 작성 중 초안의 선택 구간 수정 후보(before/after)를 만든다(#62). 구간 오류는 422, 원고는 바꾸지 않는다. */
    @PostMapping("/works/{id}/writing/patches")
    fun writePatch(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: WritingPatchRequest): ProposalResponse = service.writePatch(id,principal.name,data)

    /** 선택 제안을 검증 후 원고와 새 버전에 반영한다. 소유자만 가능하며 만료·중복·문맥 충돌은 409다. */
    @PostMapping("/works/{id}/proposals/{pid}/accept")
    fun accept(@PathVariable id: String,@PathVariable pid: String,principal: Principal,@Valid @RequestBody data: AcceptProposalRequest): DraftResponse = service.accept(id,pid,principal.name,data.revision)

}
