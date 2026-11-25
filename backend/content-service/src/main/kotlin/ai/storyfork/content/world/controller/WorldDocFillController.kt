package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.WorldDocFillService
import ai.storyfork.content.world.service.dto.WorldReviewRequest
import java.security.Principal
import java.util.UUID
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

/**
 * 인물 문서 채우기 공개 API(docs/design/world-review-contract.md). 소유자만(아니면 404) 쓰며 `/api/v1/world-studios` 아래의 인증·CSRF·라우팅을 그대로 쓴다.
 * 오류는 소유자 404를 [WorldStudioExceptionHandler]가, 동의 422·카드·연결 거절·AI 실패 503·504·502를 콘텐츠 처리기가 `{ detail, code }`로 돌려준다.
 */
@RestController
@RequestMapping("/api/v1/world-studios/{worldId}/cards/{cardId}/doc-suggestions")
class WorldDocFillController(private val service: WorldDocFillService) {
    /** 인물 카드의 비어 있는 IDENTITY·SOUL을 연결된 소설의 저장 원고 문장으로 채우는 제안을 만든다. 저장하지 않으며 응답은 캐시하지 않는다. 본문이 없거나 `consent`가 true가 아니면 422다. */
    @PostMapping
    fun fill(@PathVariable worldId: UUID, @PathVariable cardId: UUID, principal: Principal, @RequestBody(required = false) request: WorldReviewRequest?) =
        ResponseEntity.ok().header("Cache-Control", "no-store").body(service.fill(worldId, cardId, UUID.fromString(principal.name), request?.consent))
}
