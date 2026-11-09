package ai.storyfork.operations.event.service

import ai.storyfork.operations.event.entity.EventEntity
import ai.storyfork.operations.event.repository.EventRepository
import ai.storyfork.operations.event.service.dto.EventListResponse
import ai.storyfork.operations.event.service.dto.EventRequest
import ai.storyfork.operations.event.service.dto.EventResponse
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional(readOnly = true)
class EventService(private val events: EventRepository) {
    @Transactional
    fun create(request: EventRequest): EventResponse {
        validate(request)
        return events.save(EventEntity(
            title = request.title, body = request.body,
            startsAt = request.startsAt, endsAt = request.endsAt,
        )).toResponse()
    }

    fun list(pageable: Pageable): EventListResponse {
        val bounded = PageRequest.of(
            pageable.pageNumber, pageable.pageSize.coerceAtMost(100),
            Sort.by(Sort.Direction.DESC, "createdAt", "id"),
        )
        val page = events.findAll(bounded)
        return EventListResponse(page.content.map { it.toResponse() }, page.number, page.size, page.totalElements, page.totalPages)
    }

    fun read(id: UUID): EventResponse = find(id).toResponse()

    @Transactional
    fun update(id: UUID, request: EventRequest): EventResponse {
        val event = find(id)
        validate(request)
        event.title = request.title
        event.body = request.body
        event.startsAt = request.startsAt
        event.endsAt = request.endsAt
        event.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        return event.toResponse()
    }

    @Transactional
    fun delete(id: UUID) = events.delete(find(id))

    private fun find(id: UUID): EventEntity = events.findById(id).orElseThrow { NoSuchElementException() }

    private fun validate(request: EventRequest) {
        require(request.title.isNotBlank() && request.title.length <= 200 && '\u0000' !in request.title)
        require(request.body.isNotBlank() && request.body.length <= 20_000 && '\u0000' !in request.body)
        require(request.startsAt == null || request.endsAt == null || !request.endsAt.isBefore(request.startsAt))
    }

    private fun EventEntity.toResponse() = EventResponse(id, title, body, startsAt, endsAt, createdAt, updatedAt)
}
