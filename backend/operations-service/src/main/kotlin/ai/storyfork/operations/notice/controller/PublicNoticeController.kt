package ai.storyfork.operations.notice.controller

import ai.storyfork.operations.notice.service.NoticeService
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** 인증 없이 읽는 공개 공지. 쓰기 경로는 없고 보안 체인이 GET 이외를 거절한다. */
@RestController
@RequestMapping("/api/v1/operations/public/notices")
class PublicNoticeController(private val service: NoticeService) {
    @GetMapping
    fun list() = service.list(PageRequest.of(0, 100))

    @GetMapping("/{id}")
    fun read(@PathVariable id: UUID) = service.read(id)
}
