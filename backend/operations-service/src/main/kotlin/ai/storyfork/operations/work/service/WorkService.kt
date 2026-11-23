package ai.storyfork.operations.work.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.ContentWork
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import ai.storyfork.operations.work.service.dto.ForkIntegrity
import ai.storyfork.operations.work.service.dto.OperationsWorkList
import java.util.UUID
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode

private const val WORKS = "works"

/**
 * The `works` permission is checked before any Content call. No service transaction, so a slow Content call never holds a DB connection.
 * The admin activity is recorded only after the Content call succeeded.
 * Episodes are Content's JSON as it is. An episode change is recorded as `episode.restrict` / `episode.unrestrict` on the target `<workId>:<number>` with the episode title.
 */
@Service
class WorkService(
    private val content: ContentClient,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
) {
    fun list(member: OperationsMember): OperationsWorkList {
        permissions.requirePermission(member, WORKS)
        return content.works()
    }

    fun forkIntegrity(member: OperationsMember, id: UUID): ForkIntegrity {
        permissions.requirePermission(member, WORKS)
        return content.forkIntegrity(id)
    }

    fun episodes(member: OperationsMember, id: UUID): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.episodes(id)
    }

    fun restrictEpisode(member: OperationsMember, id: UUID, number: Int): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.restrictEpisode(id, number).also { activities.record(member, "episode.restrict", "episode", "$id:$number", it.path("title").textOrNull()) }
    }

    fun unrestrictEpisode(member: OperationsMember, id: UUID, number: Int): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.unrestrictEpisode(id, number).also { activities.record(member, "episode.unrestrict", "episode", "$id:$number", it.path("title").textOrNull()) }
    }

    fun restrict(member: OperationsMember, id: UUID): ContentWork {
        permissions.requirePermission(member, WORKS)
        return content.restrict(id).also { activities.record(member, "WORK_RESTRICT", "WORK", id, it.title) }
    }

    fun unrestrict(member: OperationsMember, id: UUID): ContentWork {
        permissions.requirePermission(member, WORKS)
        return content.unrestrict(id).also { activities.record(member, "WORK_UNRESTRICT", "WORK", id, it.title) }
    }
}
