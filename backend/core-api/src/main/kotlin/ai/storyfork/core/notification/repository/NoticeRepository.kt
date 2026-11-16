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

    fun existsByIdAndRecipientId(id: UUID, recipientId: UUID): Boolean

    /** 삭제된 알림까지 포함해 해당 사건으로 이미 알림을 만들었는지 확인한다. */
    fun existsBySourceEventId(sourceEventId: UUID): Boolean

    /** 같은 종류·대상으로 묶은 삭제되지 않은 알림의 건수·미읽음 수·최근 도착 시각을 최근 순으로 반환한다. 대상이 없는 알림은 묶지 않는다. */
    @Query("select n.kind as kind, n.targetType as targetType, n.targetId as targetId, count(n) as total, " +
        "count(case when n.readAt is null then 1 end) as unread, max(n.createdAt) as latestAt " +
        "from NoticeEntity n where n.recipientId = :recipientId and n.deletedAt is null and n.targetType is not null and n.targetId is not null " +
        "group by n.kind, n.targetType, n.targetId order by max(n.createdAt) desc, n.kind, n.targetType, n.targetId")
    fun groupSummaries(recipientId: UUID, pageable: Pageable): List<NoticeGroupRow>

    /** 한 묶음에 속한 삭제되지 않은 알림을 최신순으로 반환한다. */
    @Query("select n from NoticeEntity n where n.recipientId = :recipientId and n.deletedAt is null and n.kind = :kind and n.targetType = :targetType and n.targetId = :targetId order by n.createdAt desc, n.id desc")
    fun groupItems(recipientId: UUID, kind: String, targetType: String, targetId: String, pageable: Pageable): List<NoticeEntity>

    /** 읽지 않은 본인 알림 하나만 읽음 처리한다. 필요한 컬럼만 조건부로 갱신해 동시 삭제 표시를 덮어쓰지 않는다. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update NoticeEntity n set n.readAt = :now where n.id = :id and n.recipientId = :recipientId and n.readAt is null and n.deletedAt is null")
    fun markRead(id: UUID, recipientId: UUID, now: Instant): Int

    /** 삭제하지 않은 본인 알림 하나에 삭제 시각을 기록한다. 이미 삭제했거나 없으면 0을 반환한다. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update NoticeEntity n set n.deletedAt = :now where n.id = :id and n.recipientId = :recipientId and n.deletedAt is null")
    fun markDeleted(id: UUID, recipientId: UUID, now: Instant): Int

    /** 기준 시점 이전(포함)에 만들어진 읽지 않은 알림만 읽음 처리한다. 그 뒤 도착한 알림은 미읽음으로 남는다. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update NoticeEntity n set n.readAt = :now where n.recipientId = :recipientId and n.readAt is null and n.deletedAt is null and n.createdAt <= :upTo")
    fun markReadUpTo(recipientId: UUID, now: Instant, upTo: Instant): Int
}
