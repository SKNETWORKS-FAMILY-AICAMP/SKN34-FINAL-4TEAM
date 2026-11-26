package ai.storyfork.core.notification.repository

import ai.storyfork.core.notification.entity.PushDevice
import java.time.Instant
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query

interface PushDeviceRepository : JpaRepository<PushDevice, UUID> {
    fun findAllBySessionIdIn(sessionIds: List<UUID>): List<PushDevice>

    @Modifying
    @Query("delete from PushDevice d where d.sessionId = :sessionId")
    fun deleteForSession(sessionId: UUID): Int

    @Modifying
    @Query("delete from PushDevice d where d.sessionId in (select s.id from AuthSession s where s.memberId = :memberId)")
    fun deleteAllForMember(memberId: UUID): Int

    @Modifying
    @Query("delete from PushDevice d where d.installationId = :id and d.sessionId in " +
        "(select s.id from AuthSession s where s.memberId = :memberId)")
    fun deleteForMember(id: UUID, memberId: UUID): Int

    @Modifying
    @Query("delete from PushDevice d where d.installationId = :id and d.sessionId = :sessionId and d.token = :token")
    fun deleteMatching(id: UUID, sessionId: UUID, token: String): Int

    @Modifying
    @Query("update PushDevice d set d.endpointArn = :endpointArn where d.installationId = :id " +
        "and d.sessionId = :sessionId and d.token = :token")
    fun saveEndpoint(id: UUID, sessionId: UUID, token: String, endpointArn: String?): Int

    @Query("select count(d) > 0 from PushDevice d, AuthSession s where s.id = d.sessionId and s.revoked = false " +
        "and s.expiresAt > :now and d.installationId = :id and d.sessionId = :sessionId and d.token = :token")
    fun isActive(id: UUID, sessionId: UUID, token: String, now: Instant): Boolean

    @Modifying
    @Query("delete from PushDevice d where d.sessionId in (select s.id from AuthSession s where s.revoked = true or s.expiresAt <= :now)")
    fun deleteInactive(now: Instant): Int
}
