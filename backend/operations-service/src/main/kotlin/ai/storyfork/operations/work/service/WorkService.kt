package ai.storyfork.operations.work.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.ContentWork
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import ai.storyfork.operations.work.service.dto.OperationsWorkList
import java.util.UUID
import org.springframework.stereotype.Service

private const val WORKS = "works"

/** The `works` permission is checked before any Content call. No service transaction, so a slow Content call never holds a DB connection. */
@Service
class WorkService(private val content: ContentClient, private val permissions: AdminPermissionRepository) {
    fun list(member: OperationsMember): OperationsWorkList {
        permissions.requirePermission(member, WORKS)
        return content.works()
    }

    fun restrict(member: OperationsMember, id: UUID): ContentWork {
        permissions.requirePermission(member, WORKS)
        return content.restrict(id)
    }

    fun unrestrict(member: OperationsMember, id: UUID): ContentWork {
        permissions.requirePermission(member, WORKS)
        return content.unrestrict(id)
    }
}
