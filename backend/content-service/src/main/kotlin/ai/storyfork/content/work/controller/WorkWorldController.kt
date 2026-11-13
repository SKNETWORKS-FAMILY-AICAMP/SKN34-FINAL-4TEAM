package ai.storyfork.content.work.controller

import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.work.service.dto.WorkWorldLinkRequest
import ai.storyfork.content.work.service.dto.WorkWorldLinkResponse
import ai.storyfork.content.world.service.dto.ReaderWorldCardsResponse
import java.security.Principal
import org.springframework.web.bind.annotation.*

/** 세계관(WorldStudio)과 소설의 1:1 연결과, 그 세계관에서 독자에게 공개된 설정 카드 조회다(DEC-46). */
@RestController
@RequestMapping("/api/v1")
class WorkWorldController(private val service: WorkWorldService) {
    /**
     * 작품에 WorldStudio 세계관을 연결한다(`worldId`가 null이면 해제). 작품과 세계관 모두 요청자 소유여야 하며 아니면 404,
     * 이미 다른 작품에 연결된 세계관이면 409 `WORLD_ALREADY_LINKED`다. 같은 요청을 다시 보내도 결과가 같다.
     */
    @PutMapping("/works/{id}/world-studio")
    fun link(@PathVariable id: String, principal: Principal, @RequestBody data: WorkWorldLinkRequest): WorkWorldLinkResponse =
        service.link(id, principal.name, data.worldId)

    /**
     * 공개 작품의 독자 설정 위키다. 익명 조회를 허용한다. 연결된 세계관의 확정 버전 카드 중 독자 공개 회차가 `upto`(1 이상, 생략하면 마지막 발행 회차,
     * 발행된 회차까지만) 이하인 카드와 그 카드끼리의 현재 관계만 반환한다. 공개가 아니거나 연결·확정 버전이 없으면 빈 목록 200, 없는 작품은 404, `upto` 값 오류는 422다
     * (문자열로 받아 Spring 타입 변환 400이 되지 않게 한다).
     */
    @GetMapping("/public/works/{id}/world-cards")
    fun readerCards(@PathVariable id: String, @RequestParam(required = false) upto: String?): ReaderWorldCardsResponse = service.readerCards(id, upto)
}
