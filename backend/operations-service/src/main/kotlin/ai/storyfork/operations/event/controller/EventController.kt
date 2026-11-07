package ai.storyfork.operations.event.controller

import ai.storyfork.operations.event.service.EventService
import ai.storyfork.operations.event.service.dto.EventListResponse
import ai.storyfork.operations.event.service.dto.EventRequest
import ai.storyfork.operations.event.service.dto.EventResponse
import jakarta.validation.Valid
import java.net.URI
import java.util.UUID
import org.springframework.data.domain.Pageable
import org.springframework.data.web.PageableDefault
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

/** 서비스 토큰으로 보호되는 독립 운영 이벤트 안내 CRUD이며 회원 권한을 대신 판단하지 않는다. */
@RestController
@RequestMapping("/api/v1/operations/events")
class EventController(private val service: EventService) {
    /** 이벤트 안내를 등록하고 201과 생성한 리소스의 Location을 반환한다. 입력 오류는 400이다. */
    @PostMapping
    fun create(@Valid @RequestBody request: EventRequest): ResponseEntity<EventResponse> {
        val event = service.create(request)
        return ResponseEntity.created(URI.create("/api/v1/operations/events/${event.id}")).body(event)
    }

    /** 고정 정렬된 이벤트 안내 목록을 기본 20개, 최대 100개인 명시적 페이지 DTO로 반환한다. */
    @GetMapping
    fun list(@PageableDefault(size = 20) pageable: Pageable): EventListResponse = service.list(pageable)

    /** 이벤트 안내와 UTC 기간을 반환하며, 없는 UUID는 404다. */
    @GetMapping("/{id}")
    fun read(@PathVariable id: UUID): EventResponse = service.read(id)

    /** 제목·본문·선택 기간을 전체 교체한다. 입력 오류는 400, 없음은 404, 동시 수정 충돌은 409다. */
    @PutMapping("/{id}")
    fun update(@PathVariable id: UUID, @Valid @RequestBody request: EventRequest): EventResponse = service.update(id, request)

    /** 버전 검사를 거쳐 안내를 삭제하고 204를 반환한다. 없음은 404, 동시 수정 충돌은 409다. */
    @DeleteMapping("/{id}")
    fun delete(@PathVariable id: UUID): ResponseEntity<Void> {
        service.delete(id)
        return ResponseEntity.noContent().build()
    }
}
