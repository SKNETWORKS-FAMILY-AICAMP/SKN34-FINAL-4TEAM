package ai.storyfork.operations.worldstudio.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.ObjectNode

private const val WORKS = "works"

/**
 * World studios are operated with the same `works` permission as the operations works API, checked before any Content or Core call. Content owns the rows
 * and the restriction, so its JSON is returned as it is; the list only gains `ownerName`, the owner's current Core nickname (null for an owner Core does
 * not list). No service transaction, so a slow call never holds a DB connection. A restriction is recorded in the admin activity log only after Content
 * succeeded, as `world.restrict` / `world.unrestrict` on the world id with the world name.
 */
@Service
class WorldStudioService(
    private val content: ContentClient,
    private val core: CoreClient,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
) {
    fun list(member: OperationsMember, authorization: String): JsonNode {
        permissions.requirePermission(member, WORKS)
        val worlds = content.worldStudios()
        // One Core member list for the nicknames; the admin's own Bearer is forwarded, so Core re-checks operator=true.
        val nicknames = core.members(authorization, null, null, null).items.associate { it.id.toString() to it.nickname }
        worlds.values().filterIsInstance<ObjectNode>().forEach { it.put("ownerName", nicknames[it.path("ownerId").textOrNull()]) }
        return worlds
    }

    fun restrict(member: OperationsMember, id: UUID): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.restrictWorld(id).also { activities.record(member, "world.restrict", "world", id, it.path("name").textOrNull()) }
    }

    fun unrestrict(member: OperationsMember, id: UUID): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.unrestrictWorld(id).also { activities.record(member, "world.unrestrict", "world", id, it.path("name").textOrNull()) }
    }
}
