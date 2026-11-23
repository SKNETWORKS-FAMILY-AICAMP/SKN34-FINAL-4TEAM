package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.InternalWorldStudioService
import ai.storyfork.content.world.service.dto.OperationsWorldResponse
import java.util.UUID
import org.springframework.web.bind.annotation.*

/** 운영 서비스 전용 내부 API. `/internal/v1` 하위의 운영 서비스 토큰 체인만 지나며 공개 proxy에 등록하지 않는다. */
@RestController
@RequestMapping("/internal/v1/world-studios")
class InternalWorldStudioController(private val service: InternalWorldStudioService) {
    /** 지우지 않은 전체 세계관(비공개·제한 포함, 최신순)과 공개·제한·연결 작품 상태다. */
    @GetMapping
    fun list(): List<OperationsWorldResponse> = service.list()

    /** 세계관을 제한해 공개 세계관 경로(목록·상세·카드 검색·이미지·가져오기)에서 숨긴다(멱등). 없거나 지운 세계관은 404다. */
    @PutMapping("/{worldId}/restriction")
    fun restrict(@PathVariable worldId: UUID): OperationsWorldResponse = service.restrict(worldId, true)

    /** 세계관 제한을 해제한다(멱등). */
    @DeleteMapping("/{worldId}/restriction")
    fun unrestrict(@PathVariable worldId: UUID): OperationsWorldResponse = service.restrict(worldId, false)
}
