package ai.storyfork.operations.notice.controller

import ai.storyfork.operations._common.service.dto.PageResponse
import ai.storyfork.operations.notice.service.NoticeService
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import ai.storyfork.operations.notice.service.dto.NoticeResponse
import jakarta.validation.Valid
import java.net.URI
import java.util.UUID
import org.springframework.data.domain.Pageable
import org.springframework.data.web.PageableDefault
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

/** 공통 서비스 토큰 인증 경계 안에서만 독립 운영 공지 CRUD를 제공한다. */
@RestController
@RequestMapping("/api/v1/operations/notices")
class NoticeController(private val service: NoticeService) {
    /** 제목·본문을 모두 받아 공지를 저장하고 생성 위치를 반환한다. */
    @PostMapping
    fun create(@Valid @RequestBody request: NoticeRequest): ResponseEntity<NoticeResponse> {
        val created = service.create(request)
        return ResponseEntity.created(URI.create("/api/v1/operations/notices/${created.id}")).body(created)
    }

    /** 기본 20개·최대 100개 범위의 안정 정렬된 목록을 반환한다. */
    @GetMapping
    fun list(@PageableDefault(size = 20) pageable: Pageable): PageResponse<NoticeResponse> = service.list(pageable)

    /** UUID 공지를 조회하며 없는 공지는 공통 처리기로 404를 반환한다. */
    @GetMapping("/{id}")
    fun read(@PathVariable id: UUID): NoticeResponse = service.read(id)

    /** 검증한 제목·본문으로 기존 공지를 전체 교체한다. */
    @PutMapping("/{id}")
    fun update(@PathVariable id: UUID, @Valid @RequestBody request: NoticeRequest): NoticeResponse =
        service.update(id, request)

    /** 존재하는 공지를 삭제하고 응답 본문 없이 204를 반환한다. */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable id: UUID) = service.delete(id)
}
