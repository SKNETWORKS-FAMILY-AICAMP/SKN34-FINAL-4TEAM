package ai.storyfork.core.notification.service

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.notification.domain.NoticeKind
import ai.storyfork.core.notification.entity.NoticeEntity
import ai.storyfork.core.notification.entity.NoticePreferenceEntity
import ai.storyfork.core.notification.repository.NoticePreferenceRepository
import ai.storyfork.core.notification.repository.NoticeRepository
import ai.storyfork.core.notification.service.dto.NoticeCreateRequest
import ai.storyfork.core.notification.service.dto.NoticeGroupItemsRequest
import ai.storyfork.core.notification.service.dto.NoticeGroupListRequest
import ai.storyfork.core.notification.service.dto.NoticeGroupListResponse
import ai.storyfork.core.notification.service.dto.NoticeGroupResponse
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
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager

/** 회원별 알림함·알림 설정 규칙. 다른 회원의 알림은 존재하지 않는 것처럼 404로 취급한다. */
@Service
class NoticeService(
    private val notices: NoticeRepository,
    private val preferences: NoticePreferenceRepository,
    private val members: MemberRepository,
    private val stream: NoticeStream,
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

    /** 본인의 삭제되지 않은 알림 하나를 반환한다. 읽음 처리는 하지 않으며, 없거나 타인·삭제된 알림이면 404다. */
    @Transactional(readOnly = true)
    fun get(memberId: UUID, id: UUID): NoticeResponse = toResponse(visible(memberId, id))

    /**
     * 같은 종류·대상의 알림을 하나로 묶어 최근 도착순으로 limit개 반환한다. 대상이 없는 알림은 묶지 않으므로 목록 API로 본다.
     * 묶음 표시 기준 시간은 UC-27에서 미정이라 1차는 시간 제한 없이 같은 종류·대상이면 묶는다.
     */
    @Transactional(readOnly = true)
    fun groups(memberId: UUID, request: NoticeGroupListRequest): NoticeGroupListResponse =
        NoticeGroupListResponse(notices.groupSummaries(memberId, PageRequest.of(0, request.limit)).mapNotNull { row ->
            notices.groupItems(memberId, row.kind, row.targetType, row.targetId, PageRequest.of(0, 1)).firstOrNull()
                ?.let { NoticeGroupResponse(row.kind, row.targetType, row.targetId, row.total, row.unread, row.latestAt, it.summary) }
        })

    /**
     * 한 묶음에 속한 개별 알림을 최신순으로 최대 limit개 반환한다. 알 수 없는 종류는 400이다.
     * 1차는 페이지 넘김이 없어 묶음이 limit보다 크면 오래된 알림은 이 API로 볼 수 없고, nextCursor는 항상 null이다.
     */
    @Transactional(readOnly = true)
    fun groupItems(memberId: UUID, request: NoticeGroupItemsRequest): NoticeListResponse {
        val kind = NoticeKind.fromCode(requireNotNull(request.kind))?.code ?: throw NoticeException(NoticeException.Reason.INVALID)
        return NoticeListResponse(
            notices.groupItems(memberId, kind, requireNotNull(request.targetType), requireNotNull(request.targetId), PageRequest.of(0, request.limit)).map(::toResponse),
            null,
        )
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
        if (notices.markDeleted(id, memberId, Instant.now()) == 0 && !notices.existsByIdAndRecipientId(id, memberId)) throw NoticeException(NoticeException.Reason.NOT_FOUND)
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
        // 설정 행이 없는 같은 회원·분류의 최초 저장이 동시에 오면 복합 PK 충돌이 나므로 회원 행 잠금으로 직렬화한다.
        members.lockById(memberId) ?: throw NoticeException(NoticeException.Reason.UNAUTHENTICATED)
        val kinds = request.items.map { NoticeKind.fromCode(requireNotNull(it.kind)) ?: throw NoticeException(NoticeException.Reason.INVALID) }
        if (kinds.toSet().size != kinds.size) throw NoticeException(NoticeException.Reason.INVALID)
        request.items.forEachIndexed { index, item ->
            val kind = kinds[index]
            val enabled = requireNotNull(item.enabled)
            if (!kind.mutable) {
                if (!enabled) throw NoticeException(NoticeException.Reason.INVALID)
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
        // 사건 id 유일 제약 위반을 이 트랜잭션 안에서 바로 드러내도록 즉시 반영한다.
        val saved = notices.saveAndFlush(NoticeEntity(
            id = UUID.randomUUID(), recipientId = request.recipientId, kind = request.kind.code, summary = request.summary,
            targetType = request.targetType, targetId = request.targetId, createdAt = Instant.now().truncatedTo(ChronoUnit.MICROS),
            sourceEventId = request.sourceEventId,
        ))
        signalAfterCommit(request.recipientId)
        return toResponse(saved)
    }

    /** 알림이 DB에 커밋된 뒤에만 본인에게 변경 신호를 보낸다. 롤백되면 신호도 보내지 않는다. */
    private fun signalAfterCommit(recipientId: UUID) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
                override fun afterCommit() = stream.notifyChanged(recipientId)
            })
        } else {
            stream.notifyChanged(recipientId)
        }
    }

    /** 본인의 삭제되지 않은 알림만 반환하고, 없거나 타인·삭제된 알림이면 404를 던진다. */
    private fun visible(memberId: UUID, id: UUID): NoticeEntity =
        notices.findByIdAndRecipientId(id, memberId)?.takeIf { it.deletedAt == null } ?: throw NoticeException(NoticeException.Reason.NOT_FOUND)

    /** `<createdAt ISO>_<uuid>` 형식의 cursor를 해석하며 잘못된 값은 400으로 변환한다. */
    private fun parseCursor(cursor: String): Pair<Instant, UUID> = try {
        Instant.parse(cursor.substringBefore('_')) to UUID.fromString(cursor.substringAfter('_'))
    } catch (_: RuntimeException) { throw NoticeException(NoticeException.Reason.INVALID) }

    /** 엔티티를 공개 응답으로 변환한다. */
    private fun toResponse(n: NoticeEntity) = NoticeResponse(n.id.toString(), n.kind, n.summary, n.targetType, n.targetId, n.createdAt, n.readAt != null)
}
