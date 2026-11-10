package ai.storyfork.operations.notice.service

import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import ai.storyfork.operations.security.OperationsMember
import jakarta.validation.ConstraintViolationException
import jakarta.validation.Validator
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * Core operator + `notices` 권한을 확인한 뒤 기존 [NoticeService]에 위임한다. 권한 검사는 검증·저장소 호출보다 먼저다.
 * `@Valid`는 권한보다 먼저 400을 내므로 쓰지 않고, 길이 규칙의 출처인 [NoticeRequest] 어노테이션을 권한 확인 뒤 직접 검증한다.
 * 변경(create·update·delete)은 한 트랜잭션이다. [NoticeService]의 트랜잭션이 여기에 합류하므로 공지 저장과 관리자 활동 기록이
 * 함께 커밋되고, 기록이 실패하면 저장도 롤백된다. 조회는 트랜잭션을 열지 않는다.
 */
@Service
class AdminNoticeService(
    private val notices: NoticeService,
    private val permissions: AdminPermissionRepository,
    private val validator: Validator,
    private val activities: AdminActivityService,
) {
    fun list(member: OperationsMember) = allowed(member) { notices.list(PageRequest.of(0, 100)) }

    fun read(member: OperationsMember, id: UUID) = allowed(member) { notices.read(id) }

    @Transactional
    fun create(member: OperationsMember, request: NoticeRequest) =
        allowed(member) { notices.create(valid(request)) }.also { activities.record(member, "NOTICE_CREATE", "NOTICE", it.id, it.title) }

    @Transactional
    fun update(member: OperationsMember, id: UUID, request: NoticeRequest) =
        allowed(member) { notices.update(id, valid(request)) }.also { activities.record(member, "NOTICE_UPDATE", "NOTICE", id, it.title) }

    @Transactional
    fun delete(member: OperationsMember, id: UUID) {
        allowed(member) { notices.delete(id) }
        activities.record(member, "NOTICE_DELETE", "NOTICE", id, null)
    }

    private fun <T> allowed(member: OperationsMember, action: () -> T): T {
        permissions.requirePermission(member, "notices")
        return action()
    }

    private fun valid(request: NoticeRequest) = request.also {
        val violations = validator.validate(it)
        if (violations.isNotEmpty()) throw ConstraintViolationException(violations)
    }
}
