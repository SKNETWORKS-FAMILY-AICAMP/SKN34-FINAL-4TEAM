package ai.storyfork.content.work.controller

import ai.storyfork.content.work.service.GenreService
import ai.storyfork.content.work.service.dto.*
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

/** 운영 서비스 전용 장르 관리 내부 API다(DEC-56). `/internal/v1` 하위의 운영 서비스 토큰 체인만 지나며 공개 proxy에 등록하지 않는다. */
@RestController
@RequestMapping("/internal/v1/genres")
class InternalGenreController(private val service: GenreService) {
    /** 숨긴 장르를 포함한 전체 장르와 작품·세계관 사용 수다. */
    @GetMapping
    fun list(): List<GenreResponse> = service.list()

    /** 새 장르를 맨 뒤 순서의 활성 장르로 만든다. 이름 중복은 409 GENRE_NAME_TAKEN, 입력 오류는 422다. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@RequestBody request: GenreCreateRequest): GenreResponse = service.create(request)

    /** 보낸 필드만 바꾼다. 홈 노출 한도 초과는 409 GENRE_FEATURED_LIMIT, 이름 중복은 409, 없는 코드는 404다. */
    @PatchMapping("/{code}")
    fun update(@PathVariable code: String, @RequestBody request: GenreUpdateRequest): GenreResponse = service.update(code, request)

    /** 전체 코드를 한 번씩 담은 새 순서를 저장한다. 빠짐·중복·없는 코드는 422다. */
    @PutMapping("/order")
    fun reorder(@RequestBody request: GenreOrderRequest): List<GenreResponse> = service.reorder(request)
}
