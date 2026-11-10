package ai.storyfork.operations.event.service

import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.event.service.dto.EventRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import jakarta.validation.ConstraintViolationException
import jakarta.validation.Validator
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * `events` 권한 확인이 조회·검증보다 먼저이며, 저장·검증은 기존 [EventService]에 위임한다. 변경(create·update·delete)은 한 트랜잭션이라
 * [EventService]의 트랜잭션이 여기에 합류하고, 이벤트 저장과 관리자 활동 기록이 함께 커밋되며 기록이 실패하면 저장도 롤백된다.
 * `@Valid`는 권한보다 먼저 400을 내므로 쓰지 않고, 길이 규칙의 출처인 [EventRequest] 어노테이션을 권한 확인 뒤 직접 검증한다.
 */
@Service
class AdminEventService(
    private val events: EventService,
    private val permissions: AdminPermissionRepository,
    private val validator: Validator,
    private val activities: AdminActivityService,
) {
    @Transactional
    fun create(member: OperationsMember, request: EventRequest) =
        admin(member).create(valid(request)).also { activities.record(member, "EVENT_CREATE", "EVENT", it.id, it.title) }

    /** 최신 등록순 최대 100개. ponytail: 이벤트가 늘면 page 매개변수를 받는다. */
    fun list(member: OperationsMember) = admin(member).list(PageRequest.of(0, 100))

    fun read(member: OperationsMember, id: UUID) = admin(member).read(id)

    @Transactional
    fun update(member: OperationsMember, id: UUID, request: EventRequest) =
        admin(member).update(id, valid(request)).also { activities.record(member, "EVENT_UPDATE", "EVENT", id, it.title) }

    @Transactional
    fun delete(member: OperationsMember, id: UUID) {
        admin(member).delete(id)
        activities.record(member, "EVENT_DELETE", "EVENT", id, null)
    }

    // 수신자 `admin(member)`가 인자 `valid(request)`보다 먼저 평가되므로 권한 거절(403)이 입력 오류(400)보다 앞선다.
    private fun admin(member: OperationsMember): EventService {
        permissions.requirePermission(member, "events")
        return events
    }

    private fun valid(request: EventRequest) = request.also {
        val violations = validator.validate(it)
        if (violations.isNotEmpty()) throw ConstraintViolationException(violations)
    }
}
