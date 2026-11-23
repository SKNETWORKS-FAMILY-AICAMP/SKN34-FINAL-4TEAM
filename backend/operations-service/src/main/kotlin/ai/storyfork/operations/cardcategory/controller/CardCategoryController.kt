package ai.storyfork.operations.cardcategory.controller

import ai.storyfork.operations.cardcategory.service.CardCategoryService
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryCreateRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryOrderRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryUpdateRequest
import ai.storyfork.operations.security.OperationsMember
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1/operations/card-categories")
class CardCategoryController(private val service: CardCategoryService) {
    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember) = service.list(member)

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@AuthenticationPrincipal member: OperationsMember, @RequestBody request: CardCategoryCreateRequest) = service.create(member, request)

    @PatchMapping("/{code}")
    fun update(@AuthenticationPrincipal member: OperationsMember, @PathVariable code: String, @RequestBody request: CardCategoryUpdateRequest) =
        service.update(member, code, request)

    @PutMapping("/order")
    fun reorder(@AuthenticationPrincipal member: OperationsMember, @RequestBody request: CardCategoryOrderRequest) = service.reorder(member, request)
}
