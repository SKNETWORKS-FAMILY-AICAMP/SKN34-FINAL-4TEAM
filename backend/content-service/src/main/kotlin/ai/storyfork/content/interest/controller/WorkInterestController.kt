package ai.storyfork.content.interest.controller

import ai.storyfork.content.interest.service.WorkInterestService
import ai.storyfork.content.interest.service.dto.WorkInterestListResponse
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

/** 관심 작품 등록·해제·내 목록 계약을 제공한다. 모두 로그인 회원 본인 기준이다. */
@RestController
@RequestMapping("/api/v1")
class WorkInterestController(private val service: WorkInterestService) {

    /** 공개 작품을 관심 작품에 담는다. 이미 담았어도 204(멱등)이고, 비공개·없는 작품은 404다. */
    @PutMapping("/works/{id}/interest") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun add(@PathVariable id: String,principal: Principal) = service.add(id,principal.name)

    /** 관심 작품에서 뺀다. 담지 않았어도 204(멱등)이고, 비공개·없는 작품은 404다. */
    @DeleteMapping("/works/{id}/interest") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable id: String,principal: Principal) = service.remove(id,principal.name)

    /** 내 관심 작품 id를 최근 등록순으로 반환한다. 본인 것만 보이며 지금은 비공개인 작품은 뺀다. */
    @GetMapping("/works/interests")
    fun list(principal: Principal): WorkInterestListResponse = service.list(principal.name)

}
