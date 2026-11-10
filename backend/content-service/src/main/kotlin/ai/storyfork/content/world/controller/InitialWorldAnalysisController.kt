package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import java.net.URI
import java.security.Principal
import java.util.UUID
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1/world-studios/{worldId}/analyses")
class InitialWorldAnalysisController(private val service:InitialWorldAnalysisService) {
    private fun response(world:UUID,result:InitialWorldAnalysisRead,post:Boolean=false):ResponseEntity<InitialWorldAnalysisResponse> {
        val status=when(result.body.executionStatus) {
            "running" -> 202
            "failed" -> if(post) 502 else 200
            "unknown" -> if(post) 503 else 200
            else -> 200
        }
        val builder=ResponseEntity.status(status).location(URI.create("/api/v1/world-studios/$world/analyses/${result.body.analysisId}"))
            .header("Cache-Control","no-store")
        result.failureCode?.let { builder.header("X-Analysis-Failure-Code",it) }
        if(status==202) builder.header("Retry-After","2")
        return builder.body(result.body)
    }
    @PostMapping
    fun analyze(@PathVariable worldId:UUID,principal:Principal,@RequestBody request:InitialWorldAnalysisRequest)=
        response(worldId,service.analyze(worldId,UUID.fromString(principal.name),request),true)
    @GetMapping
    fun list(@PathVariable worldId:UUID,principal:Principal)=service.list(worldId,UUID.fromString(principal.name))
    @GetMapping("/{analysisId}")
    fun get(@PathVariable worldId:UUID,@PathVariable analysisId:UUID,principal:Principal)=
        response(worldId,service.get(worldId,UUID.fromString(principal.name),analysisId))
    @GetMapping("/{analysisId}/candidates")
    fun candidates(@PathVariable worldId:UUID,@PathVariable analysisId:UUID,principal:Principal)=
        service.candidates(worldId,UUID.fromString(principal.name),analysisId)

    /** 검토 결정을 누적하고 반환한다. 초안 반영·확정 저장은 하지 않는다. */
    @PostMapping("/{analysisId}/candidates/{candidateId}/decisions")
    fun decide(@PathVariable worldId:UUID,@PathVariable analysisId:UUID,@PathVariable candidateId:UUID,
        principal:Principal,@RequestBody request:InitialWorldDecisionRequest)=
        service.decide(worldId,UUID.fromString(principal.name),analysisId,candidateId,request)

    @ExceptionHandler(InitialWorldReviewConflict::class)
    fun reviewConflict(error:InitialWorldReviewConflict)=ResponseEntity.status(409).body(WorldStudioErrorResponse(error.code,
        if(error.code=="ANALYSIS_STALE") "원본이 변경되었습니다. 재분석 후 검토하세요." else "완료된 분석 후보만 검토할 수 있습니다."))

    @ExceptionHandler(AnalysisStorageUnconfirmed::class)
    fun storage(error:AnalysisStorageUnconfirmed)=ResponseEntity.status(503)
        .location(URI.create("/api/v1/world-studios/${error.worldId}/analyses/${error.analysisId}"))
        .body(WorldStudioErrorResponse("ANALYSIS_STORAGE_UNCONFIRMED","저장 결과를 확인하지 못했습니다. 동일 키로 조회하고 새 키로 자동 실행하지 마세요."))
}
