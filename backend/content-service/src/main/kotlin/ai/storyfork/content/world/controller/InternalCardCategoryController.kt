package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.CardCategoryService
import ai.storyfork.content.world.service.dto.*
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

/** 운영 서비스 전용 카드 카테고리 관리 내부 API다. `/internal/v1` 하위의 운영 서비스 토큰 체인만 지나며 공개 proxy에 등록하지 않는다. */
@RestController
@RequestMapping("/internal/v1/card-categories")
class InternalCardCategoryController(private val service: CardCategoryService) {
    /** 숨긴 카테고리를 포함한 전체 카테고리와 카드 사용 수다. */
    @GetMapping
    fun list(): List<CardCategoryResponse> = service.list()

    /** 새 카테고리를 맨 뒤 순서의 활성 카테고리로 만든다. 이름 중복은 409 CARD_CATEGORY_NAME_TAKEN, 입력 오류는 422다. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@RequestBody request: CardCategoryCreateRequest): CardCategoryResponse = service.create(request)

    /** 보낸 필드만 바꾼다(`icon`이 빈 문자열이면 지움). 이름 중복은 409, 없는 코드는 404다. */
    @PatchMapping("/{code}")
    fun update(@PathVariable code: String, @RequestBody request: CardCategoryUpdateRequest): CardCategoryResponse = service.update(code, request)

    /** 전체 코드를 한 번씩 담은 새 순서를 저장한다. 빠짐·중복·없는 코드는 422다. */
    @PutMapping("/order")
    fun reorder(@RequestBody request: CardCategoryOrderRequest): List<CardCategoryResponse> = service.reorder(request)
}
