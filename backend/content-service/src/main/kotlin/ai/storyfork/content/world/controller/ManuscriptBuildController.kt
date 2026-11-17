package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.ManuscriptBuildService
import ai.storyfork.content.world.service.dto.ManuscriptBuildRequest
import ai.storyfork.content.world.service.dto.ManuscriptBuildResponse
import java.net.URI
import java.security.Principal
import java.util.UUID
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

/** 작가가 명시적으로 시작한 최초 원고 구축만 접수한다. 업로드·발행과 연결하지 않는다. */
@RestController
@RequestMapping("/api/v1/works/{id}/world-preprocessing")
class ManuscriptBuildController(private val service:ManuscriptBuildService) {
    /** 동일 key는 기존 작업을 조회하고 명시적 재개 token만 실패 작업을 재개한다. */
    @PostMapping fun start(@PathVariable id:String,principal:Principal,@RequestBody request:ManuscriptBuildRequest):ResponseEntity<ManuscriptBuildResponse> {
        val result=service.start(id,UUID.fromString(principal.name),request)
        return ResponseEntity.status(if(result.status in listOf("queued","running","loading")) 202 else 200)
            .location(URI.create("/api/v1/works/$id/world-preprocessing")).header("Cache-Control","no-store").body(result)
    }
    /** 성공 수는 영속 결과 행으로 계산하며 완료 receipt가 없는 작업을 완료로 표시하지 않는다. */
    @GetMapping fun read(@PathVariable id:String,principal:Principal)=service.read(id,UUID.fromString(principal.name))
}
