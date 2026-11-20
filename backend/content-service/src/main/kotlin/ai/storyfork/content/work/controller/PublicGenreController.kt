package ai.storyfork.content.work.controller

import ai.storyfork.content.work.service.GenreService
import ai.storyfork.content.work.service.dto.PublicGenreResponse
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** 작품·세계관 장르 선택지와 홈·검색 장르 칩이 읽는 비로그인 공개 목록이다(DEC-56). 활성 장르만 표시 순서대로 준다. */
@RestController
@RequestMapping("/api/v1/public/genres")
class PublicGenreController(private val service: GenreService) {
    @GetMapping
    fun list(): List<PublicGenreResponse> = service.active()
}
