package ai.storyfork.operations.event.service

import ai.storyfork.operations.event.service.dto.EventRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Service

/** `events` 권한 확인이 조회·검증보다 먼저이며, 저장·검증은 기존 [EventService]에 위임한다. 트랜잭션은 위임 호출이 각자 가진다. */
@Service
class AdminEventService(private val events: EventService, private val permissions: AdminPermissionRepository) {
    fun create(member: OperationsMember, request: EventRequest) = admin(member).create(request)

    /** 최신 등록순 최대 100개. ponytail: 이벤트가 늘면 page 매개변수를 받는다. */
    fun list(member: OperationsMember) = admin(member).list(PageRequest.of(0, 100))

    fun read(member: OperationsMember, id: UUID) = admin(member).read(id)

    fun update(member: OperationsMember, id: UUID, request: EventRequest) = admin(member).update(id, request)

    fun delete(member: OperationsMember, id: UUID) = admin(member).delete(id)

    private fun admin(member: OperationsMember): EventService {
        permissions.requirePermission(member, "events")
        return events
    }
}
