package ai.storyfork.content.like.controller

import ai.storyfork.content.like.service.WorkLikeService
import ai.storyfork.content.like.service.dto.WorkLikeResponse
import java.security.Principal
import org.springframework.web.bind.annotation.*

/** 공개 작품 좋아요 누르기·취소 계약을 제공한다. 회원만 할 수 있고 수는 공개 목록·상세 응답의 likes로 본다. */
@RestController
@RequestMapping("/api/v1")
class WorkLikeController(private val service: WorkLikeService) {

    /** 공개 작품에 좋아요를 누르고 현재 수와 liked=true를 200으로 반환한다. 이미 눌렀어도 같다. 비공개·없는 작품은 404, 비로그인은 401이다. */
    @PutMapping("/works/{id}/like")
    fun like(@PathVariable id: String,principal: Principal): WorkLikeResponse = service.like(id,principal.name)

    /** 좋아요를 취소하고 현재 수와 liked=false를 200으로 반환한다. 누르지 않았어도 같다. 비공개·없는 작품은 404, 비로그인은 401이다. */
    @DeleteMapping("/works/{id}/like")
    fun unlike(@PathVariable id: String,principal: Principal): WorkLikeResponse = service.unlike(id,principal.name)

}
