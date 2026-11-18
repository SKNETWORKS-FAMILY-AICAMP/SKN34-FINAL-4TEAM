package ai.storyfork.content.work.controller

import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.work.service.dto.WorkWorldLinkRequest
import ai.storyfork.content.work.service.dto.WorkWorldLinkResponse
import ai.storyfork.content.world.controller.coverImage
import ai.storyfork.content.world.service.dto.InheritedWorldResponse
import ai.storyfork.content.world.service.dto.ReaderWorldCardsResponse
import java.security.Principal
import java.util.UUID
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
     * 공개 작품의 독자 설정 위키다. 익명 조회를 허용한다. 연결된 세계관의 확정 버전 카드 중 유효 공개 회차(DEC-53: 공개 회차 값, 없고 공개면 1화)가 `upto`(1 이상, 생략하면 마지막 발행 회차,
     * 발행된 회차까지만) 이하인 카드와 그 카드끼리의 그 시점 관계만 반환한다. 공개가 아니거나 연결·확정 버전이 없으면 빈 목록 200, 없는 작품은 404, `upto` 값 오류는 422다
     * (문자열로 받아 Spring 타입 변환 400이 되지 않게 한다).
     */
    @GetMapping("/public/works/{id}/world-cards")
    fun readerCards(@PathVariable id: String, @RequestParam(required = false) upto: String?): ReaderWorldCardsResponse = service.readerCards(id, upto)

    /**
     * Fork 소유자가 자기 세계관 없이 이어받는 원작 세계관(읽기 전용, DEC-32·37, #365)이다. 지식 상한은 Fork 기준 회차이고 `upto`(1 이상)가 더 작으면 그 회차까지다.
     * 독자 설정 위키와 같은 카드 집합(유효 공개 회차가 상한 이하, DEC-53)과 그 카드끼리의 그 시점 관계만 준다. 이어받는 세계관이 없으면(자기 세계관이 있거나 독립한 Fork·Fork가 아닌 작품·원작에 세계관이 없음) `worldId`가 null인 200,
     * 남의 작품은 404, `upto` 값 오류는 422다.
     */
    @GetMapping("/works/{id}/inherited-world")
    fun inheritedWorld(@PathVariable id: String, principal: Principal, @RequestParam(required = false) upto: String?): InheritedWorldResponse =
        service.inheritedWorld(id, principal.name, upto)

    /**
     * 독자 설정 위키 카드의 이미지를 캐시 없이 반환한다(#401). 익명 조회를 허용한다. `world-cards?upto=N`과 같은 기준으로 보이는 카드 중 하나가 `imageId`로 가리키는 이미지일 때만이며,
     * 그 밖(공개가 아닌 작품·연결 없음·아직 공개되지 않은 카드의 이미지 포함)은 404, `upto` 값 오류는 422다.
     */
    @GetMapping("/public/works/{id}/world-card-images/{imageId}")
    fun readerCardImage(@PathVariable id: String, @PathVariable imageId: UUID, @RequestParam(required = false) upto: String?) =
        coverImage(service.readerCardImage(id, imageId, upto))
}
