package ai.storyfork.operations.report.controller

import ai.storyfork.operations.report.entity.ReportStatus
import ai.storyfork.operations.report.service.ReportService
import ai.storyfork.operations.report.service.dto.*
import ai.storyfork.operations.security.OperationsMember
import java.net.URI
import java.util.UUID
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

/** Mutations return the updated report detail including `history`. */
@RestController
@RequestMapping("/api/v1/operations/reports")
class ReportController(private val service: ReportService) {
    @PostMapping
    fun create(@AuthenticationPrincipal member: OperationsMember, @RequestBody request: ReportRequest): ResponseEntity<ReportResponse> {
        val response = service.create(member, request)
        return ResponseEntity.created(URI.create("/api/v1/operations/reports/${response.id}")).body(response)
    }

    @GetMapping("/mine")
    fun mine(@AuthenticationPrincipal member: OperationsMember) = service.mine(member)

    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember, @RequestParam(required = false) status: ReportStatus?) =
        service.list(member, status)

    @GetMapping("/{id}")
    fun detail(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID) = service.detail(member, id)

    @PostMapping("/{id}/evidence")
    fun evidence(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID, @RequestBody request: ReportBodyRequest) =
        service.addEvidence(member, id, request)

    @PostMapping("/{id}/explanations")
    fun explain(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID, @RequestBody request: ReportBodyRequest) =
        service.addExplanation(member, id, request)

    @GetMapping("/{id}/explanations")
    fun explanations(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID) = service.explanations(member, id)

    @PostMapping("/{id}/review")
    fun review(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID, @RequestBody request: ReportReviewRequest) =
        service.review(member, id, request)

    @PostMapping("/{id}/restriction")
    fun restrict(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID) = service.restrict(member, id)

    @DeleteMapping("/{id}/restriction")
    fun unrestrict(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID) = service.unrestrict(member, id)

    @PostMapping("/{id}/evidence-requests")
    fun requestEvidence(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID, @RequestBody request: ReportBodyRequest) =
        service.requestEvidence(member, id, request)
}
