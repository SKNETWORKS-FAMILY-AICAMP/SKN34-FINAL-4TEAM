package ai.storyfork.operations.notice.service

import ai.storyfork.operations._common.service.dto.PageResponse
import ai.storyfork.operations._common.service.dto.toResponse
import ai.storyfork.operations.notice.entity.NoticeEntity
import ai.storyfork.operations.notice.repository.NoticeRepository
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import ai.storyfork.operations.notice.service.dto.NoticeResponse
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 공지 CRUD의 입력 검증·트랜잭션·응답 변환을 담당한다. */
@Service
@Transactional(readOnly = true)
class NoticeService(private val repository: NoticeRepository) {
    /** 입력 전체를 먼저 검증한 뒤 일반 텍스트를 변경 없이 저장한다. */
    @Transactional
    fun create(request: NoticeRequest): NoticeResponse {
        validate(request)
        return response(repository.saveAndFlush(NoticeEntity(title = request.title, body = request.body)))
    }

    /** 호출자의 정렬 대신 생성 시각·UUID 내림차순으로 최대 100개를 조회한다. */
    fun list(pageable: Pageable): PageResponse<NoticeResponse> {
        val bounded = PageRequest.of(
            if (pageable.isPaged) pageable.pageNumber else 0,
            if (pageable.isPaged) pageable.pageSize.coerceAtMost(100) else 20,
            Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")),
        )
        return repository.findAll(bounded).toResponse(::response)
    }

    /** 저장된 공지 DTO를 반환하며 없으면 공통 404 처리기에 위임한다. */
    fun read(id: UUID): NoticeResponse = response(find(id))

    /** 검증이 끝난 제목·본문만 교체하고 생성 시각·UUID를 보존한다. */
    @Transactional
    fun update(id: UUID, request: NoticeRequest): NoticeResponse {
        validate(request)
        val entity = find(id)
        entity.title = request.title
        entity.body = request.body
        entity.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        return response(repository.saveAndFlush(entity))
    }

    /** 버전을 포함해 조회한 엔티티를 삭제하여 동시 변경 충돌을 보존한다. */
    @Transactional
    fun delete(id: UUID) = repository.delete(find(id))

    private fun find(id: UUID): NoticeEntity = repository.findById(id).orElseThrow()

    private fun validate(request: NoticeRequest) {
        require(request.title.isNotBlank() && request.title.length <= 200 && '\u0000' !in request.title)
        require(request.body.isNotBlank() && request.body.length <= 20_000 && '\u0000' !in request.body)
    }

    private fun response(entity: NoticeEntity) = NoticeResponse(
        entity.id, entity.title, entity.body, entity.createdAt, entity.updatedAt,
    )
}
