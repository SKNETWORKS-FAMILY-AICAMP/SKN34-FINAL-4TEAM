package ai.storyfork.core.notification.repository

import ai.storyfork.core.notification.entity.NoticeEntity
import java.time.Instant
import java.util.UUID
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query

interface NoticeRepository : JpaRepository<NoticeEntity, UUID> {
    @Query("select n from NoticeEntity n where n.recipientId = :recipientId and n.deletedAt is null order by n.createdAt desc, n.id desc")
    fun firstPage(recipientId: UUID, pageable: Pageable): List<NoticeEntity>

    @Query("select n from NoticeEntity n where n.recipientId = :recipientId and n.deletedAt is null and (n.createdAt < :at or (n.createdAt = :at and n.id < :id)) order by n.createdAt desc, n.id desc")
    fun pageAfter(recipientId: UUID, at: Instant, id: UUID, pageable: Pageable): List<NoticeEntity>

    fun countByRecipientIdAndReadAtIsNullAndDeletedAtIsNull(recipientId: UUID): Long

    fun findByIdAndRecipientId(id: UUID, recipientId: UUID): NoticeEntity?

    /** 기준 시점 이전(포함)에 만들어진 읽지 않은 알림만 읽음 처리한다. 그 뒤 도착한 알림은 미읽음으로 남는다. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update NoticeEntity n set n.readAt = :now where n.recipientId = :recipientId and n.readAt is null and n.deletedAt is null and n.createdAt <= :upTo")
    fun markReadUpTo(recipientId: UUID, now: Instant, upTo: Instant): Int
}
