package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.InitialWorldApplicationService
import ai.storyfork.content.world.service.dto.*
import java.net.URI
import java.security.Principal
import java.util.UUID
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

/** 승인 결정과 별개인 초안 부분 추가 요청 및 영속 receipt를 제공한다. */
@RestController
@RequestMapping("/api/v1/world-studios/{worldId}/analyses/{analysisId}/applications")
class InitialWorldApplicationController(private val service:InitialWorldApplicationService) {
    private fun response(world:UUID,analysis:UUID,result:InitialWorldApplicationResponse,post:Boolean)=ResponseEntity
        .status(when { result.status=="applied" -> 200;result.status=="applying" -> 202;post -> 503;else -> 200 })
        .location(URI.create("/api/v1/world-studios/$world/analyses/$analysis/applications/${result.applicationId}"))
        .header("Cache-Control","no-store").body(result)
    /** 같은 요청만 저장된 UUID/payload로 재개한다. */
    @PostMapping
    fun apply(@PathVariable worldId:UUID,@PathVariable analysisId:UUID,principal:Principal,@RequestBody request:InitialWorldApplicationRequest)=
        response(worldId,analysisId,service.apply(worldId,UUID.fromString(principal.name),analysisId,request),true)
    /** 조회는 저장을 재실행하지 않는다. */
    @GetMapping("/{applicationId}")
    fun get(@PathVariable worldId:UUID,@PathVariable analysisId:UUID,@PathVariable applicationId:UUID,principal:Principal)=
        response(worldId,analysisId,service.get(worldId,UUID.fromString(principal.name),analysisId,applicationId),false)
}
