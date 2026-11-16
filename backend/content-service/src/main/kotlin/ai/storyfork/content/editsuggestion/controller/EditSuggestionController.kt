package ai.storyfork.content.editsuggestion.controller

import ai.storyfork.content.editsuggestion.service.EditSuggestionService
import ai.storyfork.content.editsuggestion.service.dto.*
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

/** 공개 작품 발행 회차의 문장 수정 제안 등록·조회와 작가의 편집·승인·거절·보류를 제공한다. 모두 로그인 회원만 쓰고 열람은 제안자·작품 소유자뿐이다. */
@RestController
@RequestMapping("/api/v1")
class EditSuggestionController(private val service: EditSuggestionService) {

    /** 제안을 올리고 201과 만든 제안을 반환한다. 입력 오류는 422, 비공개 작품·미발행 회차는 404, Core 조회 실패는 503·504·502다. */
    @PostMapping("/works/{id}/episodes/{number}/edit-suggestions") @ResponseStatus(HttpStatus.CREATED)
    fun create(@PathVariable id: String,@PathVariable number: Int,principal: Principal,@RequestBody data: CreateSuggestionRequest): SuggestionResponse =
        service.create(id,number,principal.name,data)

    /** 제안 상세를 반환한다. 제안자·작품 소유자만 볼 수 있고 그 외는 404다. */
    @GetMapping("/works/{id}/edit-suggestions/{suggestionId}")
    fun read(@PathVariable id: String,@PathVariable suggestionId: String,principal: Principal): SuggestionResponse =
        service.read(id,suggestionId,principal.name)

    /** 내가 올린 제안을 최신순으로 반환한다. */
    @GetMapping("/works/edit-suggestions/mine")
    fun mine(principal: Principal): SuggestionListResponse = service.mine(principal.name)

    /** 내가 소유한 작품들의 제안을 최신순으로 반환한다. 선택 쿼리 `workId`가 오면 그 작품만이며, 내 작품이 아니거나 없으면 빈 목록(200)이다. */
    @GetMapping("/works/edit-suggestions/inbox")
    fun inbox(principal: Principal,@RequestParam(required=false) workId: String?): SuggestionListResponse = service.inbox(principal.name,workId)

    /** 소유자가 편집안을 저장한다. 원래 afterText는 보존되고 `pending`/`held`가 아니면 409다. */
    @PutMapping("/works/{id}/edit-suggestions/{suggestionId}/edited-text")
    fun editedText(@PathVariable id: String,@PathVariable suggestionId: String,principal: Principal,@RequestBody data: EditedTextRequest): SuggestionResponse =
        service.editedText(id,suggestionId,principal.name,data)

    /** 소유자가 승인하고 현재 초안에 반영한다. 반영 결과는 응답에 담기고, 기준 발행본이 바뀌었으면 409다. 발행은 하지 않는다. */
    @PostMapping("/works/{id}/edit-suggestions/{suggestionId}/approval")
    fun approve(@PathVariable id: String,@PathVariable suggestionId: String,principal: Principal): SuggestionResponse =
        service.approve(id,suggestionId,principal.name)

    /** 소유자가 거절한다. 사유는 선택이고 본문을 생략해도 된다. */
    @PostMapping("/works/{id}/edit-suggestions/{suggestionId}/rejection")
    fun reject(@PathVariable id: String,@PathVariable suggestionId: String,principal: Principal,@RequestBody(required=false) data: RejectionRequest?): SuggestionResponse =
        service.reject(id,suggestionId,principal.name,data)

    /** 소유자가 검토 대기 제안을 보류한다. */
    @PostMapping("/works/{id}/edit-suggestions/{suggestionId}/hold")
    fun hold(@PathVariable id: String,@PathVariable suggestionId: String,principal: Principal): SuggestionResponse =
        service.hold(id,suggestionId,principal.name)

}
