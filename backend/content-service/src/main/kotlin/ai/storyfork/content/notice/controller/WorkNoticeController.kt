package ai.storyfork.content.notice.controller

import ai.storyfork.content.auth.config.OPERATOR_AUTHORITY
import ai.storyfork.content.notice.service.WorkNoticeService
import ai.storyfork.content.notice.service.dto.WorkNoticeListResponse
import ai.storyfork.content.notice.service.dto.WorkNoticeRequest
import ai.storyfork.content.notice.service.dto.WorkNoticeResponse
import java.net.URI
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*

/** 작품 소식(공지)의 공개 목록과 작성·수정·삭제를 제공한다. 목록은 익명도 볼 수 있고 나머지는 작품 소유자와 운영자만 쓴다. */
@RestController
@RequestMapping("/api/v1")
class WorkNoticeController(private val service: WorkNoticeService) {

    /** 공개 작품의 소식 목록을 반환한다. 익명 가능하며 고정 먼저, 그 안에서 최신순이다. 비공개·제한·삭제 작품은 404다. */
    @GetMapping("/public/works/{id}/notices")
    fun list(@PathVariable id: String): WorkNoticeListResponse = service.list(id)

    /** 소식을 쓰고 201과 소식 경로(Location)를 반환한다. 소유자·운영자만 쓸 수 있고 그 밖의 회원은 403, 입력 오류는 422, 없거나 삭제된 작품은 404다. */
    @PostMapping("/works/{id}/notices")
    fun create(@PathVariable id: String,authentication: Authentication,@RequestBody data: WorkNoticeRequest): ResponseEntity<WorkNoticeResponse> {
        val created=service.create(id,authentication.name,operator(authentication),data)
        return ResponseEntity.created(URI.create("/api/v1/works/$id/notices/${created.id}")).body(created)
    }

    /** 소식을 전체 수정한다(고정 설정·해제 포함). 타인은 403, 입력 오류는 422, 다른 작품의 소식이거나 삭제됐으면 404다. */
    @PutMapping("/works/{id}/notices/{noticeId}")
    fun update(@PathVariable id: String,@PathVariable noticeId: String,authentication: Authentication,@RequestBody data: WorkNoticeRequest): WorkNoticeResponse =
        service.update(id,noticeId,authentication.name,operator(authentication),data)

    /** 소식을 소프트 삭제한다. 타인은 403이고 다른 작품의 소식이거나 이미 삭제됐으면 404다. */
    @DeleteMapping("/works/{id}/notices/{noticeId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable id: String,@PathVariable noticeId: String,authentication: Authentication) =
        service.delete(id,noticeId,authentication.name,operator(authentication))

    /** Core가 운영자로 확인한 회원만 [OPERATOR_AUTHORITY]를 갖는다. */
    private fun operator(authentication: Authentication) = authentication.authorities.any {it.authority==OPERATOR_AUTHORITY}
}
