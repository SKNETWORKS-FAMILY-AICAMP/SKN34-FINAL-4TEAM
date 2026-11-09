package ai.storyfork.operations.notice.service

import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Service

/**
 * Core operator + `notices` 권한을 확인한 뒤 기존 [NoticeService]에 위임한다. 권한 검사는 검증·저장소 호출보다 먼저다.
 * 트랜잭션은 열지 않는다. 권한 조회와 공지 처리는 각자의 트랜잭션을 쓴다.
 */
@Service
class AdminNoticeService(private val notices: NoticeService, private val permissions: AdminPermissionRepository) {
    fun list(member: OperationsMember) = allowed(member) { notices.list(PageRequest.of(0, 100)) }

    fun read(member: OperationsMember, id: UUID) = allowed(member) { notices.read(id) }

    fun create(member: OperationsMember, request: NoticeRequest) = allowed(member) { notices.create(request) }

    fun update(member: OperationsMember, id: UUID, request: NoticeRequest) = allowed(member) { notices.update(id, request) }

    fun delete(member: OperationsMember, id: UUID) = allowed(member) { notices.delete(id) }

    private fun <T> allowed(member: OperationsMember, action: () -> T): T {
        permissions.requirePermission(member, "notices")
        return action()
    }
}
