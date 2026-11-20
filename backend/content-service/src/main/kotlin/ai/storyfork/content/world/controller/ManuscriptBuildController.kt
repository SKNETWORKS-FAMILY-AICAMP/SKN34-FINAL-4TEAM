package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.ManuscriptBuildService
import java.util.UUID
import org.springframework.web.bind.annotation.*
import tools.jackson.databind.JsonNode

/** 내부 AI 전용. 실행권과 저장본을 Content가 매 단계 다시 검사한다. */
@RestController
@RequestMapping("/internal/v1/ai/manuscript-build/{id}")
class ManuscriptBuildController(private val service: ManuscriptBuildService) {
    data class Claim(val workId: String)
    data class Lease(val token: UUID)
    data class Result(val token: UUID, val result: JsonNode)
    data class Failure(val token: UUID, val episodes: List<Int>, val reason: String)

    @PostMapping("/claim")
    fun claim(@PathVariable id: UUID, @RequestBody request: Claim) = service.claim(id, request.workId)

    @PostMapping("/result")
    fun result(@PathVariable id: UUID, @RequestBody request: Result): Map<String, Boolean> {
        service.record(id, request.token, request.result)
        return mapOf("saved" to true)
    }

    @PostMapping("/structure-input")
    fun inputs(@PathVariable id: UUID, @RequestBody request: Lease) = service.structureInput(id,request.token)

    @PostMapping("/structure")
    fun structure(@PathVariable id: UUID, @RequestBody request: JsonNode): Map<String, Boolean> {
        service.structure(id,UUID.fromString(request.path("token").asString()),request)
        return mapOf("saved" to true)
    }

    @PostMapping("/failed")
    fun failed(@PathVariable id: UUID, @RequestBody request: Failure): Map<String, Boolean> {
        service.failed(id,request.token,request.reason,request.episodes)
        return mapOf("saved" to true)
    }

    @PostMapping("/load")
    fun load(@PathVariable id: UUID, @RequestBody request: Lease) = service.load(id,request.token)
}
