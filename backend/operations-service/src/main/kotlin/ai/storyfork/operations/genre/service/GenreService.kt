package ai.storyfork.operations.genre.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.genre.service.dto.GenreCreateRequest
import ai.storyfork.operations.genre.service.dto.GenreOrderRequest
import ai.storyfork.operations.genre.service.dto.GenreUpdateRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode

private const val WORKS = "works"

/**
 * Genres are managed with the same `works` permission as the operations works API, checked before any Content call (DEC-56).
 * Content owns the list and every rule, so its JSON is returned untouched. No service transaction, so a slow Content call never holds a DB connection.
 * A change is recorded in the admin activity log only after Content succeeded: the target is the genre code and the detail its name.
 * A reorder has no single genre, so it is recorded under the fixed target `order` with the new order of codes as the detail.
 */
@Service
class GenreService(
    private val content: ContentClient,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
) {
    fun list(member: OperationsMember): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.genres()
    }

    fun create(member: OperationsMember, request: GenreCreateRequest): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.createGenre(request).also { activities.record(member, "GENRE_CREATE", "GENRE", it.text("code"), it.text("name")) }
    }

    fun update(member: OperationsMember, code: String, request: GenreUpdateRequest): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.updateGenre(code, request).also { activities.record(member, "GENRE_UPDATE", "GENRE", code, it.text("name")) }
    }

    fun reorder(member: OperationsMember, request: GenreOrderRequest): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.reorderGenres(request.codes).also {
            activities.record(member, "GENRE_REORDER", "GENRE", "order", request.codes.joinToString(","))
        }
    }
}

private fun JsonNode.text(field: String) = path(field).textOrNull().orEmpty()
