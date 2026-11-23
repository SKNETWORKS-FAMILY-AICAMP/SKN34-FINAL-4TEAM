package ai.storyfork.operations.cardcategory.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryCreateRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryOrderRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryUpdateRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode

private const val WORKS = "works"

/**
 * World card categories are managed with the same `works` permission as genres and the operations works API, checked before any Content call.
 * Content owns the list and every rule, so its JSON is returned untouched. No service transaction, so a slow Content call never holds a DB connection.
 * A change is recorded in the admin activity log only after Content succeeded: `card_category.create` / `card_category.update` on the category code with
 * its name. A reorder has no single category, so it is recorded as `card_category.reorder` on the fixed target `order` with the new order of codes.
 */
@Service
class CardCategoryService(
    private val content: ContentClient,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
) {
    fun list(member: OperationsMember): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.cardCategories()
    }

    fun create(member: OperationsMember, request: CardCategoryCreateRequest): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.createCardCategory(request).also { activities.record(member, "card_category.create", "card_category", it.text("code"), it.text("name")) }
    }

    fun update(member: OperationsMember, code: String, request: CardCategoryUpdateRequest): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.updateCardCategory(code, request).also { activities.record(member, "card_category.update", "card_category", code, it.text("name")) }
    }

    fun reorder(member: OperationsMember, request: CardCategoryOrderRequest): JsonNode {
        permissions.requirePermission(member, WORKS)
        return content.reorderCardCategories(request.codes).also {
            activities.record(member, "card_category.reorder", "card_category", "order", request.codes.joinToString(","))
        }
    }
}

private fun JsonNode.text(field: String) = path(field).textOrNull().orEmpty()
