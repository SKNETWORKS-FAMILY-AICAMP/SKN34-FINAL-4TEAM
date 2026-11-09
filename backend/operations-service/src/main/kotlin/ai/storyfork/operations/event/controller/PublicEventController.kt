package ai.storyfork.operations.event.controller

import ai.storyfork.operations.event.service.EventService
import ai.storyfork.operations.event.service.dto.EventListResponse
import ai.storyfork.operations.event.service.dto.EventResponse
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.web.bind.annotation.*

/** 인증 없는 독자용 읽기 전용 조회. 쓰기 핸들러는 두지 않고 보안 체인도 이 경로의 GET 외 메서드를 거절한다. */
@RestController
@RequestMapping("/api/v1/operations/public/events")
class PublicEventController(private val service: EventService) {
    /** 최신 등록순 최대 100개이며 종료된 이벤트도 포함한다. ponytail: 이벤트가 늘면 page 매개변수를 받는다. */
    @GetMapping
    fun list(): EventListResponse = service.list(PageRequest.of(0, 100))

    @GetMapping("/{id}")
    fun read(@PathVariable id: UUID): EventResponse = service.read(id)
}
