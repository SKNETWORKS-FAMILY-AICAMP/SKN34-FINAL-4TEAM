package ai.storyfork.operations.event.service

import ai.storyfork.operations._common.service.dto.PageResponse
import ai.storyfork.operations._common.service.dto.toResponse
import ai.storyfork.operations.event.entity.EventEntity
import ai.storyfork.operations.event.repository.EventRepository
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

    fun list(pageable: Pageable): PageResponse<EventResponse> {
        val bounded = PageRequest.of(pageable.pageNumber, pageable.pageSize, Sort.by(Sort.Direction.DESC, "createdAt", "id"))
        return events.findAll(bounded).toResponse { it.toResponse() }
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

    // Length is @Size on EventRequest. Blank is re-checked because @NotBlank (String.isBlank) accepts U+00A0, U+2007 and U+202F;
    // PostgreSQL text cannot hold U+0000 and the period order spans two fields.
    private fun validate(request: EventRequest) {
        require(request.title.isNotBlank() && '\u0000' !in request.title)
        require(request.body.isNotBlank() && '\u0000' !in request.body)
        require(request.startsAt == null || request.endsAt == null || !request.endsAt.isBefore(request.startsAt))
    }

    private fun EventEntity.toResponse() = EventResponse(id, title, body, startsAt, endsAt, createdAt, updatedAt)
}
