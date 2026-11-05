package ai.storyfork.core.notification.service

import ai.storyfork.core.notification.domain.NoticeKind
import ai.storyfork.core.notification.entity.NoticeEntity
import ai.storyfork.core.notification.entity.NoticePreferenceEntity
import ai.storyfork.core.notification.repository.NoticePreferenceRepository
import ai.storyfork.core.notification.repository.NoticeRepository
import ai.storyfork.core.notification.service.dto.NoticeCreateRequest
import ai.storyfork.core.notification.service.dto.NoticeListRequest
import ai.storyfork.core.notification.service.dto.NoticeListResponse
import ai.storyfork.core.notification.service.dto.NoticePreferenceResponse
import ai.storyfork.core.notification.service.dto.NoticePreferencesRequest
import ai.storyfork.core.notification.service.dto.NoticePreferencesResponse
import ai.storyfork.core.notification.service.dto.NoticeResponse
import ai.storyfork.core.notification.service.dto.ReadAllRequest
import ai.storyfork.core.notification.service.dto.UnreadCountResponse
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException

/** 회원별 알림함·알림 설정 규칙. 다른 회원의 알림은 존재하지 않는 것처럼 404로 취급한다. */
@Service
class NoticeService(
    private val notices: NoticeRepository,
    private val preferences: NoticePreferenceRepository,
) {
    /** 본인 알림을 최신순으로 limit개 반환한다. cursor가 형식에 맞지 않으면 400이다. */
    @Transactional(readOnly = true)
    fun list(memberId: UUID, request: NoticeListRequest): NoticeListResponse {
        val page = PageRequest.of(0, request.limit + 1)
        val rows = if (request.cursor == null) notices.firstPage(memberId, page) else {
            val (at, id) = parseCursor(request.cursor)
            notices.pageAfter(memberId, at, id, page)
        }
        val items = rows.take(request.limit)
        val next = if (rows.size > request.limit) items.last().let { "${it.createdAt}_${it.id}" } else null
        return NoticeListResponse(items.map(::toResponse), next)
    }

    /** 삭제하지 않은 본인의 미읽음 알림 수를 반환한다. */
    @Transactional(readOnly = true)
    fun unreadCount(memberId: UUID) = UnreadCountResponse(notices.countByRecipientIdAndReadAtIsNullAndDeletedAtIsNull(memberId))

    /** 이미 읽은 알림은 최초 읽은 시각을 유지하고 성공으로 처리한다(멱등). */
    @Transactional
    fun markRead(memberId: UUID, id: UUID) {
        if (notices.markRead(id, memberId, Instant.now()) == 0) visible(memberId, id)
    }

    /** upTo 이전(포함)에 도착한 본인 미읽음 알림만 읽음 처리한다. 그 뒤 도착한 알림은 미읽음으로 남는다. */
    @Transactional
    fun markAllRead(memberId: UUID, request: ReadAllRequest) {
        notices.markReadUpTo(memberId, Instant.now(), requireNotNull(request.upTo))
    }

    /** 행을 지우지 않고 삭제 표시만 한다. 이미 삭제한 알림을 다시 삭제해도 성공이다. */
    @Transactional
    fun delete(memberId: UUID, id: UUID) {
        if (notices.markDeleted(id, memberId, Instant.now()) == 0 && !notices.existsByIdAndRecipientId(id, memberId)) throw ResponseStatusException(HttpStatus.NOT_FOUND)
    }

    /** 모든 분류의 수신 여부를 반환한다. 저장값이 없으면 켜짐이고 끌 수 없는 분류는 항상 켜짐이다. */
    @Transactional(readOnly = true)
    fun preferences(memberId: UUID): NoticePreferencesResponse {
        val stored = preferences.findAllByMemberId(memberId).associate { it.kind to it.enabled }
        return NoticePreferencesResponse(NoticeKind.entries.map {
            NoticePreferenceResponse(it.code, if (it.mutable) stored[it.code] ?: true else true, it.mutable)
        })
    }

    /** 읽기·창작 분류의 수신 여부를 저장한다. 알 수 없는 분류·중복·끌 수 없는 분류 끄기는 400이며 이때 변경은 모두 롤백한다. */
    @Transactional
    fun updatePreferences(memberId: UUID, request: NoticePreferencesRequest): NoticePreferencesResponse {
        val kinds = request.items.map { NoticeKind.fromCode(requireNotNull(it.kind)) ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST) }
        if (kinds.toSet().size != kinds.size) throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        request.items.forEachIndexed { index, item ->
            val kind = kinds[index]
            val enabled = requireNotNull(item.enabled)
            if (!kind.mutable) {
                if (!enabled) throw ResponseStatusException(HttpStatus.BAD_REQUEST)
            } else {
                preferences.save(NoticePreferenceEntity(memberId, kind.code, enabled))
            }
        }
        return preferences(memberId)
    }

    /** 내부 생성. 끌 수 있는 분류가 꺼져 있으면 만들지 않고 null을 반환한다. */
    @Transactional
    fun create(request: NoticeCreateRequest): NoticeResponse? {
        require(request.summary.length in 1..300)
        if (request.kind.mutable) {
            val stored = preferences.findAllByMemberId(request.recipientId).firstOrNull { it.kind == request.kind.code }
            if (stored != null && !stored.enabled) return null
        }
        val saved = notices.save(NoticeEntity(
            id = UUID.randomUUID(), recipientId = request.recipientId, kind = request.kind.code, summary = request.summary,
            targetType = request.targetType, targetId = request.targetId, createdAt = Instant.now().truncatedTo(ChronoUnit.MICROS),
        ))
        return toResponse(saved)
    }

    /** 본인의 삭제되지 않은 알림만 반환하고, 없거나 타인·삭제된 알림이면 404를 던진다. */
    private fun visible(memberId: UUID, id: UUID): NoticeEntity =
        notices.findByIdAndRecipientId(id, memberId)?.takeIf { it.deletedAt == null } ?: throw ResponseStatusException(HttpStatus.NOT_FOUND)

    /** `<createdAt ISO>_<uuid>` 형식의 cursor를 해석하며 잘못된 값은 400으로 변환한다. */
    private fun parseCursor(cursor: String): Pair<Instant, UUID> = try {
        Instant.parse(cursor.substringBefore('_')) to UUID.fromString(cursor.substringAfter('_'))
    } catch (_: RuntimeException) { throw ResponseStatusException(HttpStatus.BAD_REQUEST) }

    /** 엔티티를 공개 응답으로 변환한다. */
    private fun toResponse(n: NoticeEntity) = NoticeResponse(n.id.toString(), n.kind, n.summary, n.targetType, n.targetId, n.createdAt, n.readAt != null)
}
