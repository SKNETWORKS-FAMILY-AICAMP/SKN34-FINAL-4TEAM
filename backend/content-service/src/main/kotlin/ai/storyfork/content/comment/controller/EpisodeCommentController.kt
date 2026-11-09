package ai.storyfork.content.comment.controller

import ai.storyfork.content.comment.service.EpisodeCommentService
import ai.storyfork.content.comment.service.dto.*
import java.net.URI
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

/** 공개 회차 댓글의 작성·상세·목록·수정·삭제와 좋아요를 제공한다. 목록·상세는 익명도 볼 수 있고 나머지는 로그인 회원만 쓴다. */
@RestController
@RequestMapping("/api/v1")
class EpisodeCommentController(private val service: EpisodeCommentService) {

    /** 댓글 목록을 반환한다. 익명 가능하며 Bearer가 있으면 liked·mine을 그 회원 기준으로 채운다. sort는 latest(기본)·likes, 잘못된 값은 422, 비공개 작품·미발행 회차는 404다. */
    @GetMapping("/public/works/{id}/episodes/{number}/comments")
    fun list(@PathVariable id: String,@PathVariable number: Int,@RequestParam(required=false) sort: String?,principal: Principal?): CommentListResponse =
        service.list(id,number,sort,principal?.name)

    /** 댓글 상세를 반환한다. 익명 가능하며 다른 작품·회차의 댓글이거나 삭제됐으면 404다. */
    @GetMapping("/public/works/{id}/episodes/{number}/comments/{commentId}")
    fun read(@PathVariable id: String,@PathVariable number: Int,@PathVariable commentId: String,principal: Principal?): CommentResponse =
        service.read(id,number,commentId,principal?.name)

    /** 댓글을 쓰고 201과 공개 상세 경로(Location)를 반환한다. 작성자 표시명은 Core 최신 닉네임이며 입력 오류는 422, 비공개 작품·미발행 회차는 404, Core 조회 실패는 503·504·502다. */
    @PostMapping("/works/{id}/episodes/{number}/comments")
    fun create(@PathVariable id: String,@PathVariable number: Int,principal: Principal,@RequestBody data: CreateCommentRequest): ResponseEntity<CommentResponse> {
        val created=service.create(id,number,principal.name,data)
        return ResponseEntity.created(URI.create("/api/v1/public/works/$id/episodes/$number/comments/${created.id}")).body(created)
    }

    /** 작성자만 본문·스포일러 여부를 수정한다. 타인은 403, 입력 오류는 기존 값을 바꾸지 않는 422, 삭제된 댓글은 404다. */
    @PutMapping("/works/{id}/episodes/{number}/comments/{commentId}")
    fun update(@PathVariable id: String,@PathVariable number: Int,@PathVariable commentId: String,principal: Principal,@RequestBody data: UpdateCommentRequest): CommentResponse =
        service.update(id,number,commentId,principal.name,data)

    /** 작성자만 댓글을 소프트 삭제한다. 타인은 403이고 이미 삭제된 댓글은 404다. */
    @DeleteMapping("/works/{id}/episodes/{number}/comments/{commentId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable id: String,@PathVariable number: Int,@PathVariable commentId: String,principal: Principal) =
        service.delete(id,number,commentId,principal.name)

    /** 좋아요를 누른다. 이미 눌렀어도 204(멱등)이고 삭제된 댓글은 404다. */
    @PutMapping("/works/{id}/episodes/{number}/comments/{commentId}/like") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun like(@PathVariable id: String,@PathVariable number: Int,@PathVariable commentId: String,principal: Principal) =
        service.like(id,number,commentId,principal.name)

    /** 좋아요를 취소한다. 누른 적이 없어도 204(멱등)이고 삭제된 댓글은 404다. */
    @DeleteMapping("/works/{id}/episodes/{number}/comments/{commentId}/like") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun unlike(@PathVariable id: String,@PathVariable number: Int,@PathVariable commentId: String,principal: Principal) =
        service.unlike(id,number,commentId,principal.name)

}
