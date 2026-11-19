package ai.storyfork.operations.alert.controller

import ai.storyfork.operations.alert.service.AlertService
import ai.storyfork.operations.alert.service.dto.AlertActRequest
import ai.storyfork.operations.alert.service.dto.AlertRuleRequest
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

/** Member Bearer API (operator + llm or jobs; the rule settings need llm). Permission checks live in [AlertService]. */
@RestController
@RequestMapping("/api/v1/operations/alerts")
class AlertController(private val service: AlertService) {
    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember, @RequestParam(required = false) status: String?) =
        service.list(member, status)

    @PutMapping("/{id}")
    fun act(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID, @RequestBody request: AlertActRequest) =
        service.act(member, id, request)

    @GetMapping("/rules")
    fun rules(@AuthenticationPrincipal member: OperationsMember) = service.rules(member)

    @PutMapping("/rules/{key}")
    fun updateRule(@AuthenticationPrincipal member: OperationsMember, @PathVariable key: String, @RequestBody request: AlertRuleRequest) =
        service.updateRule(member, key, request)
}
