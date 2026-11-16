package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.WorldReviewService
import ai.storyfork.content.world.service.dto.WorldReviewRequest
import java.security.Principal
import java.util.UUID
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

/**
 * 설정집 AI 검토 공개 API(docs/design/world-review-contract.md). 소유자만(아니면 404) 쓰며 `/api/v1/world-studios` 아래의 인증·CSRF·라우팅을 그대로 쓴다.
 * 오류는 소유자 404·관계 저장소 오류를 [WorldStudioExceptionHandler]가, 동의 422·AI 실패 503·504·502를 콘텐츠 처리기가 `{ detail, code }`로 돌려준다.
 */
@RestController
@RequestMapping("/api/v1/world-studios/{worldId}/reviews")
class WorldReviewController(private val service: WorldReviewService) {
    /** 저장된 현재 초안(활성 카드와 최신 관계)을 AI가 검토한다. 아무것도 저장하지 않고 응답은 캐시하지 않는다. 본문이 없거나 `consent`가 true가 아니면 422다. */
    @PostMapping
    fun review(@PathVariable worldId: UUID, principal: Principal, @RequestBody(required = false) request: WorldReviewRequest?) =
        ResponseEntity.ok().header("Cache-Control", "no-store").body(service.review(worldId, UUID.fromString(principal.name), request?.consent))
}
