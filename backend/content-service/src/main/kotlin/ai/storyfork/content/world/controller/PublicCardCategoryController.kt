package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.CardCategoryService
import ai.storyfork.content.world.service.dto.PublicCardCategoryResponse
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** 세계관 카드 생성·수정 선택지가 읽는 비로그인 공개 목록이다. 숨긴 카테고리도 담고(이미 쓰는 카드의 이름 표시용) 화면이 `active`로 새로 고를 것만 거른다. */
@RestController
@RequestMapping("/api/v1/public/card-categories")
class PublicCardCategoryController(private val service: CardCategoryService) {
    @GetMapping
    fun list(): List<PublicCardCategoryResponse> = service.publicList()
}
