package ai.storyfork.operations.llmops.service

import ai.storyfork.operations.llmops.repository.LeakCheckResultRepository
import ai.storyfork.operations.llmops.service.dto.LeakCheck
import ai.storyfork.operations.llmops.service.dto.LeakCheckListResponse
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** The information-leak sample results for llm admins, newest first. */
@Service
class LeakCheckService(private val permissions: AdminPermissionRepository, private val results: LeakCheckResultRepository) {
    @Transactional(readOnly = true)
    fun list(member: OperationsMember): LeakCheckListResponse {
        permissions.requirePermission(member, "llm")
        return LeakCheckListResponse(results.findTop100ByOrderByCheckedAtDescIdDesc().map {
            LeakCheck(it.id, it.traceId, it.workId, it.checkedAt, it.matched, it.suspected, it.reason)
        })
    }
}
