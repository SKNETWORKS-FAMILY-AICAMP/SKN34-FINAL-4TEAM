package ai.storyfork.content.reading.controller

import ai.storyfork.content.reading.service.ReadingService
import ai.storyfork.content.reading.service.dto.ReadingListResponse
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

/** 로그인 회원의 독서 기록(이어 읽기 위치·읽은 회차)을 기록·조회·삭제한다. 모두 본인 것만 다룬다. */
@RestController
@RequestMapping("/api/v1/works")
class ReadingController(private val service: ReadingService) {

    /** 본인의 독서 기록을 최근 읽은 작품 순으로 반환한다. 지금 공개가 아닌 작품은 뺀다. 리터럴 경로라 `/works/{id}`보다 먼저 매칭된다. */
    @GetMapping("/reading")
    fun list(principal: Principal): ReadingListResponse = service.list(principal.name)

    /** 공개 작품의 발행 회차를 열었다고 기록한다. 같은 요청은 멱등이며 204, 비공개 작품·미발행 회차는 404다. */
    @PutMapping("/{id}/reading/{number}") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun record(@PathVariable id: String, @PathVariable number: Int, principal: Principal) = service.record(id,number,principal.name)

    /** 본인의 한 작품 독서 기록을 지운다. 기록이 없어도 204다(멱등). */
    @DeleteMapping("/{id}/reading") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable id: String, principal: Principal) = service.delete(id,principal.name)

}
